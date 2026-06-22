import type { Contract, Check } from "./types.ts";

const BUILTIN = new Set(["file_exists", "http", "shell", "result", "schema"]);

export function validateContract(c: Contract): string[] {
  const errs: string[] = [];
  if (!c || typeof c !== "object") return ["contract must be an object"];
  if (typeof c.tool !== "string" || c.tool.length === 0) {
    errs.push("contract.tool must be a non-empty string");
  }
  if (c.timeoutMs !== undefined && (typeof c.timeoutMs !== "number" || c.timeoutMs <= 0)) {
    errs.push("contract.timeoutMs must be a positive number");
  }
  if (c.post === undefined) {
    errs.push("contract.post is required");
  } else {
    const checks = Array.isArray(c.post) ? c.post : [c.post];
    if (checks.length === 0) errs.push("contract.post must not be an empty array");
    checks.forEach((chk, i) => errs.push(...validateCheck(chk, i)));
  }
  return errs;
}

function validateCheck(chk: Check, i: number): string[] {
  const p = `post[${i}]`;
  if (!chk || typeof chk !== "object") return [`${p} must be an object`];
  if ("verify" in chk) {
    const e: string[] = [];
    if (typeof chk.verify !== "function") e.push(`${p}.verify must be a function`);
    if (typeof chk.describe !== "string" || chk.describe.length === 0) {
      e.push(`${p}.describe is required when using a custom verify`);
    }
    return e;
  }
  const t = (chk as { check?: string }).check;
  if (!t || !BUILTIN.has(t)) {
    return [`${p} must have a known check type (${[...BUILTIN].join(", ")}) or a verify function`];
  }
  const e: string[] = [];
  const anyChk = chk as Record<string, unknown>;
  if (t === "file_exists" && typeof anyChk.path !== "string") e.push(`${p}.path is required`);
  if (t === "http" && typeof anyChk.url !== "string") e.push(`${p}.url is required`);
  if (t === "shell" && typeof anyChk.cmd !== "string") e.push(`${p}.cmd is required`);
  if (t === "result" && typeof anyChk.path !== "string") e.push(`${p}.path is required`);
  if (t === "schema" && (typeof anyChk.shape !== "object" || anyChk.shape === null || Array.isArray(anyChk.shape))) {
    e.push(`${p}.shape (an object of field -> type) is required`);
  }
  return e;
}

export function contract(c: Contract): Contract {
  const errs = validateContract(c);
  if (errs.length) throw new Error(`Invalid contract: ${errs.join("; ")}`);
  return c;
}
