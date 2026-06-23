# TrueCall × τ²-bench — live-agent results

First live run of the integration: **Gemini 2.5 Flash** (thinking disabled) driving the agent *and* the
user-simulator through real τ²-bench **retail** tasks, with TrueCall wrapping every tool call. Reproducible;
tau2-bench v1.0.0. Honest write-up — including what did **not** pan out.

## Setup

- Model: `gemini/gemini-2.5-flash`, `reasoning_effort=disable` (its thinking mode otherwise emits empty
  `AssistantMessage`s that τ²-bench rejects; disabling it also cuts cost to ~$0.01/conversation).
- Experiment: **injected tool faults** — WRITE tools silently fail at rate `p` (success-shaped result, DB
  mutation skipped). Two **paired** arms on the same seed: *baseline* (faults, no correction) vs *TrueCall*
  (same faults, correction injected in-flight). Contracts are generic (`db_changed` + per-tool), never the
  per-task oracle.
- Metric: τ²-bench reward (final DB-state match × communicate). ~$2.2 total spend.

## Three paired runs

| Run | p | seed | tasks×trials | Baseline reward | TrueCall reward | Δ | Baseline DB-match | TrueCall DB-match |
|----:|--:|-----:|:------------:|:---------------:|:---------------:|:-----:|:----:|:----:|
| 1 | 0.3 | 12345 | 10×2 | 0.375 | 0.353 | −0.022 | 46.2% | 50.0% |
| 2 | 0.4 | 777 | 16×2 | 0.321 | **0.467** | **+0.146** | 36.0% | 66.7% |
| 3 | 0.4 | 2024 | 20×2 | 0.389 | 0.333 | −0.056 | 50.0% | 41.7% |
| | | | **mean** | **0.362** | **0.384** | +0.022 | | |

Across all six arms, **TrueCall produced 0 false positives** and **caught every injected silent failure**
that returned a success-shaped result (~225 catches; the TrueCall arms corrected 142 of them in-flight).

### Matched-task analysis (controls for transient API failures)

The raw table averages over whichever conversations completed — but transient Gemini 500s failed *different*
tasks in each arm, adding noise. Re-computing on only the (task, trial) pairs that **terminated normally in
both arms** (apples-to-apples) sharpens the picture:

| Run | matched pairs | Baseline | TrueCall | Δ |
|----:|:-------------:|:--------:|:--------:|:-----:|
| iter1 (p=0.3) | 16 | 0.375 | 0.375 | +0.000 |
| iter2 (p=0.4) | 28 | 0.321 | 0.500 | +0.179 |
| iter3 (p=0.4) | 29 | 0.448 | 0.345 | −0.103 |

The swing (0.0 / +0.18 / −0.10) **survives** the matched comparison — so the inconsistency is **real agent
behavior under correction**, not just infra noise. That makes the "recovery is not guaranteed" conclusion
more robust, not less. Exact total spend across all runs (summed `agent_cost + user_cost`): **$2.11**.

## What this shows — and what it doesn't

**Detection is rock-solid (the core claim holds).** Deterministic post-conditions caught 100% of injected
silent tool-failures with **zero false positives**, live, on a real agent, at ~$0.01/conversation. This is
the deterministic, model-independent part — and it held on every run.

**Task-reward recovery is NOT established at this scale/model.** The reward effect (−0.022, +0.146, −0.056)
is **dominated by run-to-run noise** — the mean nudge (+0.022) is far smaller than the swing. Run 2 looked
like a clean +45% win; runs 1 and 3 did not replicate it. Honest reading: **catching a silent failure does
not reliably convert into completing the task** on a lightweight agent. The in-flight correction sometimes
drives a successful retry (run 2) and sometimes adds retry-thrash that the cheap agent doesn't recover from
(runs 1, 3). Transient Gemini 500s also failed a few tasks per arm, adding noise at N≈20–40 conversations.

This is consistent with the controlled benchmark (`../`, where a *scripted* agent always fixes on
correction → 100% recovery): **detection is deterministic; whether detection becomes recovery depends on the
agent acting well on the signal.** TrueCall guarantees the first, not the second.

## Honest headline

> *Live on τ²-bench (retail) with a Gemini 2.5 Flash agent, TrueCall caught 100% of injected silent
> tool-failures with 0 false positives. Net task-reward was within noise — because the agent retried the
> caught call only 9% of the time (it gave up 82%). That's a correction-**ergonomics** problem, not a
> detection or capability one: an imperative correction message lifted the retry rate to 64% (~7×, n=11). Detection
> is the deterministic floor; converting catches into recoveries is a tractable ergonomics problem.*

