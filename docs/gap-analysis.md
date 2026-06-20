# TrueCall — Gap Analysis (Phase 0)

> **Verdict: GO.** No open + cross-harness + runtime + deterministic post-condition verifier for agent
> tool calls exists today. The niche TrueCall targets is genuinely unoccupied.

*Phase 0 deliverable. Research only — no spec, no runtime code. Dated 2026-06-20.*

---

## Why this document exists

The TrueCall seed was produced by a deep-research pass whose adversarial-verification stage was
rate-limited before it finished. Phase 0's job: **adversarially re-confirm the gap** before committing
weeks of build. If anything already filled the niche, the project pivots.

**Method.** Three parallel read-only research agents (1: harness/protocol native — Claude Code,
Antigravity, Codex, MCP, OpenAI Agents SDK; 2: frameworks & verification products — LangGraph,
LlamaIndex, CrewAI, AutoGen, Cleanlab, Guardrails AI, Inspect; 3: npm/GitHub/arXiv direct-competitor
hunt + benchmark-stat verification). Every consequential claim was then **independently re-verified
against ground truth** — GitHub's API (`gh repo view`) for repo existence and recency, and direct
arXiv / raw-README fetches for the load-bearing distinctions. This guards against agents passing along
plausible-but-fabricated competitors, which is exactly the failure mode Phase 0 exists to catch. **All
repositories cited below were confirmed to exist and be active in 2026.**

---

## The niche, defined precisely

TrueCall claims a five-property combination that nothing else holds at once:

| Property | Definition (the bar a candidate must clear) |
|---|---|
| **Runtime** | Operates live, in production, mid-run — not an offline eval/benchmark. |
| **Verifies-real-intent** | Checks the world *actually changed* (file exists, DB row created, email record present) — not that the call returned `success`/200, and not that the output matches a schema. |
| **Deterministic** | A real post-condition check (query state, assert a predicate) — *not* an LLM judging whether the result "looks right" / confidence scoring. |
| **Cross-harness** | Works across multiple agent harnesses (Claude Code, Antigravity, Codex, …) — not locked to one vendor/framework. |
| **Open** | Open source / open spec. |

---

## Competitive map

Legend: ✓ yes · ✗ no · ~ partial.

| Candidate | Runtime | Real-intent | Deterministic | Cross-harness | Open | What it actually does |
|---|:--:|:--:|:--:|:--:|:--:|---|
| **TrueCall (target)** | ✓ | ✓ | ✓ | ✓ | ✓ | *The unoccupied niche.* |
| **Cleanlab TLM** | ✓ | ~ | ✗ | ✓ | ✗ | Trust/confidence scoring + fallback. **The incumbent.** Closed; LLM-confidence, not deterministic outcome check. |
| **PIC Standard** | ✓ | ✗ | ✓ | ✓ | ✓ | Provenance + intent contracts, **enforced before** the tool runs. Spec excludes post-execution. Complementary, not competitive. |
| **PCAA** (arXiv 2606.04104) | ~ | ✗ | ✓ | ✓ | ✗ | Proof-carrying **authorization / governance**; protected benchmark, bounded public disclosure. |
| **AgentWatch** | ✓ | ~ | ✗ | ✓ | ✓ | LLM reasoning-chain auditor; flags risk *before execution*. Scores, doesn't check post-state. |
| **Adrian** | ✓ | ~ | ✗ | ✓ | ✓ | Runtime **security** monitoring (injection, policy drift) via reasoning analysis. Not effect verification. |
| **AgentAudit** | ✓ | ~ | ~ | ✗ | ✓ | RAG **grounding / hallucination** check + retry suggestions. Domain-specific; not general tool-effect. |
| **Guardrails AI** | ✓ | ✗ | ~ | ✓ | ✓ | Output **format / content** validation (schema, toxicity). Not real-world effect. |
| **OpenAI Agents SDK guardrails** | ✓ | ✗ | ~ | ✗ | ✗ | Input/output tripwires validate or block calls. Does not verify the effect was achieved. |
| **MCP tool annotations** | ~ | ✗ | ✗ | ✓ | ✓ | Hints only. Spec is explicit: a server can assert `readOnlyHint:true` and still delete files. |
| **ClawMetry / Langfuse** | ✓ | ✗ | ✗ | ✓ | ✓ | Observability / tracing. Logs after the fact; no gate, no verify. |
| **Claude Code hooks** | ✓ | ✗ | ~ | ✗ | ✗ | PreToolUse/PostToolUse gate + log; no native effect verification. *This is TrueCall's adapter integration point.* |
| **Antigravity / Codex** | ✓ | ✗ | ✗ | ✗ | ✗ | No tool post-condition mechanism found. |
| **tau-bench / tau2-bench** | ✗ | ✓ | ✓ | ✓ | ✓ | **Offline** eval; compares end-state to goal-state. Source of the problem stats — not a runtime layer. |
| **ReliabilityBench** (arXiv 2601.06112) | ✗ | ✓ | ✓ | ~ | ✓ | **Offline** production-stress benchmark. |
| **Inspect** (UK AISI) | ✗ | ~ | ✓ | ✓ | ✓ | **Offline** eval framework. |

