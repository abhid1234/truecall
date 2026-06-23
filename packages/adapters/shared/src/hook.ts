import type { Ctx, VerifyResult } from "../../../core/src/types.ts";
import { runContract } from "../../../core/src/index.ts";
import type { Binding } from "./registry.ts";

export type HookInput = {
  tool_name: string;
  tool_input?: Record<string, unknown>;
  tool_output?: unknown;
  tool_response?: unknown;
};

export async function handleHookEvent(input: HookInput, bindings: Binding[]): Promise<string | null> {
  const ctx: Ctx = {
    tool: input.tool_name,
    args: input.tool_input ?? {},
    result: input.tool_output ?? input.tool_response,
  };
  const applicable = bindings.filter(
    (b) => b.contract.tool === ctx.tool && (b.when === undefined || b.when(ctx)),
  );
  if (applicable.length === 0) return null;

  for (const b of applicable) {
    const v = await runContract(b.contract, ctx);
    if (!v.ok) return JSON.stringify(blockOutput(v));
  }
  return null;
}

function blockOutput(v: Extract<VerifyResult, { ok: false }>): unknown {
  const remediation = v.remediation ? ` Try: ${v.remediation}` : "";
  const kind = v.error ? "could not be verified" : "failed its post-condition";
  // Imperative phrasing — a τ²-bench live run (bench/tau2/RESULTS.md) found agents read a soft
  // "correct it before continuing" as "report a failure" and gave up ~84% of the time; an explicit
  // "re-run it now; don't report success" instruction took the retry rate 8% → 64%.
  const action = v.error
    ? `ACTION REQUIRED: do NOT assume \`${v.tool}\` succeeded — re-run or verify it before continuing.`
    : `ACTION REQUIRED: re-run \`${v.tool}\` now to actually complete it. Do NOT report success and do NOT move on until the effect is confirmed.`;
  return {
    decision: "block",
    reason: v.message,
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      additionalContext:
        `TrueCall: \`${v.tool}\` ${kind}. Expected: ${v.expected}. Actual: ${v.actual}.${remediation} ${action}`,
    },
  };
}
