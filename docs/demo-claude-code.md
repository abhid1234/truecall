# Walkthrough: catching a silent failure in Claude Code

This is the live counterpart to the scripted demo (`examples/silent-failure/demo.ts`). It shows TrueCall's
PostToolUse hook catching a real silently-failing tool inside a Claude Code session.

## The setup

- The "tool" is `examples/silent-failure/claude-code/tools/save-note.sh`. It prints
  `{"status":"success","id":"..."}` but writes the note body to `/dev/null` instead of `notes/<id>.md`.
  It always *looks* like it worked.
- The contract (`truecall.contracts.js`) binds to Claude's `Bash` tool, and — only when the command
  contains `save-note.sh` (`when` guard) — asserts a non-empty `notes/<id>.md` exists afterward.
- The hook (`.claude/settings.json`, PostToolUse, matcher `Bash`) runs
  `packages/adapters/claude-code/src/bin.ts`, which loads the contract, runs the post-condition, and on
  failure returns a `decision:"block"` with the expected-vs-actual correction.

## Before / after

**Without TrueCall:** Claude runs `save-note.sh`, sees `status:"success"`, and reports the note saved.
Reality: `notes/` is empty. The task is silently broken and Claude has moved on.

**With TrueCall:** the same call triggers the hook. The post-condition (`notes/note1.md` exists) fails,
so Claude receives:

> TrueCall: `Bash` failed its post-condition. Expected: a non-empty notes/<id>.md exists after
> save-note.sh. Actual: predicate returned false. The tool reported success but the intended effect was
> not confirmed — correct it before continuing.

Claude stops trusting the false success and corrects the outcome (writes the note itself / fixes the
command), so the note actually lands.

## Why it matters

The agent never *saw* the failure — the tool returned success. A cheap deterministic post-condition
turned an invisible silent failure into an actionable correction, at runtime, with no model-confidence
guessing.
