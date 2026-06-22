# TrueCall × τ²-bench

Measure TrueCall's effect on a **live agent** in [τ²-bench](https://github.com/sierra-research/tau2-bench)
(Sierra; MIT) — the real benchmark, not our controlled toy. Reports **pass@1 / pass^k** with vs. without
TrueCall on the *same* tasks and the *same* fault seed.

## What's here

| File | Role | Tested without a key? |
|---|---|---|
| `truecall.py` | dependency-free Python port of the verify semantics (deterministic, fail-closed) | ✅ `tests/` |
| `contracts.py` | **generic, developer-authored** post-conditions (`db_changed` for any WRITE tool; richer per-tool examples) | ✅ `tests/` |
| `faults.py` | seeded fault injector (WRITE tools "succeed" but skip the mutation) | ✅ `tests/` |
| `seam.py` | monkeypatch of `Environment.get_response` → snapshot db, (inject fault), verify, correct in-flight | needs a run |
| `sitecustomize.py` | auto-installs the seam into the `tau2 run` process via env config | needs a run |
| `run.py` | paired runner (baseline vs TrueCall) + pass@k diff | needs a run + **LLM API key** |
| `setup.sh` | clone + install tau2-bench into a gitignored `.tau2/` | needs network |

```bash
# key-free: verify the engine, contracts, and fault injector
python3 -m unittest discover -s tests -v      # 7 tests, no deps, no key

# the live eval (needs tau2 + an API key + a few $)
./setup.sh
source .tau2/.venv/bin/activate
export OPENAI_API_KEY=sk-...
python3 run.py --domain retail --model gpt-4o-mini --tasks 5 --trials 2 --fault-p 0.3   # ~$0.05–0.20
```

## Two experiments

1. **Injected tool faults** (default) — WRITE tools silently fail at rate `p`; both arms get the *same*
   faults (paired seed); only the TrueCall arm catches + corrects. The clean, strong, live-agent version
   of the controlled bench: TrueCall should recover the pass@1 the silent failures cost.
2. **Premature-done gate** (`--no-faults`) — no injected faults; the generic contracts gate the agent's
   "done" on unmodified τ²-bench. Higher-value headline if it lifts, but expect a modest effect (native
   τ²-bench failures are mostly agent-reasoning, not tool silent-failures).

## The integrity line (non-negotiable)

The contracts in `contracts.py` are **generic** — "a write tool must change the world," "after cancel the
order is cancelled." They are written from domain knowledge, the way a developer would. They **never** read
the per-task `evaluation_criteria` / goal DB that τ²-bench scores against — feeding that oracle back to the
agent would be cheating and the result would be meaningless. The `db_changed` generic deliberately needs
*zero* per-task knowledge.

## Honest scope & how to report

A truthful headline reads like: *"On τ²-bench (retail) with WRITE-tool faults injected at p=0.3, TrueCall
recovered N pass@1 points (X% → Y%) by catching every silent failure and prompting the agent to retry —
0 false positives, over T trials, seed S."* Pin the tau2-bench commit (`cd .tau2 && git rev-parse HEAD`)
and the models/seed. Cite τ-bench (arXiv 2406.12045) and τ²-bench (arXiv 2506.07982); τ²-bench is MIT.
