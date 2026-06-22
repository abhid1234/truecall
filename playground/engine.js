// TrueCall verify engine — browser/Node port of the runtime (mirrors ../docs/spec.md).
// The IO checks (file_exists/http/shell) run against a SIMULATED `world` object, since a
// browser has no fs/shell/network-to-localhost. The orchestration, `result` check, custom
// `verify`, templating, and fail-closed semantics are faithful to the real core.
// Note: a custom `verify` here receives (ctx, world) so it can read the simulated world;
// the real core's verify receives only (ctx) and performs its own IO.

export class TemplateError extends Error {}

export function getPath(obj, path) {
  return String(path).split(".").reduce(
    (acc, k) => (acc == null || typeof acc !== "object" ? undefined : acc[k]),
    obj,
  );
}

export function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a), kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && deepEqual(a[k], b[k]));
}

const TOKEN = /\{\{\s*([\w.]+)\s*\}\}/g;
export function interpolate(tmpl, ctx, transform = (v) => v) {
  return String(tmpl).replace(TOKEN, (_m, expr) => {
    const val = getPath(ctx, expr);
    if (val === undefined) throw new TemplateError(`template path "{{${expr}}}" resolved to undefined`);
    return transform(String(val));
  });
}

export async function runCheck(check, ctx, world = {}) {
  if (check && typeof check.verify === "function") {
    const passed = !!(await check.verify(ctx, world));
    return {
      passed,
      expected: check.describe ?? "custom post-condition holds",
      actual: passed ? "predicate returned true" : "predicate returned false",
    };
  }
  switch (check && check.check) {
    case "file_exists": return fileExists(check, ctx, world);
    case "http": return httpCheck(check, ctx, world);
    case "shell": return shellCheck(check, ctx, world);
    case "result": return resultCheck(check, ctx);
    default: throw new Error(`unknown check type: ${check && check.check}`);
  }
}

function fileExists(c, ctx, world) {
  const path = interpolate(c.path, ctx);
  const expected = `file at ${path}` +
    (c.minSize !== undefined ? ` with size >= ${c.minSize}` : "") +
    (c.contains !== undefined ? ` containing "${c.contains}"` : "");
  const f = (world.files || {})[path];
  if (!f) return { passed: false, expected, actual: `no file exists at ${path}` };
  if (c.minSize !== undefined && (f.size ?? 0) < c.minSize)
    return { passed: false, expected, actual: `file size ${f.size ?? 0} < ${c.minSize}` };
  if (c.contains !== undefined && !String(f.content ?? "").includes(c.contains))
    return { passed: false, expected, actual: `file does not contain "${c.contains}"` };
  return { passed: true, expected, actual: `file exists at ${path} (size ${f.size ?? 0})` };
}

function resultCheck(c, ctx) {
  const val = getPath(ctx.result, c.path);
  const expected = `result.${c.path} ` +
    (c.exists ? "is present" : c.equals !== undefined ? `=== ${JSON.stringify(c.equals)}` : "present");
  if (c.exists && (val === undefined || val === null))
    return { passed: false, expected, actual: `result.${c.path} is ${String(val)}` };
  if (c.equals !== undefined && !deepEqual(val, c.equals))
    return { passed: false, expected, actual: `result.${c.path} = ${JSON.stringify(val)}` };
  return { passed: true, expected, actual: `result.${c.path} = ${JSON.stringify(val)}` };
}

function httpCheck(c, ctx, world) {
  const url = interpolate(c.url, ctx);
  const expected = `GET ${url}` +
    (c.status !== undefined ? ` -> status ${c.status}` : "") +
    (c.jsonPath !== undefined ? ` with ${c.jsonPath} === ${JSON.stringify(c.equals)}` : "");
  const res = (world.http || {})[url];
  if (!res) return { passed: false, expected, actual: "no response (the resource was never created)" };
  if (c.status !== undefined && res.status !== c.status)
    return { passed: false, expected, actual: `status ${res.status}` };
  if (c.jsonPath !== undefined) {
    const val = getPath(res.body, c.jsonPath);
    if (!deepEqual(val, c.equals)) return { passed: false, expected, actual: `${c.jsonPath} = ${JSON.stringify(val)}` };
  }
  return { passed: true, expected, actual: `status ${res.status}` };
}

function shellCheck(c, ctx, world) {
  const cmd = interpolate(c.cmd, ctx);
  const wantExit = c.exitCode ?? (c.stdoutMatches !== undefined ? undefined : 0);
  const expected = "`" + cmd + "`" +
    (wantExit !== undefined ? ` exits ${wantExit}` : "") +
    (c.stdoutMatches !== undefined ? ` stdout matches /${c.stdoutMatches}/` : "");
  const r = (world.shell || {})[cmd] || { exitCode: 127, stdout: "" };
  if (wantExit !== undefined && r.exitCode !== wantExit)
    return { passed: false, expected, actual: `exit ${r.exitCode}` };
  if (c.stdoutMatches !== undefined && !new RegExp(c.stdoutMatches).test(r.stdout))
    return { passed: false, expected, actual: `stdout did not match (got: ${JSON.stringify(r.stdout)})` };
  return { passed: true, expected, actual: `exit ${r.exitCode}` };
}

export async function runContract(contract, ctx, world = {}) {
  const checks = Array.isArray(contract.post) ? contract.post : [contract.post];
  try {
    for (const chk of checks) {
      const outcome = await runCheck(chk, ctx, world);
      if (!outcome.passed) {
        return {
          ok: false,
          tool: contract.tool,
          expected: outcome.expected,
          actual: outcome.actual,
          message: `${contract.tool} reported success but post-condition failed: expected ${outcome.expected}, got ${outcome.actual}`,
        };
      }
    }
    return { ok: true };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      error: true,
      tool: contract.tool,
      expected: contract.description ?? "post-condition is verifiable",
      actual: `verifier error: ${reason}`,
      message: `TrueCall could not verify ${contract.tool}: ${reason}`,
      remediation: "fix the contract or the simulated environment, then retry",
    };
  }
}
