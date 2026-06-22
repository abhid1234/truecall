import test from "node:test";
import assert from "node:assert/strict";
import { verifyWithRetry } from "./retry.ts";
import type { Contract } from "./types.ts";

const contract: Contract = { tool: "t", post: { check: "result", path: "ok", equals: true } };

test("succeeds on the first attempt when the post-condition holds", async () => {
  const r = await verifyWithRetry(contract, () => ({ ok: true }));
  assert.equal(r.ok, true);
  assert.equal(r.attempts, 1);
});

test("retries on a silent failure and self-corrects", async () => {
  let calls = 0;
  const r = await verifyWithRetry(contract, (n) => { calls++; return n === 0 ? { ok: false } : { ok: true }; }, { maxRetries: 2 });
  assert.equal(r.ok, true);
  assert.equal(r.attempts, 2);
  assert.equal(calls, 2);
});

test("gives up after maxRetries and returns the correction signal", async () => {
  const r = await verifyWithRetry(contract, () => ({ ok: false }), { maxRetries: 1 });
  assert.equal(r.ok, false);
  assert.equal(r.attempts, 2);
  assert.equal(r.signal?.ok, false);
  assert.match(r.signal?.message ?? "", /post-condition failed/);
});

test("feeds the prior correction signal into the retry attempt", async () => {
  const seen: Array<boolean | undefined> = [];
  await verifyWithRetry(contract, (n, last) => { seen.push(last?.ok); return { ok: n > 0 }; }, { maxRetries: 1 });
  assert.deepEqual(seen, [undefined, false]);
});
