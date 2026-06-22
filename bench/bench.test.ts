import test from "node:test";
import assert from "node:assert/strict";
import { runBench } from "./run.ts";

test("with TrueCall completes more tasks than without", async () => {
  const m = await runBench({ trials: 240, p: 0.5, seed: 12345 });
  assert.ok(m.withSuccessPct > m.withoutSuccessPct, `with ${m.withSuccessPct}% should beat without ${m.withoutSuccessPct}%`);
  assert.ok(m.silentFailures > 0, "the seeded distribution should contain silent failures");
});

test("every silent failure is caught (deterministic), with zero false positives", async () => {
  const m = await runBench({ trials: 240, p: 0.5, seed: 12345 });
  assert.equal(m.catchRatePct, 100);
  assert.equal(m.falsePositives, 0);
});

test("the retry loop drives task success to 100%", async () => {
  const m = await runBench({ trials: 240, p: 0.6, seed: 999 });
  assert.equal(m.withSuccessPct, 100);
});

test("reproducible: same seed → same metrics", async () => {
  const a = await runBench({ seed: 7, trials: 100 });
  const b = await runBench({ seed: 7, trials: 100 });
  assert.deepEqual(a, b);
});
