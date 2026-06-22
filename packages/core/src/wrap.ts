import type { Contract, VerifyResult } from "./types.ts";
import { runContract } from "./verify.ts";

export type WrappedResult<R> =
  | { ok: true; result: R }
  | { ok: false; result: R; signal: Extract<VerifyResult, { ok: false }> };

export type WrapOptions = {
  /** Capture a pre-execution snapshot before the tool runs; exposed to a custom
   *  `verify` as `ctx.before` for delta checks ("row count increased by 1"). */
  snapshot?: (args: Record<string, unknown>) => unknown | Promise<unknown>;
};

export function wrapTool<R>(
  contract: Contract,
  toolFn: (args: Record<string, unknown>) => R | Promise<R>,
  opts: WrapOptions = {},
): (args: Record<string, unknown>) => Promise<WrappedResult<R>> {
  return async (args) => {
    const before = opts.snapshot ? await opts.snapshot(args) : undefined;
    const result = await toolFn(args);
    const verdict = await runContract(contract, { tool: contract.tool, args, result, before });
    if (verdict.ok) return { ok: true, result };
    return { ok: false, result, signal: verdict };
  };
}
