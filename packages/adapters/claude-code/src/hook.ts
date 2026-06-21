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
  return {
    decision: "block",
    reason: v.message,
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      additionalContext:
        `TrueCall: \`${v.tool}\` ${kind}. Expected: ${v.expected}. Actual: ${v.actual}.${remediation} ` +
        `The tool reported success but the intended effect was not confirmed — correct it before continuing.`,
    },
  };
}
