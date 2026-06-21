# Codex Adapter + Shared Hook Core (Phase 4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a real OpenAI Codex CLI adapter by extracting the harness-neutral PostToolUse verifier into a shared package and making both Claude Code and Codex thin wrappers over it — proving one contract format catches silent failures across two harnesses. Antigravity stays an honest stub.

**Architecture:** Move the harness-neutral `hook.ts`/`registry.ts`/`bin.ts`/`index.ts` (+tests) out of `packages/adapters/claude-code` into `packages/adapters/shared`. Each harness package (`claude-code`, `codex`) becomes a one-line delegating `bin.ts` + a re-export `index.ts` + a harness-specific install README. `packages/core` is not modified.

**Tech Stack:** Same as the rest of the repo — TypeScript (`tsc --noEmit` typecheck), `.ts` tests via `tsx` (this Node lacks compiled TS support), `node:test`/`node:assert`, `node:*` builtins. Adapter packages import core by relative source path; the shared package sits at the same depth as the old `claude-code` package, so `../../../core/src/...` is unchanged across the move. Zero external deps.

## Global Constraints

- **Zero-dependency.** New `package.json` files have NO `dependencies`/`devDependencies`. `tsx`/`tsc`/`@types/node` come from a gitignored `node_modules` symlink to `~/.local/node_modules`.
- **Core untouched.** Do NOT modify any file under `packages/core/`. The final diff must show zero changes there.
- **Deterministic only.** No LLM-judge logic.
- **Cross-harness neutral.** The `shared/` package must reference NO harness (no "Claude Code"/"Codex"/"Antigravity" in its source). Only `claude-code/` and `codex/` are harness-specific.
- **Test runner:** `./node_modules/.bin/tsx --test <files>` (NOT `node --experimental-strip-types`). Type-check `tsc --noEmit`.
- **PostToolUse block protocol (works for both harnesses):** exit 0 + `{"decision":"block","reason":<string>,"hookSpecificOutput":{"hookEventName":"PostToolUse","additionalContext":<string>}}`. The shared `bin.ts` already emits exactly this.
- **Hook result field:** Claude Code uses `tool_output`; Codex uses `tool_response`. The shared `handleHookEvent` already reads `tool_output ?? tool_response` — do not change it.
- **License:** MIT.

## File Structure

```
packages/adapters/
├── shared/                       # NEW — harness-neutral verifier core
│   ├── package.json  tsconfig.json  .gitignore
│   └── src/{hook,registry,bin,index}.ts + {hook,registry,bin}.test.ts   # MOVED from claude-code
├── claude-code/                  # now thin
│   ├── package.json  tsconfig.json  .gitignore  README.md (mostly unchanged)
│   └── src/{bin.ts (delegate), index.ts (re-export), bin.test.ts (delegate e2e)}
├── codex/                        # NEW thin real adapter
│   ├── package.json  tsconfig.json  .gitignore  README.md (config.toml)
│   └── src/{bin.ts (delegate), index.ts (re-export), bin.test.ts (delegate e2e)}
└── antigravity/README.md         # honest stub (updated)

docs/demo-codex.md                # Codex walkthrough (same save-note silent failure)
```

Run a package's tests (from its dir): `./node_modules/.bin/tsx --test "src/**/*.test.ts"`. Type-check: `tsc --noEmit`.

---

### Task 1: Extract the shared package + make Claude Code a thin wrapper (atomic refactor)

This is one atomic task: moving the files out leaves `claude-code` temporarily broken, so rebuilding it as a thin wrapper happens in the same task. The tree is consistent and green at the task boundary.

**Files:**
- Create: `packages/adapters/shared/package.json`, `tsconfig.json`, `.gitignore`
- Move (git mv): `packages/adapters/claude-code/src/{hook.ts,registry.ts,bin.ts,index.ts,hook.test.ts,registry.test.ts,bin.test.ts}` → `packages/adapters/shared/src/`
- Create: `packages/adapters/claude-code/src/bin.ts`, `src/index.ts`, `src/bin.test.ts` (new thin versions)

**Interfaces:**
- The moved files keep their exports unchanged: `shared/src/index.ts` exports `handleHookEvent`, `loadBindings` (values) and `HookInput`, `Binding` (types). Their internal imports (`./hook.ts`, `./registry.ts`) and the core import (`../../../core/src/...`) resolve unchanged because `shared/src` is at the same directory depth as the old `claude-code/src`.

- [ ] **Step 1: Create the shared package manifest, tsconfig, .gitignore**

`packages/adapters/shared/package.json`:
```json
{
  "name": "@truecall/adapter-core",
  "version": "0.0.1",
  "description": "Harness-neutral PostToolUse verifier core for TrueCall adapters.",
  "license": "MIT",
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "tsx --test \"src/**/*.test.ts\""
  }
}
```

