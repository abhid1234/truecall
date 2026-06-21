# Phase 4 Design — Codex Adapter + Shared Hook Core + Honest Antigravity Stub

> **Status:** Phase 4 design (brainstorm output). Adds a real **OpenAI Codex CLI** adapter by extracting
> the harness-neutral PostToolUse logic into a shared package, leaving the Claude Code adapter as a thin
> wrapper. Antigravity stays an honest stub (no public hook API yet). Core (`packages/core`) is not modified.

## Goal

Prove TrueCall is genuinely cross-harness: **one** verifier and **one** contract format catch silent tool
failures in **both** Claude Code and Codex CLI, with only the install config differing. Update the
Antigravity stub to reflect reality (no usable post-tool hook API today).

## Background: the research finding (verified)

- **Codex CLI has real PostToolUse hooks.** Confirmed against the official docs
  (`developers.openai.com/codex/hooks`) AND the actual source in `openai/codex`
  (`codex-rs/hooks/src/events/post_tool_use.rs`, `HookEventName::PostToolUse`). The hook:
  - is configured in `config.toml` under `[[hooks.PostToolUse]]` (`matcher`) + `[[hooks.PostToolUse.hooks]]`
    (`type="command"`, `command`, `timeout`);
  - receives JSON on stdin with `tool_name`, `tool_input`, `tool_response` (plus `tool_use_id`, `turn_id`,
    `session_id`, `cwd`, `hook_event_name`);
  - feeds the agent back via `hookSpecificOutput.additionalContext` and/or `{ "decision": "block", "reason" }`
    (exit 0 with that JSON, or exit 2 with reason on stderr) — Codex replaces the tool result with the
    feedback and continues from it.
  - **Limitation (documented):** hooks reliably fire for Bash, not for `apply_patch` or most MCP tool calls.
- **This is nearly identical to Claude Code's PostToolUse contract.** The field names match
  (`tool_name`/`tool_input`/`tool_response`), and our existing `handleHookEvent` already reads
  `tool_output ?? tool_response`. So the verifier code is reusable as-is; only the install config differs.
- **Antigravity has no public post-tool hook API.** Real product, but invite-only with undocumented
  integration surfaces. A deterministic post-condition hook adapter cannot be built today.

## Architecture

The harness-neutral logic moves to a shared package; each harness package becomes a thin entry + install doc.

```
packages/adapters/
├── shared/                       # NEW — the harness-neutral PostToolUse verifier core
│   ├── package.json              # @truecall/adapter-core, zero deps
│   ├── tsconfig.json
│   ├── .gitignore
│   └── src/
│       ├── hook.ts               # handleHookEvent() — MOVED from claude-code
│       ├── registry.ts           # Binding, loadBindings() — MOVED
│       ├── bin.ts                # stdin -> handleHookEvent -> stdout — MOVED
│       ├── index.ts              # exports — MOVED
│       ├── hook.test.ts          # MOVED
│       ├── registry.test.ts      # MOVED
│       └── bin.test.ts           # MOVED (path to bin.ts updated)
├── claude-code/                  # now a THIN wrapper
│   ├── package.json
│   ├── tsconfig.json
│   ├── .gitignore
│   ├── README.md                 # unchanged (settings.json install)
│   └── src/
│       ├── bin.ts                # one line: import "../../shared/src/bin.ts";
│       └── index.ts              # re-export "../../shared/src/index.ts"
├── codex/                        # NEW real adapter (thin wrapper)
│   ├── package.json
│   ├── tsconfig.json
│   ├── .gitignore
│   ├── README.md                 # config.toml install
│   └── src/
│       ├── bin.ts                # import "../../shared/src/bin.ts";
│       ├── index.ts              # re-export "../../shared/src/index.ts"
│       └── bin.test.ts           # one e2e test: spawn codex bin -> blocks on a failing contract
└── antigravity/README.md         # honest stub (no public hook API)

docs/
└── demo-codex.md                 # the same save-note silent-failure caught in Codex (walkthrough)
```

### Why a shared package (not Codex importing claude-code)

