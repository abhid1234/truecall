# Phase 9 Design — Proof: self-correction loop + benchmark

> **Status:** brainstorm output. Two parts: (A) a core `verifyWithRetry` helper that makes "the agent
> self-corrects" a guaranteed loop, and (B) a reproducible `bench/` harness that measures TrueCall's effect
> — catch-rate, task-success with vs. without, and false-positive rate — producing a headline stat for the
> README + launch. Honest framing: a controlled benchmark of the *mechanism*, not a τ-bench claim.

## Part A — `verifyWithRetry` (core)

New zero-dep export in `packages/core`. Models catch → correct → re-verify → stop after N.

```ts
type CorrectionSignal = Extract<VerifyResult, { ok: false }>;
type AttemptFn<R> = (n: number, lastSignal?: CorrectionSignal) => R | Promise<R>;
type RetryOutcome<R> = { ok: boolean; result: R; attempts: number; signal?: CorrectionSignal };

verifyWithRetry<R>(contract, attempt: AttemptFn<R>, opts?: { args?, maxRetries? }): Promise<RetryOutcome<R>>
```
Loop: for n in 0..maxRetries — `result = await attempt(n, lastSignal)`, `v = runContract(contract,{tool,args,result})`; on `v.ok` return `{ok:true,result,attempts:n+1}`; else keep `lastSignal=v`. After the loop, return `{ok:false,result,attempts,signal}`. The `attempt(n, lastSignal)` callback is where the caller re-prompts / fixes using the prior correction — exactly what a harness does when it gets the block signal. Files: `packages/core/src/retry.ts` + `retry.test.ts`; export from `index.ts`. Updates spec §9 (retry is now a provided helper, not just adapter-owned).

## Part B — `bench/` (reproducible measurement)

A plain harness (TS, run with `tsx` like `packages/core`) that imports the **real shipped verifier** and `verifyWithRetry` from core source.

- **Task model:** each task owns an in-memory `world`; its tool **silently fails with a seeded probability `p`** (returns `{status:"success"}` but doesn't mutate the world); on a *corrected* re-attempt it mutates the world (models the agent reading the correction and doing it right). A contract verifies the world changed.
- **Arm 1 — without TrueCall:** call the tool once, trust the success-shaped result; task succeeds only if the world actually changed. Silent failures ship.
- **Arm 2 — with TrueCall:** `verifyWithRetry` (catch → corrected re-attempt → re-verify, maxRetries 2). Record final success + whether a silent failure was caught.
- **Seeded PRNG** (LCG, fixed seed) → fully reproducible. N tasks × T trials.

**Metrics reported:** task-success % (arm1 vs arm2), **catch-rate** (% of silent failures TrueCall caught — deterministically ~100%), **false-positive rate** (genuine successes wrongly blocked — must be 0), avg attempts.

**Output:** `bench/run.ts` prints a table + a one-line headline (e.g. *"controlled benchmark, seeded silent failures: without TrueCall N% of tasks silently shipped broken; with TrueCall 100% completed — every silent failure caught and corrected, 0 false positives"*). `bench/bench.test.ts` asserts arm2-success > arm1-success, catch-rate = 1, false-positives = 0 (regression guard). `bench/README.md` documents the methodology and is **explicit that this measures the mechanism on a controlled silent-failure distribution — not τ-bench, not a claim about real-world agent task mixes** (that's future work needing the actual benchmark + a live agent).

Files: `bench/{package.json,tsconfig.json,.gitignore,run.ts,tasks.ts,bench.test.ts,README.md}` + a `node_modules` symlink (tsx/@types/node), like the other packages.

## Constraints
- Zero-dep; core stays zero-dep. `bench/` uses only `node:*` + core source.
- Deterministic/seeded; honest framing (mechanism, not τ-bench).
- Tests: `node`/`tsx --test` for both core retry and the bench guard.

## Acceptance
- `verifyWithRetry` catches a silent failure and self-corrects within N retries (tested).
- `bench/run.ts` prints a reproducible table + headline stat; `bench.test.ts` asserts with > without, 100% catch, 0 false positives.
- The headline stat is honest about being a controlled-mechanism benchmark.