`packages/adapters/shared/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "verbatimModuleSyntax": true,
    "allowImportingTsExtensions": true,
    "noEmit": true,
    "skipLibCheck": true,
    "types": ["node"]
  },
  "include": ["src/**/*.ts"]
}
```

`packages/adapters/shared/.gitignore`:
```
node_modules
```

Then create the symlink (from `packages/adapters/shared/`):
```bash
ln -s ~/.local/node_modules node_modules
```

- [ ] **Step 2: Move the harness-neutral files into shared (preserve history)**

Run (from repo root):
```bash
git mv packages/adapters/claude-code/src/hook.ts          packages/adapters/shared/src/hook.ts
git mv packages/adapters/claude-code/src/registry.ts      packages/adapters/shared/src/registry.ts
git mv packages/adapters/claude-code/src/bin.ts           packages/adapters/shared/src/bin.ts
git mv packages/adapters/claude-code/src/index.ts         packages/adapters/shared/src/index.ts
git mv packages/adapters/claude-code/src/hook.test.ts     packages/adapters/shared/src/hook.test.ts
git mv packages/adapters/claude-code/src/registry.test.ts packages/adapters/shared/src/registry.test.ts
git mv packages/adapters/claude-code/src/bin.test.ts      packages/adapters/shared/src/bin.test.ts
```
Do NOT edit the moved files' contents — their relative imports remain valid at the new depth.

- [ ] **Step 3: Verify the shared package is green**

Run (from `packages/adapters/shared/`):
```bash
./node_modules/.bin/tsx --test "src/**/*.test.ts"
tsc --noEmit
```
Expected: all moved tests pass (registry 3 + hook 6 + bin 4 = 13), `tsc` clean.

- [ ] **Step 4: Write the Claude Code thin delegate + re-export + its e2e test**

`packages/adapters/claude-code/src/bin.ts`:
```ts
// Claude Code PostToolUse entry — delegates to the harness-neutral shared bin.
import "../../shared/src/bin.ts";
```

`packages/adapters/claude-code/src/index.ts`:
```ts
export { handleHookEvent, loadBindings } from "../../shared/src/index.ts";
export type { Binding, HookInput } from "../../shared/src/index.ts";
```

`packages/adapters/claude-code/src/bin.test.ts`:
```ts
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const tsx = join(here, "..", "node_modules", ".bin", "tsx");
const bin = join(here, "bin.ts");

function spawnBin(input: object, env: NodeJS.ProcessEnv): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(tsx, [bin], { env });
    let out = "";
    child.stdout.on("data", (d) => (out += d.toString()));
    child.on("error", reject);
    child.on("close", () => resolve(out.trim()));
    child.stdin.write(JSON.stringify(input));
    child.stdin.end();
  });
}

test("claude-code delegate bin emits block JSON on a failing post-condition", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tc-cc-"));
  const mod = join(dir, "contracts.mjs");
  await writeFile(mod, `export default [{ contract: { tool: "demo", post: { check: "result", path: "ok", equals: true } } }];`);
  try {
    const out = await spawnBin(
      { tool_name: "demo", tool_input: {}, tool_output: { ok: false } },
      { ...process.env, TRUECALL_CONTRACTS: mod },
    );
    assert.equal(JSON.parse(out).decision, "block");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 5: Verify Claude Code thin wrapper is green + no example regression**

Run (from `packages/adapters/claude-code/`):
```bash
./node_modules/.bin/tsx --test "src/**/*.test.ts"
tsc --noEmit
```
Expected: 1 test passes (delegate emits block), `tsc` clean.

Run (from `examples/silent-failure/`) to confirm the Phase 3 demo still resolves (the live demo's `settings.json` still points at `claude-code/src/bin.ts`, which now delegates):
```bash
./node_modules/.bin/tsx --test "**/*.test.ts"
```
Expected: 3 tests pass (unchanged).

- [ ] **Step 6: Confirm core untouched, then commit**

```bash
git -C "$(git rev-parse --show-toplevel)" diff --stat HEAD -- packages/core   # expect: empty
git add packages/adapters/shared packages/adapters/claude-code/src
git commit -m "refactor(adapters): extract harness-neutral hook core to @truecall/adapter-core

Moves hook/registry/bin/index (+tests) from claude-code into a shared package;
claude-code becomes a thin delegating wrapper. Same install path preserved.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Codex adapter package

**Files:**
- Create: `packages/adapters/codex/package.json`, `tsconfig.json`, `.gitignore`, `README.md`
- Create: `packages/adapters/codex/src/bin.ts`, `src/index.ts`
- Test: `packages/adapters/codex/src/bin.test.ts`

**Interfaces:**
- Consumes the shared bin/exports at `../../shared/src/...` (same relative path used by claude-code).

