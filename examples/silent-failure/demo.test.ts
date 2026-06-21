import test from "node:test";
import assert from "node:assert/strict";
import { runWithout, runWith } from "./demo.ts";

test("WITHOUT TrueCall: tool reports success but nothing persists", async () => {
  const store = new Map<string, { id: string; body: string }>();
  const r = await runWithout(store);
  assert.equal(r.reported, "success");
  assert.equal(r.persisted, false);
});

test("WITH TrueCall: silent failure is caught and corrected; record persists", async () => {
  const store = new Map<string, { id: string; body: string }>();
  const r = await runWith(store);
  assert.equal(r.corrected, true);
  assert.equal(r.persisted, true);
});
