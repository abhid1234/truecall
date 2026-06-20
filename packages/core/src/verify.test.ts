import test from "node:test";
import assert from "node:assert/strict";
import { runContract } from "./verify.ts";
import type { Contract, Ctx } from "./types.ts";

const ctx: Ctx = { tool: "send_email", args: { to: "a@b.com" }, result: { id: "1", state: "sent" } };

test("passes when the post-condition holds", async () => {
  const c: Contract = { tool: "send_email", post: { check: "result", path: "state", equals: "sent" } };
  assert.deepEqual(await runContract(c, ctx), { ok: true });
});

test("clean fail returns a signal without error flag", async () => {
  const c: Contract = { tool: "send_email", post: { check: "result", path: "state", equals: "draft" } };
  const r = await runContract(c, ctx);
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.error ?? false, false);
  assert.equal(r.tool, "send_email");
  assert.match(r.message, /post-condition failed/);
  assert.ok(r.expected.length > 0 && r.actual.length > 0);
});

test("AND: array post fails if any check fails", async () => {
  const c: Contract = {
    tool: "send_email",
    post: [
      { check: "result", path: "id", exists: true },
      { check: "result", path: "state", equals: "draft" },
    ],
  };
  const r = await runContract(c, ctx);
  assert.equal(r.ok, false);
});

test("verifier throw is fail-closed with error:true", async () => {
  const c: Contract = { tool: "send_email", post: { verify: () => { throw new Error("boom"); }, describe: "x" } };
  const r = await runContract(c, ctx);
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.error, true);
  assert.match(r.actual, /boom/);
});

test("timeout is fail-closed with error:true", async () => {
  const c: Contract = {
    tool: "slow",
    timeoutMs: 20,
    post: { verify: () => new Promise<boolean>((res) => setTimeout(() => res(true), 200)), describe: "slow" },
  };
  const r = await runContract(c, ctx);
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.error, true);
  assert.match(r.actual, /exceeded/);
});
