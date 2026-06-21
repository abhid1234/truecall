import type { Contract, Ctx, VerifyResult, Check } from "./types.ts";
import { runCheck } from "./checks.ts";

const DEFAULT_TIMEOUT_MS = 2000;

export async function runContract(contract: Contract, ctx: Ctx): Promise<VerifyResult> {
  const checks: Check[] = Array.isArray(contract.post) ? contract.post : [contract.post];
  const timeoutMs = contract.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  try {
    return await withTimeout(evalChecks(checks, ctx, contract), timeoutMs);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      error: true,
      tool: contract.tool,
      expected: contract.description ?? "post-condition is verifiable",
      actual: `verifier error: ${reason}`,
      message: `TrueCall could not verify ${contract.tool}: ${reason}`,
      remediation: "fix the contract or the verifier environment, then retry",
    };
  }
}

async function evalChecks(checks: Check[], ctx: Ctx, contract: Contract): Promise<VerifyResult> {
  for (const chk of checks) {
    const outcome = await runCheck(chk, ctx);
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
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`verification exceeded ${ms}ms`)), ms);
    p.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}
