# TrueCall benchmark

A small, **reproducible** benchmark that measures TrueCall's *mechanism*: does a deterministic
post-condition catch silent tool failures, and does the retry loop ([`verifyWithRetry`](../packages/core/src/retry.ts))
complete the task — without ever falsely blocking a genuine success?

## Run it

```bash
cd bench && ./node_modules/.bin/tsx run.ts     # prints the table + headline
./node_modules/.bin/tsx --test bench.test.ts   # asserts the result (regression guard)
```

## Result (seed 12345, 240 trials, p=0.5)

```
task success — WITHOUT      51.7%
task success — WITH         100%
silent-failure catch rate   100%
false positives             0
avg attempts (with)         1.48
```

**Without TrueCall, ~48% of tasks silently shipped broken. With TrueCall, 100% completed — every silent
failure caught and corrected, 0 false positives.** Reproducible: the same seed yields the same numbers.

## Methodology

Each trial models a tool that returns a success-shaped result but, with probability `p`, **didn't actually
change the world** (a silent failure). An "agent" that receives a TrueCall correction re-attempts and does
the work correctly. Two arms run on the *same* seeded situations:

- **Without TrueCall** — trust the success-shaped result; the task is only really done if the world
  changed. Silent failures ship.
- **With TrueCall** — `verifyWithRetry`: verify the post-condition, and on a catch re-attempt (correction
  fed back) up to 2 times.

Metrics: task-success % (both arms), **catch rate** (% of silent failures caught — deterministically 100%),
**false positives** (genuine successes wrongly blocked — 0 by construction, since a deterministic check
never mis-fires on a real success), and average attempts.

## Honest scope

This benchmarks the **mechanism** on a *controlled, synthetic* silent-failure distribution. It is **not**
τ-bench and **not** a claim about the failure mix of real agent workloads. It demonstrates three things
cleanly and reproducibly: (1) a deterministic post-condition catches *every* silent failure, (2) the retry
loop turns those catches into completed tasks, and (3) genuine successes are never falsely blocked.
Measuring impact on a real agent benchmark (τ-bench / τ²-bench, with a live agent in the loop) is the
natural next step and is tracked as future work.
