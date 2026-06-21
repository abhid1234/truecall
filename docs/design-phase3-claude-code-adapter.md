# Phase 3 Design — Claude Code Adapter + Silent-Failure Demo

> **Status:** Phase 3 design (brainstorm output). Wires the Phase 2 core runtime into Claude Code via a
> PostToolUse hook, and proves the value with a deterministic scripted demo **and** a live-session
> walkthrough. Core (`packages/core`) is not modified — all harness specifics live in the adapter.

## Goal

When a Claude Code tool call returns success but didn't change the world, a TrueCall contract catches it
in a **PostToolUse hook** and feeds the agent a structured correction so it self-corrects — instead of
trusting the false success. Ship: the adapter, a deterministic before/after demo, and a live walkthrough.

## Background: the Claude Code hook contract (researched)

- **PostToolUse input (stdin JSON):** `tool_name`, `tool_input` (the call's args), and the tool result
  under `tool_output` (or `tool_response` in some versions — the adapter reads `tool_output ?? tool_response`).
  Also `cwd`, `session_id`.
- **Correcting the agent:** exit 0 and print to stdout:
  ```json
  {
    "decision": "block",
    "reason": "<one-line why the post-condition failed>",
    "hookSpecificOutput": {
      "hookEventName": "PostToolUse",
      "additionalContext": "<expected vs actual + remediation>"
    }
  }
  ```
  Claude blocks acting on the result, reads the reason, and self-corrects. On pass, the hook prints
  nothing and exits 0.
- **Config:** `settings.json` → `hooks.PostToolUse[]` with a `matcher` (tool-name regex) and a
  `command` (e.g. `tsx /abs/path/to/bin.ts`). Optional per-hook `timeout`.

This maps directly onto the core: `Ctx = { tool, args, result }` and `runContract → VerifyResult`.

## Architecture

```
packages/adapters/
├── claude-code/
│   ├── src/
│   │   ├── hook.ts        # PURE: handleHookEvent(input) -> string | null  (the block JSON, or null)
│   │   ├── registry.ts    # Binding type + loadBindings(modulePath) -> Binding[]
│   │   ├── bin.ts         # thin stdin -> handleHookEvent -> stdout wrapper (the hook command)
│   │   ├── index.ts       # exports
│   │   ├── hook.test.ts
│   │   └── registry.test.ts
│   ├── package.json       # @truecall/adapter-claude-code, zero deps, depends on core via path
│   ├── tsconfig.json
│   └── README.md          # install: the settings.json snippet
├── antigravity/README.md  # stub (Phase 4)
└── codex/README.md        # stub (Phase 4)

examples/silent-failure/
├── demo.ts                # scripted deterministic before/after (mock lying tool)
├── demo.test.ts           # asserts: without -> store empty; with -> store populated
└── claude-code/           # live-session demo project
    ├── tools/save-note.sh # buggy "tool": prints success, writes to /dev/null
    ├── truecall.contracts.js
    ├── .claude/settings.json
    └── README.md          # the live walkthrough steps

docs/
├── demo-claude-code.md    # the live walkthrough (prose)
└── demo-video-script.md   # the 30-sec before/after script
```

### Component contracts

**`hook.ts` — the pure heart (harness-agnostic-as-possible, testable without I/O):**
```ts
type HookInput = {
  tool_name: string;
  tool_input?: Record<string, unknown>;
  tool_output?: unknown;
  tool_response?: unknown;   // version fallback
};

// Returns the stdout string to emit (block JSON), or null to emit nothing (pass / no contract / verifier handled).
async function handleHookEvent(input: HookInput, bindings: Binding[]): Promise<string | null>;
```
Behavior:
1. Build `ctx = { tool: input.tool_name, args: input.tool_input ?? {}, result: input.tool_output ?? input.tool_response }`.
2. Select bindings whose `contract.tool === ctx.tool` AND (`when` absent OR `when(ctx) === true`). If none → return `null`.
3. For each selected contract, `runContract(contract, ctx)`. On the FIRST non-ok result, build and return the
   block JSON. (Multiple matching contracts all evaluated; first failure wins.)
4. All pass → return `null`.
5. The block JSON's `reason` = `signal.message`; `additionalContext` = `expected: … / actual: … / try: <remediation>`.
   A fail-closed `error:true` signal is surfaced the same way (Claude is told it could not be verified).

**`registry.ts` — adapter-level binding (keeps the core spec unchanged):**
```ts
type Binding = { contract: Contract; when?: (ctx: Ctx) => boolean };
// loadBindings(modulePath): dynamic-import the user's truecall.contracts.js, expect `export default Binding[]`
// (or a bare Contract[], coerced to bindings with no `when`).
async function loadBindings(modulePath: string): Promise<Binding[]>;
```
The `when` guard exists because Claude routes many distinct operations through one tool name (notably
`Bash`); a binding can say "only verify `Bash` calls whose `args.command` includes `save-note`."

**`bin.ts` — the command Claude Code runs:**
Reads all of stdin, `JSON.parse`, resolves the contracts module (default `./truecall.contracts.js`
relative to `cwd`, overridable via `TRUECALL_CONTRACTS` env), calls `handleHookEvent`, writes the
returned string (if any) to stdout, exits 0. Any internal error → exit 0 with a fail-closed block JSON
("TrueCall hook error: …") so a broken hook never silently disables verification.

### Demo B — scripted deterministic (`examples/silent-failure/demo.ts`)

A mock store + a buggy tool:
```ts
const store = new Map<string, {id:string; body:string}>();
// BUG: returns success but never writes to `store`
const saveRecordBuggy = async (a) => ({ status: "success", id: a.id });
```
- **WITHOUT TrueCall:** call `saveRecordBuggy` → `{status:"success"}` → print "Agent: saved ✅" →
  `store.has(id)` is false → print "Reality: ❌ record missing — silent failure."
- **WITH TrueCall:** `wrapTool(contract({ tool:"save_record", post:{ verify: ({args}) => store.has(args.id), describe:"record persisted in store" }}), saveRecordBuggy)`.
  Call → `{ok:false, signal}` → print the correction → a 3-line "agent" reacts by calling the FIXED
  writer (`store.set(...)`) → re-verify → `{ok:true}` → "Reality: ✅ record present."
- `demo.test.ts` asserts the two end states (empty vs populated), so the demo's narrative is test-backed.

### Demo C — live Claude Code walkthrough (`examples/silent-failure/claude-code/`)

- `tools/save-note.sh "<id>" "<text>"` — **buggy:** echoes `{"status":"success"}` but redirects the
  write to `/dev/null` (so `notes/<id>.md` never appears).
- `truecall.contracts.js` (default export). Because the note id lives inside the `Bash` command string
  (not a discrete arg), the binding uses a custom `verify` fn that parses the id from `ctx.args.command`
  and checks the file — cleaner than templating out of a command line:
  ```js
  export default [{
    contract: {
      tool: "Bash",
      description: "save-note.sh created the note file",
      post: {
        verify: async ({ args }) => {
          const id = String(args.command ?? "").match(/save-note\.sh\s+"?(\w+)"?/)?.[1];
          if (!id) return false;
          const { stat } = await import("node:fs/promises");
          return await stat(`notes/${id}.md`).then((s) => s.size > 0, () => false);
        },
        describe: "a non-empty notes/<id>.md exists after save-note.sh",
      },
    },
    when: (ctx) => String(ctx.args.command ?? "").includes("save-note.sh"),
  }];
  ```
- `.claude/settings.json`: PostToolUse, `matcher: "Bash"`, `command: "tsx <abs>/packages/adapters/claude-code/src/bin.ts"`.
- **Walkthrough (`docs/demo-claude-code.md`):** ask Claude to "save a note"; with the hook disabled it
  reports success but `notes/` stays empty (silent failure); enable the hook and repeat — PostToolUse
  blocks with the correction, and Claude self-corrects. This is the basis for `docs/demo-video-script.md`.

## Constraints (carried from the project)

- **Zero-dependency.** Adapter and demo use only `node:*` + the workspace `@truecall/core`. No external npm.
- **Core untouched.** `packages/core` is not modified in Phase 3 (verified by diff).
- **Deterministic.** No LLM-judge anywhere; the scripted demo and tests are fully deterministic.
- **Cross-harness neutral.** Only `packages/adapters/claude-code` knows about Claude Code; Antigravity/Codex are stubs.
- **Test runner:** `tsx --test` (this Node lacks compiled TS support); type-check with `tsc --noEmit`.

## Testing

- `hook.test.ts`: pass case (contract holds → `null`), fail case (contract fails → block JSON with the
  right `decision`/`reason`/`additionalContext`), no-matching-contract (→ `null`), `when`-guard filters
  correctly, `tool_response` fallback honored, fail-closed error surfaced.
- `registry.test.ts`: loads a `Binding[]` module; coerces a bare `Contract[]`; missing module → clear error.
- `demo.test.ts`: without-path leaves the store empty; with-path populates it.
- Live walkthrough is manual (documented), not automated.

## Out of scope (Phase 4+)

Real Antigravity/Codex adapters (stubs only here); auto-generating contracts from tool schemas; a hosted
dashboard; LLM-judge fallback.

## Acceptance

- A Claude Code tool call that returns success but didn't change state is caught by the PostToolUse hook,
  which emits a `decision:"block"` correction the agent can act on.
- The scripted demo shows the before/after deterministically and is test-backed.
- The live walkthrough + video script let someone reproduce the catch in a real session.
- Same core contract format verifies the call; `packages/core` unchanged.
