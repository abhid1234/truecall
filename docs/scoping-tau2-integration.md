# Scoping — live-agent τ²-bench integration

> Goal: turn TrueCall's *controlled* benchmark stat into a **real-world** one — measure pass@1 / pass^k
> with vs. without TrueCall on τ²-bench, with a real agent in the loop. This doc is the scope + the
> decisions that gate the build. **Status: scoping (no build yet).**

## What τ²-bench is (operational map — verified)

- `sierra-research/tau2-bench`, **MIT** (derived evals may be published; cite arXiv 2406.12045 + 2506.07982).
- Python 3.12–3.13; install via `uv sync` / pip; run via `tau2 run --domain airline --agent-llm <m> --user-llm <m> --num-tasks N --num-trials K`.
- A run is a loop: **agent LLM** ↔ **user-simulator LLM** ↔ **environment**. Domain tools (airline / retail / telecom) are Python `@is_tool` methods that mutate a Pydantic `db`.
- **Scoring** = after the run, hash the final `db` and compare to a goal state (replay of the task's reference actions) × a "communicate" substring check. Reported as **pass@1** and **pass^k** (consistency over k trials).
- **Cost:** ~$0.05–0.50 for a tiny run (1 domain, `gpt-4o-mini`, ~5–10 tasks, 1–2 trials); ~$5–20 for a full 3-domain suite at frontier pricing.

## Feasibility (checked on this machine)

- python 3.13 present; **network open**: pypi 200, github 200, `api.openai.com` 401 (reachable, needs key), `api.anthropic.com` 405 (reachable). The npm-Airlock does **not** block pip/GitHub/LLM APIs.
- **The only hard gate is an LLM API key + a (small) budget.** Everything else can run here.

## The integration seam

Wrap `tau2/environment/environment.py: make_tool_call()` (≈ L133–170):
```python
db_before = self.db.model_copy(deep=True)
result = self.use_tool(tool_name, **kwargs)
db_after = self.db.model_copy(deep=True)
correction = truecall.check(tool_name, kwargs, result, db_before, db_after)  # deterministic post-condition
if correction is not None:
    result = correction   # the agent sees the correction in-flight, not the false success
return result
```
This is exactly TrueCall's model (post-condition on real state → correction). The `db` snapshot also gives **delta** checks for free (the `ctx.before` capability we just shipped).

## The verifier in Python

τ²-bench is Python; TrueCall's core is TS. Mirror the approach we used for the playground (`engine.js` is a faithful browser port): a small **`truecall.py`** that embodies the same contract semantics (deterministic post-condition → structured correction), with **parity tests** against the TS core's behavior on shared cases. The TS core stays canonical.

## The integrity line (critical — read before building)

There are two ways to define the post-conditions, and only one is honest:

- ✅ **Generic, developer-authored contracts** per write-tool / domain — e.g. "after `create_order`, an order
  for that user exists with `status='confirmed'`"; "after `apply_refund`, balance increased by the refund."
  These are the contracts a *developer* would write from domain knowledge. They catch tool-level silent
  failures and some premature-"done" errors **without seeing the per-task answer.** This is TrueCall as
  actually used. **Use this.**
- ❌ **The per-task `evaluation_criteria` / goal DB** as the post-condition — this is the hidden oracle the
  benchmark scores against. Feeding it back to the agent is **leaking the answer / cheating.** Do not use it.
  (If we ever did, the result would be meaningless and dishonest — flagging it explicitly so it never happens.)

## What it would actually show (be honest about the headline)

τ²-bench's *native* failures are mostly **agent reasoning** errors (wrong tool/args, giving up, premature
"done") — not tool *silent* failures (the domain tools are correct Python). So two experiment designs, with
different (honest) headlines:

1. **Injected tool faults (recommended first):** wrap write-tools to silently fail with probability `p`
   (return success, skip the mutation) — a realistic model of flaky real-world tools. Measure pass@1/pass^k
   with vs. without TrueCall. Expected: a clean, strong lift (TrueCall catches every injected silent failure
   and the agent corrects) — the **live-agent, real-domain** version of our controlled bench. Honest framing:
   "on τ²-bench with injected tool faults at rate p, TrueCall recovered X pass@1 points."
2. **Premature-"done" gate on unmodified τ²-bench (stretch):** generic post-conditions act as an "are you
   actually done?" gate — if the agent stops but a write-tool's post-condition is unmet, nudge it to
   continue. Headline: lift on *unmodified* τ²-bench. Higher-value if it works, but the lift may be modest
   (depends how often agents fail a *checkable, non-oracle* post-condition), and the contract design must
   stay strictly generic (integrity line above). Run after #1.

## Deliverable

A `bench/tau2/` folder in this repo (does NOT vendor all of tau2 — MIT but heavy): a `setup.sh` that
pip/clones tau2-bench into a gitignored workdir, a `truecall.py` verifier + the per-domain contracts, a
small **patch** (or runtime monkeypatch) applying the seam, a `run.py` that runs baseline vs. with-TrueCall
on the same tasks/seed and prints the pass@k delta, and a `README.md` with the methodology + the result.
Honest, reproducible, publishable (cite Sierra).

## Effort & cost tiers

| Tier | Scope | Est. API cost | Eng. effort |
|---|---|---|---|
| **Smoke** | 1 domain (airline), `gpt-4o-mini`, ~5 tasks × 2 trials, injected faults | ~$0.05–0.20 | the seam + a few contracts |
| **Headline** | 1–2 domains, a stronger model, ~30–50 tasks × 3 trials, injected faults | ~$2–8 | + more contracts, the runner |
| **Full** | 3 domains × full task sets × k trials, both experiment designs | ~$15–40 | + premature-done gate, writeup |

Recommend **Smoke → Headline**, stopping when the number is solid and honest.

## Risks
- **Cost/keys are yours** — the build can't run without an LLM API key + budget.
- **Integrity** — generic contracts only; never the oracle. (Documented above; would be the #1 review check.)
- **Modest native lift** — if we *don't* inject faults, the honest lift may be small; the injected-fault design
  is the defensible strong result. We state the design plainly either way.
- **τ²-bench API drift** — pin a tau2-bench commit; the seam is one function, low surface.

## Decisions that gate the build (need your call)
1. **API key + budget** — which provider/key, and a $ ceiling (the Smoke tier is ~$0.20). This is the real gate.
2. **Experiment design** — start with injected tool faults (recommended) and/or the premature-done gate.
3. **Scope tier** — Smoke first, then decide on Headline.
4. **Where it lives** — `bench/tau2/` in this repo (recommended) vs. a separate repo.