The verifier is harness-neutral. If Codex imported `handleHookEvent` from a package named `claude-code`,
the dependency graph would literally say "Codex depends on Claude Code" — contradicting the cross-harness
thesis. Extracting `shared/` makes the structure honest: one neutral verifier, two thin harness adapters.
The move is mechanical (4 source files + 3 tests) and guarded by the existing suite.

### Delegation mechanics

`shared/src/bin.ts` runs `main().catch(...)` at top level (reads stdin, resolves the contracts module via
`TRUECALL_CONTRACTS` env or `./truecall.contracts.js`, runs the handler, writes any block JSON, exit 0).
Each harness `src/bin.ts` is a single side-effecting import:
```ts
import "../../shared/src/bin.ts";
```
So `claude-code/src/bin.ts` and `codex/src/bin.ts` both run the identical shared logic, while keeping a
stable, per-harness install path (so the Phase 3 live demo's `settings.json` — which points at
`claude-code/src/bin.ts` — needs no change). Import paths to core stay `../../../core/src/...` (the shared
package sits at the same depth as the old claude-code package).

### The block protocol works for both harnesses

`shared/bin.ts` emits, on exit 0:
`{"decision":"block","reason":<msg>,"hookSpecificOutput":{"hookEventName":"PostToolUse","additionalContext":<…>}}`.
Claude Code processes this on exit 0; Codex accepts the same `decision:"block"` + `additionalContext`
shape. No per-harness branching is needed in v1.

### Codex install (README + docs/demo-codex.md)

`~/.codex/config.toml` (or project `.codex/config.toml`):
```toml
[[hooks.PostToolUse]]
matcher = "Bash"

[[hooks.PostToolUse.hooks]]
type = "command"
command = "/ABSOLUTE/PATH/TO/truecall/packages/adapters/codex/node_modules/.bin/tsx /ABSOLUTE/PATH/TO/truecall/packages/adapters/codex/src/bin.ts"
timeout = 10
```
The contracts module is the same `truecall.contracts.js` format (default-export `Binding[]`). `docs/demo-codex.md`
walks through the *same* `save-note.sh` silent failure (from the Phase 3 example) being caught in Codex —
demonstrating one contract across two harnesses. README notes the Codex limitation: hooks fire for Bash,
not for `apply_patch`/MCP tool calls.

### Antigravity honest stub

`antigravity/README.md` states: Antigravity currently exposes no public post-tool hook / lifecycle API, so
a deterministic post-condition adapter cannot be built yet. It sketches the intended shape (map
Antigravity's tool call/result to a core `Ctx`, run `runContract`, surface the correction) and the MCP
fallback (register a verify tool the agent is instructed to call — weaker, not deterministic interception).
No placeholder code.

## Constraints (carried)

- **Zero-dependency**; only `node:*` + the workspace core by relative path.
- **Core untouched** (verified by diff).
- **Deterministic only**; no LLM-judge.
- **Cross-harness neutral:** the `shared/` package names no harness; `claude-code/` and `codex/` are the
  only harness-specific packages.
- **Test runner:** `tsx --test`; type-check `tsc --noEmit`.

## Testing

- `shared/`: the moved `hook.test.ts`, `registry.test.ts`, `bin.test.ts` all pass unchanged (bin.test's
  path to `bin.ts` is within `shared/src/`, so it resolves locally).
- `claude-code/`: still type-checks; its delegating `bin.ts` is exercised transitively (the Phase 3 demo
  path is unchanged). A re-run of the existing example tests confirms no regression.
- `codex/`: one end-to-end `bin.test.ts` — spawn `codex/src/bin.ts` with a fixture contracts module and a
  failing-contract hook input; assert it emits the block JSON. Proves the delegate runs the shared logic.
- Core: zero changes.

## Out of scope (later)

Real Antigravity adapter (blocked on its API); Codex MCP-tool interception (Codex limitation); auto-gen of
contracts; LLM-judge fallback.

## Acceptance

- The same contract format + verifier catches a silently-failing tool call in **both** Claude Code and
  Codex, with only the install config differing.
- The Codex adapter's delegate bin emits a `decision:"block"` correction on a failed post-condition (tested).
- `packages/core` unchanged; the Claude Code adapter's public behavior and install path are preserved.
- The Antigravity stub is honest about the current lack of a hook API.