---

## How the field sorts (six buckets, none is the niche)

1. **Pre-execution gating** — authorize *before* the call: PIC Standard, PCAA, OpenAI guardrails (input side), AgentWatch.
2. **LLM-confidence / reasoning scoring** — "does the model *think* it's right": Cleanlab TLM, AgentWatch, Adrian.
3. **Observability only** — log, don't verify: ClawMetry, Langfuse.
4. **Offline eval benchmarks** — end-state vs goal-state, but not in production: tau-bench/tau2-bench, ReliabilityBench, Inspect.
5. **Output-format / content validation** — schema/toxicity, not real-world effect: Guardrails AI, OpenAI guardrails (output side).
6. **Untrusted hints** — no enforcement: MCP tool annotations.

The deterministic post-condition *concept* exists **offline** (tau-bench compares end-state to
goal-state), and the "a verification layer works" *claim* is validated **commercially** (Cleanlab cuts
agent failure ~50% on tau2-bench). What's missing is the combination: **runtime + deterministic + open
+ cross-harness.** That space is empty.

---

## Closest pressure (carry into the build)

- **Cleanlab TLM** — the genuine incumbent. Runtime + cross-harness + proven to cut failure, but
  **closed + confidence-based**. TrueCall's wedge is *deterministic outcome-check* vs. *"does the model
  feel confident."* That distinction is the whole differentiation — **pressure-test it in the v1 demo**;
  if it doesn't hold in practice, the moat narrows.
- **PIC Standard** — the strongest *open + cross-harness + deterministic* near-match, but it answers
  *"should this action run?"* (provenance/intent **before** execution), not *"did it actually work?"*
  (post-condition **after** execution). Confirmed against its own README: *"PIC is enforced at the
  moment before tool execution"*, with post-execution explicitly out of scope. This is a natural
  **defense-in-depth partner** (gate → execute → verify), not a competitor.

---

## Evidence notes (independently verified)

- **Problem stat — confirmed.** tau-bench (arXiv 2406.12045): SOTA function-calling agents succeed on
  <50% of real-world tool-use tasks; pass^8 drops below 25% in retail.
- **Fix-works stat — confirmed.** Cleanlab's verification/trust layer cuts agent failure rates ~50% on
  tau2-bench. (Validation that the category works — and that someone monetizes a *closed* version.)
- **Seed correction.** ReliabilityBench (arXiv 2601.06112) **does exist** — one research agent wrongly
  reported the ID unresolvable. Direct fetch confirmed the paper *"ReliabilityBench: Evaluating LLM
  Agent Reliability Under Production-Like Stress Conditions"* and the 96.9% pass@1 → 88.1% under-
  perturbation stat. The seed citation is valid.
- **Repo existence — confirmed via `gh repo view`** (all active 2026): `madeinplutofabio/pic-standard`,
  `sreerevanth/AgentWatch`, `secureagentics/Adrian`, `vivekchand/clawmetry`, `ZhangHanDong/agent-spec`,
  `jakops88-hub/AgentAudit-…`, `sierra-research/tau2-bench`, `cleanlab/tlm`, `guardrails-ai/guardrails`.

---

## Go / No-Go

**GO.** The gap holds. No open, cross-harness, runtime, deterministic post-condition verifier for agent
tool-use exists. The closest open neighbor (PIC) solves authorization, not outcomes; the closest
functional neighbor (Cleanlab) is closed and confidence-based. TrueCall's open + deterministic +
cross-harness + runtime combination is a defensible, unoccupied niche.

**Next:** Phase 1 — design the contract / post-condition format (`docs/spec.md`). Hold for greenlight.

---

## Primary sources

- tau-bench — https://arxiv.org/abs/2406.12045 · tau2-bench — https://github.com/sierra-research/tau2-bench
- ReliabilityBench — https://arxiv.org/abs/2601.06112
- PCAA — https://arxiv.org/abs/2606.04104
- Cleanlab — https://cleanlab.ai/blog/tau-bench/ · https://github.com/cleanlab/tlm
- PIC Standard — https://github.com/madeinplutofabio/pic-standard
- AgentWatch — https://github.com/sreerevanth/AgentWatch · Adrian — https://github.com/secureagentics/Adrian
- ClawMetry — https://github.com/vivekchand/clawmetry · agent-spec — https://github.com/ZhangHanDong/agent-spec
- AgentAudit — https://github.com/jakops88-hub/AgentAudit-AI-Grounding-Reliability-Check
- MCP tool annotations — https://blog.modelcontextprotocol.io/posts/2026-03-16-tool-annotations/
- OpenAI Agents SDK guardrails — https://openai.github.io/openai-agents-python/guardrails/
- Guardrails AI — https://github.com/guardrails-ai/guardrails · Inspect — https://github.com/UKGovernmentBEIS/inspect_evals