- [ ] **Step 1: Create the package manifest, tsconfig, .gitignore, symlink**

`packages/adapters/codex/package.json`:
```json
{
  "name": "@truecall/adapter-codex",
  "version": "0.0.1",
  "description": "OpenAI Codex CLI PostToolUse adapter for TrueCall — verifies tool calls achieved their intent.",
  "license": "MIT",
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "tsx --test \"src/**/*.test.ts\""
  }
}
```

`packages/adapters/codex/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "verbatimModuleSyntax": true,
    "allowImportingTsExtensions": true,
    "noEmit": true,
    "skipLibCheck": true,
    "types": ["node"]
  },
  "include": ["src/**/*.ts"]
}
```

`packages/adapters/codex/.gitignore`:
```
node_modules
```

Symlink (from `packages/adapters/codex/`):
```bash
ln -s ~/.local/node_modules node_modules
```

- [ ] **Step 2: Write the failing e2e test**

`packages/adapters/codex/src/bin.test.ts`:
```ts
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const tsx = join(here, "..", "node_modules", ".bin", "tsx");
const bin = join(here, "bin.ts");

function spawnBin(input: object, env: NodeJS.ProcessEnv): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(tsx, [bin], { env });
    let out = "";
    child.stdout.on("data", (d) => (out += d.toString()));
    child.on("error", reject);
    child.on("close", () => resolve(out.trim()));
    child.stdin.write(JSON.stringify(input));
    child.stdin.end();
  });
}

test("codex delegate bin emits block JSON on a failing post-condition (uses tool_response)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tc-codex-"));
  const mod = join(dir, "contracts.mjs");
  await writeFile(mod, `export default [{ contract: { tool: "demo", post: { check: "result", path: "ok", equals: true } } }];`);
  try {
    const out = await spawnBin(
      // Codex delivers the result under `tool_response`; the shared handler reads tool_output ?? tool_response.
      { tool_name: "demo", tool_input: {}, tool_response: { ok: false } },
      { ...process.env, TRUECALL_CONTRACTS: mod },
    );
    assert.equal(JSON.parse(out).decision, "block");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 3: Run the test, verify it fails**

Run (from `packages/adapters/codex/`): `./node_modules/.bin/tsx --test src/bin.test.ts`
Expected: FAIL — ENOENT on `bin.ts` (not created yet).

- [ ] **Step 4: Implement the delegate + re-export**

`packages/adapters/codex/src/bin.ts`:
```ts
// Codex CLI PostToolUse entry — delegates to the harness-neutral shared bin.
import "../../shared/src/bin.ts";
```

`packages/adapters/codex/src/index.ts`:
```ts
export { handleHookEvent, loadBindings } from "../../shared/src/index.ts";
export type { Binding, HookInput } from "../../shared/src/index.ts";
```

- [ ] **Step 5: Run the test, verify it passes**

Run: `./node_modules/.bin/tsx --test src/bin.test.ts`
Expected: PASS (1 test) — the Codex delegate emits the block correction, reading the result from `tool_response`.

- [ ] **Step 6: Write the Codex install README**

`packages/adapters/codex/README.md`:
````markdown
# @truecall/adapter-codex

Verifies that an **OpenAI Codex CLI** tool call achieved its real-world intent, using Codex's
**PostToolUse hook**. When a tool reports success but a TrueCall contract's post-condition fails, the hook
returns a `decision:"block"` correction so the agent self-corrects instead of trusting the false success.

This adapter shares its entire verifier with the Claude Code adapter (`@truecall/adapter-core`) — the same
`truecall.contracts.js` format works in both. Only the install config differs.

## 1. Declare contracts

Create `truecall.contracts.js` at your project root, default-exporting an array of bindings (identical to
the Claude Code adapter). A binding is `{ contract, when? }`:

```js
export default [
  {
    // only verify Bash calls that ran the deploy script; assert the build marker exists afterward
    contract: {
      tool: "Bash",
      description: "deploy produced the build marker",
      post: { check: "file_exists", path: "dist/BUILT", minSize: 1 },
    },
    when: (ctx) => String(ctx.args.command ?? "").includes("deploy.sh"),
  },
];
```

## 2. Register the hook in `config.toml`

In `~/.codex/config.toml` (global) or `<project>/.codex/config.toml` (project-scoped):

```toml
[[hooks.PostToolUse]]
matcher = "Bash"

