import type { Contract, VerifyResult } from "./types.ts";
import { runContract } from "./verify.ts";

export type WrappedResult<R> =
  | { ok: true; result: R }
  | { ok: false; result: R; signal: Extract<VerifyResult, { ok: false }> };

export function wrapTool<R>(
  contract: Contract,
  toolFn: (args: Record<string, unknown>) => R | Promise<R>,
): (args: Record<string, unknown>) => Promise<WrappedResult<R>> {
  return async (args) => {
    const result = await toolFn(args);
    const verdict = await runContract(contract, { tool: contract.tool, args, result });
    if (verdict.ok) return { ok: true, result };
    return { ok: false, result, signal: verdict };
  };
}