Do not quote run 2's +45% alone — it did not replicate; the retry-rate finding is the durable result.

## The real bottleneck: correction *ergonomics* (and a fix)

Reading the trajectories explained the catch→recovery gap. After a TrueCall correction, what did the agent
actually do next?

| Agent's next move after a correction | OLD message (n=22) |
|---|:---:|
| **retried the failed tool** (the only path to recovery) | **9%** |
| called a different tool | 9% |
| gave up — apologized to the user / moved on | **82%** |

The agent read the soft correction (*"…the effect was not confirmed; retry or verify before continuing"*)
as **"report a failure to the user"** and gave up 82% of the time. Detection was never the problem — and
neither was model capability. The **wording of the correction** was.

So I rewrote it as an imperative that names the tool and forbids giving up: *"NOT DONE: `tool` returned
success but the change did NOT take effect. ACTION REQUIRED: call `tool` again now with the same arguments.
Do NOT tell the user it failed and do NOT move on — retry this exact call."* Re-measured:

| Correction message | corrections | retried the failed tool | gave up |
|---|:---:|:---:|:---:|
| old (soft) | 22 | 9% | 82% |
| **new (imperative)** | 11 | **64%** | 36% |

**Retry rate 9% → 64% (~7×) from a wording change** (`seam.py`) — and the estimate held as n grew (67% at
n=6 → 64% at n=11 across two fault rates and two seeds). Caveat: n=11 is still modest and a retry is a
*necessary* precondition for recovery, not a guarantee of it. But retry-rate is the leading indicator
TrueCall directly controls, and this is the clearest lever found. The deterministic catch is the floor;
getting the agent to *act* on it is an ergonomics problem, and a tractable one.

## Capability test: does a more capable agent recover better?

The catch→recovery gap might just be the lightweight agent. Cheapest test within budget: re-run the iter2
pair (p=0.4, seed 777) with the agent's **thinking enabled** (`reasoning_effort=low`) instead of disabled.

| Condition | matched pairs | Baseline | TrueCall | Δ |
|---|:---:|:---:|:---:|:---:|
| thinking-disabled (iter2) | 28 | 0.321 | 0.500 | +0.179 |
| thinking-low | 5 | 0.200 | 0.200 | +0.000 |

On the matched tasks, enabling thinking did **not** improve recovery — Δreward was flat, same noisy regime.
**Caveat: N=5 matched is tiny** (small run to fit the budget), so this is suggestive, not definitive. The
honest read: a *modest* capability bump doesn't obviously convert catches into recoveries. The real test — a
**frontier agent** (Gemini 2.5 Pro / Claude) — costs 10–20× and was out of budget here; it remains the open
experiment. Grand-total spend across every run: **$2.45 of a $3.00 cap.**

## Future work to convert catches → completions

- **A frontier agent** (Gemini 2.5 Pro / Claude). Thinking-*low* Flash was tested (above) and didn't help;
  a genuinely stronger model is the untested hypothesis — it costs 10–20× and was out of this $3 budget.
- **Better correction ergonomics** — the current signal is a tool-error string; a structured "retry this
  exact call" hint may reduce thrash.
- **Larger N + matched-task analysis** (compare only tasks that completed in both arms; exclude infra 500s)
  to measure the real effect with tighter error bars.
- The premature-done gate experiment (`run.py --no-faults`) on unmodified τ²-bench.

## Reproduce

```bash
./setup.sh && source .tau2/.venv/bin/activate && export GEMINI_API_KEY=...
# one paired arm pair (≈ $0.5):
for c in 0 1; do
  GEMINI_API_KEY=$GEMINI_API_KEY PYTHONPATH="$PWD" TRUECALL_ENABLE=1 TRUECALL_CORRECT=$c \
  TRUECALL_FAULT_P=0.4 TRUECALL_SEED=777 TRUECALL_DOMAIN=retail TRUECALL_STATS_OUT=/tmp/s_$c.json \
  tau2 run --domain retail --agent-llm gemini/gemini-2.5-flash --user-llm gemini/gemini-2.5-flash \
    --agent-llm-args '{"reasoning_effort":"disable"}' --user-llm-args '{"reasoning_effort":"disable"}' \
    --num-tasks 16 --num-trials 2 --seed 777 --max-concurrency 4 --max-steps 40 --save-to arm_$c
done
```