[[hooks.PostToolUse.hooks]]
type = "command"
command = "/ABSOLUTE/PATH/TO/truecall/packages/adapters/codex/node_modules/.bin/tsx /ABSOLUTE/PATH/TO/truecall/packages/adapters/codex/src/bin.ts"
timeout = 10
```

Replace `/ABSOLUTE/PATH/TO/truecall` with this repo's absolute path. The hook reads `truecall.contracts.js`
from the project root (override with the `TRUECALL_CONTRACTS` env var). If no contracts module is found, the
hook is a no-op.

## Limitation

Codex's PostToolUse hooks reliably fire for **Bash** tool calls, but not for `apply_patch` file edits or
most MCP tool calls (a current Codex limitation, not a TrueCall one). Bind your contracts to `Bash`
commands for now.
````

- [ ] **Step 7: Type-check, confirm core untouched, commit**

```bash
tsc --noEmit
git -C "$(git rev-parse --show-toplevel)" diff --stat HEAD -- packages/core   # expect: empty
git add packages/adapters/codex
git commit -m "feat(adapter-codex): real Codex CLI PostToolUse adapter (delegates to shared core)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Honest Antigravity stub + Codex demo walkthrough

**Files:**
- Modify: `packages/adapters/antigravity/README.md` (replace the stub with an honest status)
- Create: `docs/demo-codex.md`

Docs only — no code, no tests. (The Codex behavior is already covered by Task 2's e2e test.)

- [ ] **Step 1: Rewrite the Antigravity stub honestly**

Replace the entire contents of `packages/adapters/antigravity/README.md` with:
````markdown
# @truecall/adapter-antigravity (not yet available)

**Status: blocked on a public API.** As of this writing, Google Antigravity exposes no documented
post-tool-execution hook or lifecycle-callback mechanism that an external integration can use to inspect a
tool call's result and feed a correction back to the agent (the equivalent of Claude Code's / Codex's
`PostToolUse` hook). Antigravity is currently invite-oriented with undocumented integration surfaces, so a
deterministic post-condition adapter cannot be built against it today — and we will not ship one that
pretends to.

## How it will plug in once an API exists

The verifier itself is harness-neutral (`@truecall/adapter-core`): it takes a `Ctx = { tool, args, result }`
and a set of contract bindings, runs `runContract`, and returns a structured correction. An Antigravity
adapter would be a thin wrapper — exactly like `claude-code` and `codex` — that:

1. receives Antigravity's tool name, arguments, and result from whatever post-execution surface it exposes;
2. maps them to a `Ctx` and calls the shared `handleHookEvent`;
3. surfaces the returned correction back to the agent in Antigravity's expected format.

## Interim fallback (weaker, not deterministic interception)

If Antigravity supports MCP servers or tool registration, TrueCall could be exposed as a `verify` tool the
agent is *instructed* to call after high-impact actions (e.g. via project rules). This relies on the agent
following instructions rather than a guaranteed post-execution hook, so it is a fallback — not the
deterministic, always-on verification the hook-based adapters provide. We will revisit when Antigravity
ships a documented hook/lifecycle API.
````

- [ ] **Step 2: Write the Codex demo walkthrough**

`docs/demo-codex.md`:
````markdown
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
````

- [ ] **Step 3: Commit**

```bash
git add packages/adapters/antigravity/README.md docs/demo-codex.md
git commit -m "docs: honest Antigravity stub + Codex cross-harness walkthrough

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**1. Spec coverage** (`docs/design-phase4-codex-adapter.md` → task):
- Shared package extraction (move 4 src + 3 tests) → Task 1. ✓
- Claude Code becomes thin delegate + re-export, install path preserved → Task 1. ✓
- Codex package (delegate bin, re-export, config.toml README, e2e test using `tool_response`) → Task 2. ✓
- Codex Bash-only limitation noted → Task 2 README + Task 3 demo. ✓
- Honest Antigravity stub → Task 3. ✓
- Codex cross-harness walkthrough → Task 3. ✓
- Core untouched → Tasks 1 & 2 verify `git diff packages/core` is empty. ✓
- Cross-harness-neutral shared package (no harness names in source) → shared/src is the moved neutral files (they name no harness). ✓

**2. Placeholder scan:** The Codex README + `docs/demo-codex.md` contain `/ABSOLUTE/PATH/TO/truecall` — intentional user-localized config (instructions say replace it), same convention as the Phase 3 Claude Code adapter. No unfinished code steps.

**3. Type consistency:** `handleHookEvent`, `loadBindings`, `Binding`, `HookInput` names are unchanged by the move and re-exported identically by both thin `index.ts` files. The delegate import path `../../shared/src/bin.ts` and core path `../../../core/src/...` are consistent across `shared`, `claude-code`, and `codex` (all at the same depth). The e2e tests use `spawnBin` identically; Claude's uses `tool_output`, Codex's uses `tool_response` (both handled by the shared reader).

## Notes
- Task 1 is an atomic refactor: the file move + claude-code rebuild are one commit so the tree is never left broken at a boundary.
- After Phase 4, the only thing standing between TrueCall and "3 harnesses" is Antigravity shipping a public hook API.
