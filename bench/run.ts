// TrueCall controlled benchmark: measures the MECHANISM — does a deterministic
// post-condition catch silent tool failures, and does the retry loop fix them —
// on a seeded, reproducible silent-failure distribution.
//
// HONEST SCOPE: this is NOT τ-bench and NOT a claim about real agent task mixes.
// It models tools that report success but (with probability p) didn't change the
// world, and an agent that, on a TrueCall correction, re-attempts correctly.
// It demonstrates: (1) every silent failure is caught (deterministic), (2) the
// retry loop completes the task, (3) genuine successes are never falsely blocked.

import { verifyWithRetry, type Contract } from "../packages/core/src/index.ts";

// deterministic LCG PRNG (reproducible across runs/machines)
function lcg(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (1664525 * s + 1013904223) >>> 0) / 4294967296);
}

const TOOLS = ["save_record", "create_file", "send_email", "charge_card"];

/** A fresh task instance with its own in-memory world. `willFail` decides whether
 *  attempt 0 silently fails (returns success but doesn't change the world). */
function makeTask(tool: string, willFail: boolean) {
  const world: Record<string, boolean> = {};
  const key = "x";
  const attempt = (n: number) => {
    // attempt 0 lies when willFail; a corrected re-attempt (n>0) actually does the work
    if (n === 0 && willFail) return { status: "success" };
    world[key] = true;
    return { status: "success" };
  };
  const contract: Contract = { tool, post: { verify: () => world[key] === true, describe: "the effect is present in the world" } };
  return { contract, attempt, succeeded: () => world[key] === true, willFail };
}

export type BenchMetrics = {
  trials: number;
  silentFailures: number;
  withoutSuccessPct: number;
  withSuccessPct: number;
  catchRatePct: number;
  falsePositives: number;
  avgAttempts: number;
};

export async function runBench(opts: { trials?: number; p?: number; seed?: number } = {}): Promise<BenchMetrics> {
  const trials = opts.trials ?? 240;
  const p = opts.p ?? 0.5;
  const rng = lcg(opts.seed ?? 12345);

  let silentFailures = 0, withoutOk = 0, withOk = 0, caught = 0, falsePositives = 0, totalAttempts = 0;

  for (let i = 0; i < trials; i++) {
    const tool = TOOLS[i % TOOLS.length];
    const willFail = rng() < p;
    if (willFail) silentFailures++;

    // Arm 1 — without TrueCall: trust the success-shaped result; the task is only
    // really done if the world changed. Silent failures ship broken.
    const t1 = makeTask(tool, willFail);
    t1.attempt(0);
    if (t1.succeeded()) withoutOk++;

    // Arm 2 — with TrueCall: verify + retry on a correction.
    const t2 = makeTask(tool, willFail);
    const r = await verifyWithRetry(t2.contract, t2.attempt, { maxRetries: 2 });
    totalAttempts += r.attempts;
    if (r.ok) withOk++;
    if (willFail && r.attempts > 1) caught++;          // a silent failure that TrueCall caught + retried
    if (!willFail && r.attempts > 1) falsePositives++; // a genuine success wrongly retried (should never happen)
  }

  return {
    trials,
    silentFailures,
    withoutSuccessPct: +(100 * withoutOk / trials).toFixed(1),
    withSuccessPct: +(100 * withOk / trials).toFixed(1),
    catchRatePct: silentFailures ? +(100 * caught / silentFailures).toFixed(1) : 100,
    falsePositives,
    avgAttempts: +(totalAttempts / trials).toFixed(2),
  };
}

async function main() {
  const m = await runBench();
  const line = (k: string, v: string | number) => console.log("  " + k.padEnd(26) + v);
  console.log("\nTrueCall controlled benchmark (seeded, reproducible)\n" + "=".repeat(52));
  line("trials", m.trials);
  line("silent failures seeded", m.silentFailures);
  line("task success — WITHOUT", m.withoutSuccessPct + "%");
  line("task success — WITH", m.withSuccessPct + "%");
  line("silent-failure catch rate", m.catchRatePct + "%");
  line("false positives", m.falsePositives);
  line("avg attempts (with)", m.avgAttempts);
  console.log("=".repeat(52));
  console.log(
    `\nHEADLINE: without TrueCall, ${(100 - m.withoutSuccessPct).toFixed(1)}% of tasks silently shipped broken.\n` +
    `With TrueCall, ${m.withSuccessPct}% completed — ${m.catchRatePct}% of silent failures caught and corrected, ` +
    `${m.falsePositives} false positives.\n`);
  console.log("Scope: a controlled benchmark of the mechanism on a seeded silent-failure distribution — not τ-bench.\n");
}

if (process.argv[1] === (await import("node:url")).fileURLToPath(import.meta.url)) {
  await main();
}
