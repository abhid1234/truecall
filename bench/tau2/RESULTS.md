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
> tool-failures with 0 false positives. Net task-reward change was within noise (mean 0.36 → 0.38 over three
> paired runs, swing −6% to +45%) — on a lightweight agent, reliable **recovery** from a caught failure is
> not guaranteed and is the open problem.*

Do not quote run 2's +45% alone — it did not replicate.

## Future work to convert catches → completions

- **A more capable agent** (or thinking enabled with a token budget that avoids the empty-message bug) —
  the hypothesis is that a stronger agent uses the correction better. Untested here (cost/bug).
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
