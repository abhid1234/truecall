# Walkthrough: catching a silent failure in OpenAI Codex CLI

This mirrors the Claude Code walkthrough (`docs/demo-claude-code.md`) in a *different harness* — using the
**same** buggy tool and the **same** `truecall.contracts.js` contract. Only the install config changes.
That is the cross-harness thesis in practice: one verifier, one contract, two harnesses.

## The setup

- The buggy "tool" is `examples/silent-failure/claude-code/tools/save-note.sh` — it prints
  `{"status":"success","id":"..."}` but writes the note to `/dev/null`, so `notes/<id>.md` never appears.
- The contract is the same `examples/silent-failure/claude-code/truecall.contracts.js`: it binds to the
  `Bash` tool and (only when the command contains `save-note.sh`) asserts a non-empty `notes/<id>.md` exists.
- The hook is registered in Codex's `config.toml` instead of Claude Code's `settings.json`:

```toml
[[hooks.PostToolUse]]
matcher = "Bash"

[[hooks.PostToolUse.hooks]]
type = "command"
command = "/ABSOLUTE/PATH/TO/truecall/packages/adapters/codex/node_modules/.bin/tsx /ABSOLUTE/PATH/TO/truecall/packages/adapters/codex/src/bin.ts"
timeout = 10
```

(Replace `/ABSOLUTE/PATH/TO/truecall` with this repo's path. Run Codex from the demo folder so the contracts
module and `notes/` resolve against it, or set `TRUECALL_CONTRACTS` to an absolute path.)

## Before / after

**Without TrueCall:** ask Codex to run `bash tools/save-note.sh note1 "buy milk"`. Codex sees
`status:"success"` and reports the note saved — but `notes/note1.md` does not exist. Silently broken.

**With TrueCall:** the same call triggers the PostToolUse hook. Codex passes the tool result under
`tool_response`; the shared verifier (which reads `tool_output ?? tool_response`) runs the contract, finds
no `notes/note1.md`, and returns:

> TrueCall: `Bash` failed its post-condition. Expected: a non-empty notes/<id>.md exists after
> save-note.sh. Actual: predicate returned false. The tool reported success but the intended effect was not
> confirmed — correct it before continuing.

Codex replaces the tool result with this correction and continues from it, so the agent stops trusting the
false success and fixes the outcome.

## Why this matters

The same contract that caught the failure in Claude Code catches it in Codex, unchanged. The verifier is
harness-neutral; each adapter is a thin wrapper differing only in how the hook is registered.

## Note

Codex's PostToolUse hooks fire for `Bash` but not (yet) for `apply_patch`/MCP tool calls — a Codex
limitation. Bind contracts to `Bash` commands for now.
