import test from "node:test";
import assert from "node:assert/strict";
import { handleHookEvent, type HookInput } from "./hook.ts";
import type { Binding } from "./registry.ts";

const passBinding: Binding = {
  contract: { tool: "demo", post: { check: "result", path: "ok", equals: true } },
};
const failBinding: Binding = {
  contract: { tool: "demo", post: { check: "result", path: "ok", equals: true } },
};

test("returns null when the post-condition holds", async () => {
  const input: HookInput = { tool_name: "demo", tool_input: {}, tool_output: { ok: true } };
  assert.equal(await handleHookEvent(input, [passBinding]), null);
});

test("returns block JSON when the post-condition fails", async () => {
  const input: HookInput = { tool_name: "demo", tool_input: {}, tool_output: { ok: false } };
  const out = await handleHookEvent(input, [failBinding]);
  assert.ok(out, "expected a non-null block string");
  const parsed = JSON.parse(out as string);
  assert.equal(parsed.decision, "block");
  assert.equal(parsed.hookSpecificOutput.hookEventName, "PostToolUse");
  assert.match(parsed.reason, /post-condition failed/);
  assert.match(parsed.hookSpecificOutput.additionalContext, /Expected:/);
  // imperative correction (τ²-bench finding: soft phrasing -> agents give up; see bench/tau2/RESULTS.md)
  assert.match(parsed.hookSpecificOutput.additionalContext, /ACTION REQUIRED: re-run/);
  assert.match(parsed.hookSpecificOutput.additionalContext, /Do NOT report success/);
});

test("returns null when no binding matches the tool name", async () => {
  const input: HookInput = { tool_name: "other", tool_input: {}, tool_output: { ok: false } };
  assert.equal(await handleHookEvent(input, [failBinding]), null);
});

test("a when() guard that returns false skips the contract", async () => {
  const guarded: Binding = { ...failBinding, when: () => false };
  const input: HookInput = { tool_name: "demo", tool_input: {}, tool_output: { ok: false } };
  assert.equal(await handleHookEvent(input, [guarded]), null);
});

test("falls back to tool_response when tool_output is absent", async () => {
  const input: HookInput = { tool_name: "demo", tool_input: {}, tool_response: { ok: false } };
  const out = await handleHookEvent(input, [failBinding]);
  assert.ok(out);
  assert.equal(JSON.parse(out as string).decision, "block");
});

test("a fail-closed verifier error is surfaced as a block", async () => {
  const errBinding: Binding = {
    contract: { tool: "demo", post: { verify: () => { throw new Error("boom"); }, describe: "x" } },
  };
  const input: HookInput = { tool_name: "demo", tool_input: {}, tool_output: {} };
  const out = await handleHookEvent(input, [errBinding]);
  assert.ok(out);
  const parsed = JSON.parse(out as string);
  assert.equal(parsed.decision, "block");
  assert.match(parsed.hookSpecificOutput.additionalContext, /could not be verified/);
});
