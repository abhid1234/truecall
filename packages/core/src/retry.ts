import type { Contract, VerifyResult } from "./types.ts";
import { runContract } from "./verify.ts";

/** The failure branch of a VerifyResult — the structured correction signal. */
export type CorrectionSignal = Extract<VerifyResult, { ok: false }>;

/**
 * Produces a tool result for attempt `n`. On a retry it receives the previous
 * correction signal, so the caller can re-prompt / fix using what TrueCall found —
 * exactly what an agent harness does when it receives a `block` correction.
 */
export type AttemptFn<R> = (n: number, lastSignal?: CorrectionSignal) => R | Promise<R>;

export type RetryOutcome<R> = {
  ok: boolean;
  result: R;
  attempts: number;
  signal?: CorrectionSignal;
};

/**
 * Run a tool, verify its post-condition, and on a silent failure re-attempt (with the
 * correction fed back) up to `maxRetries` times. Makes "the agent self-corrects" a
 * guaranteed loop instead of a hope. Zero-dependency; deterministic.
 */
export async function verifyWithRetry<R>(
  contract: Contract,
  attempt: AttemptFn<R>,
  opts: { args?: Record<string, unknown>; maxRetries?: number } = {},
): Promise<RetryOutcome<R>> {
  const args = opts.args ?? {};
  const maxRetries = opts.maxRetries ?? 2;
  let lastSignal: CorrectionSignal | undefined;
  let result!: R;
  for (let n = 0; n <= maxRetries; n++) {
    result = await attempt(n, lastSignal);
    const v = await runContract(contract, { tool: contract.tool, args, result });
    if (v.ok) return { ok: true, result, attempts: n + 1 };
    lastSignal = v;
  }
  return { ok: false, result, attempts: maxRetries + 1, signal: lastSignal };
}
