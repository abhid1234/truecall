import { stat, readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Check, Ctx, SchemaType } from "./types.ts";
import { interpolate, getPath, deepEqual } from "./template.ts";

const pexecFile = promisify(execFile);

export type CheckOutcome = { passed: boolean; expected: string; actual: string };

export async function runCheck(chk: Check, ctx: Ctx): Promise<CheckOutcome> {
  if ("verify" in chk) {
    const passed = !!(await chk.verify(ctx));
    return {
      passed,
      expected: chk.describe ?? "custom post-condition holds",
      actual: passed ? "predicate returned true" : "predicate returned false",
    };
  }
  switch (chk.check) {
    case "file_exists": return fileExists(chk, ctx);
    case "http": return httpCheck(chk, ctx);
    case "shell": return shellCheck(chk, ctx);
    case "result": return resultCheck(chk, ctx);
    case "schema": return schemaCheck(chk, ctx);
  }
}

function typeOf(v: unknown): SchemaType | "null" | "undefined" {
  if (v === null) return "null";
  if (v === undefined) return "undefined";
  if (Array.isArray(v)) return "array";
  const t = typeof v;
  if (t === "string" || t === "number" || t === "boolean" || t === "object") return t;
  return "object";
}

function schemaCheck(
  chk: { path?: string; shape: Record<string, SchemaType> },
  ctx: Ctx,
): CheckOutcome {
  const root = chk.path ? getPath(ctx.result, chk.path) : ctx.result;
  const where = chk.path ? `result.${chk.path}` : "result";
  const expected = `${where} matches shape { ${Object.entries(chk.shape).map(([k, t]) => `${k}: ${t}`).join(", ")} }`;
  if (root === null || typeof root !== "object") {
    return { passed: false, expected, actual: `${where} is ${typeOf(root)}, not an object` };
  }
  for (const [key, want] of Object.entries(chk.shape)) {
    const val = (root as Record<string, unknown>)[key];
    const got = typeOf(val);
    if (want === "present") {
      if (val === undefined || val === null) return { passed: false, expected, actual: `${where}.${key} is ${got}` };
    } else if (got !== want) {
      return { passed: false, expected, actual: `${where}.${key} is ${got}, expected ${want}` };
    }
  }
  return { passed: true, expected, actual: `${where} matches the shape` };
}

async function fileExists(
  chk: { path: string; minSize?: number; contains?: string },
  ctx: Ctx,
): Promise<CheckOutcome> {
  const path = interpolate(chk.path, ctx);
  const expected =
    `file at ${path}` +
    (chk.minSize !== undefined ? ` with size >= ${chk.minSize}` : "") +
    (chk.contains !== undefined ? ` containing "${chk.contains}"` : "");
  let size: number;
  try {
    size = (await stat(path)).size;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { passed: false, expected, actual: `no file exists at ${path}` };
    }
    throw err; // other fs faults => verifier error
  }
  if (chk.minSize !== undefined && size < chk.minSize) {
    return { passed: false, expected, actual: `file size ${size} < ${chk.minSize}` };
  }
  if (chk.contains !== undefined) {
    const body = await readFile(path, "utf8");
    if (!body.includes(chk.contains)) {
      return { passed: false, expected, actual: `file does not contain "${chk.contains}"` };
    }
  }
  return { passed: true, expected, actual: `file exists at ${path} (size ${size})` };
}

function resultCheck(
  chk: { path: string; exists?: boolean; equals?: unknown },
  ctx: Ctx,
): CheckOutcome {
  const val = getPath(ctx.result, chk.path);
  const expected =
    `result.${chk.path} ` +
    (chk.exists ? "is present" : chk.equals !== undefined ? `=== ${JSON.stringify(chk.equals)}` : "present");
  if (chk.exists && (val === undefined || val === null)) {
    return { passed: false, expected, actual: `result.${chk.path} is ${String(val)}` };
  }
  if (chk.equals !== undefined && !deepEqual(val, chk.equals)) {
    return { passed: false, expected, actual: `result.${chk.path} = ${JSON.stringify(val)}` };
  }
  return { passed: true, expected, actual: `result.${chk.path} = ${JSON.stringify(val)}` };
}

async function httpCheck(
  chk: { url: string; method?: "GET"; status?: number; jsonPath?: string; equals?: unknown },
  ctx: Ctx,
): Promise<CheckOutcome> {
  const url = interpolate(chk.url, ctx);
  const expected =
    `GET ${url}` +
    (chk.status !== undefined ? ` -> status ${chk.status}` : "") +
    (chk.jsonPath !== undefined ? ` with ${chk.jsonPath} === ${JSON.stringify(chk.equals)}` : "");
  const res = await fetch(url, { method: chk.method ?? "GET" });
  if (chk.status !== undefined && res.status !== chk.status) {
    return { passed: false, expected, actual: `status ${res.status}` };
  }
  if (chk.jsonPath !== undefined) {
    const body = await res.json();
    const val = getPath(body, chk.jsonPath);
    if (!deepEqual(val, chk.equals)) {
      return { passed: false, expected, actual: `${chk.jsonPath} = ${JSON.stringify(val)}` };
    }
  }
  return { passed: true, expected, actual: `status ${res.status}` };
}

function shellEscape(v: string): string {
  return `'${v.replace(/'/g, `'\\''`)}'`;
}

async function shellCheck(
  chk: { cmd: string; exitCode?: number; stdoutMatches?: string },
  ctx: Ctx,
): Promise<CheckOutcome> {
  const cmd = interpolate(chk.cmd, ctx, shellEscape);
  const wantExit = chk.exitCode ?? (chk.stdoutMatches !== undefined ? undefined : 0);
  const expected =
    `\`${cmd}\`` +
    (wantExit !== undefined ? ` exits ${wantExit}` : "") +
    (chk.stdoutMatches !== undefined ? ` stdout matches /${chk.stdoutMatches}/` : "");
  let stdout = "";
  let code = 0;
  try {
    const r = await pexecFile("/bin/sh", ["-c", cmd]);
    stdout = r.stdout;
  } catch (err) {
    const e = err as { code?: number; stdout?: string };
    code = typeof e.code === "number" ? e.code : 1;
    stdout = e.stdout ?? "";
  }
  if (wantExit !== undefined && code !== wantExit) {
    return { passed: false, expected, actual: `exit ${code}` };
  }
  if (chk.stdoutMatches !== undefined && !new RegExp(chk.stdoutMatches).test(stdout)) {
    return { passed: false, expected, actual: `stdout did not match (got: ${JSON.stringify(stdout)})` };
  }
  return { passed: true, expected, actual: `exit ${code}` };
}
