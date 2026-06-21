# Claude Code Adapter + Silent-Failure Demo (Phase 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the Phase 2 core runtime into Claude Code via a PostToolUse hook, and prove it with a deterministic scripted demo plus a live-session walkthrough — without modifying `packages/core`.

**Architecture:** A new zero-dep package `packages/adapters/claude-code` whose pure `handleHookEvent(input, bindings)` maps Claude's hook JSON to a core `Ctx`, runs `runContract`, and returns a `decision:"block"` correction on silent failure. A thin `bin.ts` wraps stdin→stdout. A `Binding = { contract, when? }` registry (loaded from a user `truecall.contracts.js`) handles Claude routing many ops through one tool name. Two demos under `examples/silent-failure/`: a test-backed scripted before/after, and a live Claude Code project.

**Tech Stack:** Same as core — TypeScript (type-check via `tsc --noEmit`), `.ts` tests run with `tsx` (this Node build lacks compiled TS support), `node:test`/`node:assert`, `node:*` builtins. Adapter imports core by **relative path to source** (`../../../core/src/...`) — no install, no build. Zero external deps.

## Global Constraints

- **Zero-dependency.** New `package.json` files have NO `dependencies`/`devDependencies`. `tsx`/`tsc`/`@types/node` come from a gitignored `node_modules` symlink to `~/.local/node_modules`, never an install.
- **Core untouched.** Do NOT modify any file under `packages/core/`. The final diff must show zero changes there.
- **Deterministic only.** No LLM-judge logic. The scripted demo and all tests are deterministic.
- **Cross-harness neutral.** Only `packages/adapters/claude-code` references Claude Code. Antigravity/Codex are stub READMEs.
- **Test runner:** `./node_modules/.bin/tsx --test <files>` (NOT `node --experimental-strip-types` — it fails with `ERR_NO_TYPESCRIPT` on this machine). Type-check with `tsc --noEmit`.
- **PostToolUse block protocol (exact):** exit 0 and print `{"decision":"block","reason":<string>,"hookSpecificOutput":{"hookEventName":"PostToolUse","additionalContext":<string>}}`. Print nothing on pass.
- **Hook input fields (exact):** `tool_name`, `tool_input`, and the result under `tool_output` (fall back to `tool_response`).
- **License:** MIT.

## File Structure

```
packages/adapters/
├── claude-code/
│   ├── package.json
│   ├── tsconfig.json
│   ├── .gitignore                 # node_modules
│   ├── README.md                  # install: settings.json snippet
│   └── src/
│       ├── registry.ts            # Binding, loadBindings()
│       ├── hook.ts                # handleHookEvent() — pure
│       ├── bin.ts                 # stdin -> handleHookEvent -> stdout
│       ├── index.ts               # exports
│       ├── registry.test.ts
│       ├── hook.test.ts
│       └── bin.test.ts
├── antigravity/README.md          # stub (Phase 4)
└── codex/README.md                # stub (Phase 4)

examples/silent-failure/
├── .gitignore                     # node_modules
├── tsconfig.json
├── demo.ts
├── demo.test.ts
└── claude-code/
    ├── tools/save-note.sh         # buggy tool
    ├── save-note.test.ts          # proves the bug (note file not created)
    ├── truecall.contracts.js
    ├── .claude/settings.json
    └── README.md

docs/
├── demo-claude-code.md            # live walkthrough
└── demo-video-script.md           # 30-sec before/after script
```

Run a package's tests (from that package dir): `./node_modules/.bin/tsx --test "src/**/*.test.ts"` (or a specific file).
Type-check (from that package dir): `tsc --noEmit`.

---

### Task 1: Adapter scaffold + registry

**Files:**
- Create: `packages/adapters/claude-code/package.json`, `tsconfig.json`, `.gitignore`
- Create: `packages/adapters/claude-code/src/registry.ts`
- Test: `packages/adapters/claude-code/src/registry.test.ts`

**Interfaces:**
- Consumes: `Contract`, `Ctx` from core (`../../../core/src/types.ts`).
- Produces: `type Binding = { contract: Contract; when?: (ctx: Ctx) => boolean }`; `loadBindings(moduleUrl: string): Promise<Binding[]>` — dynamic-imports a module whose default export is `Binding[]` or a bare `Contract[]` (coerced to bindings with no `when`); throws a clear error if the export isn't an array.

- [ ] **Step 1: Create package manifest**

`packages/adapters/claude-code/package.json`:
```json
{
  "name": "@truecall/adapter-claude-code",
  "version": "0.0.1",
  "description": "Claude Code PostToolUse adapter for TrueCall — verifies tool calls achieved their intent.",
  "license": "MIT",
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "tsx --test \"src/**/*.test.ts\""
  }
}
```

- [ ] **Step 2: Create tsconfig and .gitignore, and the node_modules symlink**

`packages/adapters/claude-code/tsconfig.json`:
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

`packages/adapters/claude-code/.gitignore`:
```
node_modules
```

Run (from `packages/adapters/claude-code/`):
```bash
ln -s ~/.local/node_modules node_modules
```

- [ ] **Step 3: Write the failing test**

`packages/adapters/claude-code/src/registry.test.ts`:
```ts
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { loadBindings } from "./registry.ts";

async function moduleFrom(source: string): Promise<{ url: string; dir: string }> {
  const dir = await mkdtemp(join(tmpdir(), "tc-reg-"));
  const file = join(dir, "contracts.mjs");
  await writeFile(file, source);
  return { url: pathToFileURL(file).href, dir };
}

test("loads a Binding[] default export", async () => {
  const { url, dir } = await moduleFrom(
    `export default [{ contract: { tool: "Bash", post: { check: "result", path: "ok", equals: true } }, when: (c) => true }];`,
  );
  const bindings = await loadBindings(url);
  assert.equal(bindings.length, 1);
  assert.equal(bindings[0].contract.tool, "Bash");
  assert.equal(typeof bindings[0].when, "function");
  await rm(dir, { recursive: true, force: true });
});

test("coerces a bare Contract[] default export to bindings", async () => {
  const { url, dir } = await moduleFrom(
    `export default [{ tool: "Write", post: { check: "file_exists", path: "{{args.path}}" } }];`,
  );
  const bindings = await loadBindings(url);
  assert.equal(bindings.length, 1);
  assert.equal(bindings[0].contract.tool, "Write");
  assert.equal(bindings[0].when, undefined);
  await rm(dir, { recursive: true, force: true });
});

test("throws a clear error when the export is not an array", async () => {
  const { url, dir } = await moduleFrom(`export default { nope: true };`);
  await assert.rejects(() => loadBindings(url), /must default-export an array/);
  await rm(dir, { recursive: true, force: true });
});
```

- [ ] **Step 4: Run the test, verify it fails**

Run (from `packages/adapters/claude-code/`): `./node_modules/.bin/tsx --test src/registry.test.ts`
Expected: FAIL — `Cannot find module './registry.ts'`.

- [ ] **Step 5: Implement the registry**

`packages/adapters/claude-code/src/registry.ts`:
```ts
import type { Contract, Ctx } from "../../../core/src/types.ts";

export type Binding = { contract: Contract; when?: (ctx: Ctx) => boolean };

export async function loadBindings(moduleUrl: string): Promise<Binding[]> {
  let mod: Record<string, unknown>;
  try {
    mod = (await import(moduleUrl)) as Record<string, unknown>;
  } catch (e) {
    throw new Error(`TrueCall: could not load contracts module "${moduleUrl}": ${(e as Error).message}`);
  }
  const raw = (mod.default ?? mod.bindings ?? mod.contracts) as unknown;
  if (!Array.isArray(raw)) {
    throw new Error(
      `TrueCall: contracts module "${moduleUrl}" must default-export an array of bindings or contracts`,
    );
  }
  return raw.map((item) => {
    if (item && typeof item === "object" && "contract" in item) {
      const b = item as { contract: Contract; when?: (ctx: Ctx) => boolean };
      return { contract: b.contract, when: b.when };
    }
    return { contract: item as Contract };
  });
}
```

- [ ] **Step 6: Run the test, verify it passes**

Run: `./node_modules/.bin/tsx --test src/registry.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 7: Type-check and commit**

```bash
tsc --noEmit
git add packages/adapters/claude-code/package.json packages/adapters/claude-code/tsconfig.json packages/adapters/claude-code/.gitignore packages/adapters/claude-code/src/registry.ts packages/adapters/claude-code/src/registry.test.ts
git commit -m "feat(adapter-cc): scaffold + binding registry

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: The pure hook handler

**Files:**
- Create: `packages/adapters/claude-code/src/hook.ts`
- Test: `packages/adapters/claude-code/src/hook.test.ts`

**Interfaces:**
- Consumes: `runContract` from core (`../../../core/src/index.ts`); `Ctx`, `VerifyResult` from core types; `Binding` from `./registry.ts`.
- Produces: `type HookInput = { tool_name: string; tool_input?: Record<string, unknown>; tool_output?: unknown; tool_response?: unknown }`; `handleHookEvent(input: HookInput, bindings: Binding[]): Promise<string | null>` — returns the block-JSON string on the first failing applicable contract, else `null`.

- [ ] **Step 1: Write the failing test**

`packages/adapters/claude-code/src/hook.test.ts`:
```ts
import test from "node:test";
import assert from "node:assert/strict";
import { handleHookEvent, type HookInput } from "./hook.ts";
import type { Binding } from "./registry.ts";

const passBinding: Binding = {
  contract: { tool: "demo", post: { check: "result", path: "ok", equals: true } },
};
const failBinding: Binding = {
  contract: { tool: "demo", post: { check: "result", path: "ok", equals: true } },
};

test("returns null when the post-condition holds", async () => {
  const input: HookInput = { tool_name: "demo", tool_input: {}, tool_output: { ok: true } };
  assert.equal(await handleHookEvent(input, [passBinding]), null);
});

test("returns block JSON when the post-condition fails", async () => {
  const input: HookInput = { tool_name: "demo", tool_input: {}, tool_output: { ok: false } };
  const out = await handleHookEvent(input, [failBinding]);
  assert.ok(out, "expected a non-null block string");
  const parsed = JSON.parse(out as string);
  assert.equal(parsed.decision, "block");
  assert.equal(parsed.hookSpecificOutput.hookEventName, "PostToolUse");
  assert.match(parsed.reason, /post-condition failed/);
  assert.match(parsed.hookSpecificOutput.additionalContext, /Expected:/);
});

test("returns null when no binding matches the tool name", async () => {
  const input: HookInput = { tool_name: "other", tool_input: {}, tool_output: { ok: false } };
  assert.equal(await handleHookEvent(input, [failBinding]), null);
});

test("a when() guard that returns false skips the contract", async () => {
  const guarded: Binding = { ...failBinding, when: () => false };
  const input: HookInput = { tool_name: "demo", tool_input: {}, tool_output: { ok: false } };
  assert.equal(await handleHookEvent(input, [guarded]), null);
});

test("falls back to tool_response when tool_output is absent", async () => {
  const input: HookInput = { tool_name: "demo", tool_input: {}, tool_response: { ok: false } };
  const out = await handleHookEvent(input, [failBinding]);
  assert.ok(out);
  assert.equal(JSON.parse(out as string).decision, "block");
});

test("a fail-closed verifier error is surfaced as a block", async () => {
  const errBinding: Binding = {
    contract: { tool: "demo", post: { verify: () => { throw new Error("boom"); }, describe: "x" } },
  };
  const input: HookInput = { tool_name: "demo", tool_input: {}, tool_output: {} };
  const out = await handleHookEvent(input, [errBinding]);
  assert.ok(out);
  const parsed = JSON.parse(out as string);
  assert.equal(parsed.decision, "block");
  assert.match(parsed.hookSpecificOutput.additionalContext, /could not be verified/);
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `./node_modules/.bin/tsx --test src/hook.test.ts`
Expected: FAIL — `Cannot find module './hook.ts'`.

- [ ] **Step 3: Implement the hook handler**

`packages/adapters/claude-code/src/hook.ts`:
```ts
import type { Ctx, VerifyResult } from "../../../core/src/types.ts";
import { runContract } from "../../../core/src/index.ts";
import type { Binding } from "./registry.ts";

export type HookInput = {
  tool_name: string;
  tool_input?: Record<string, unknown>;
  tool_output?: unknown;
  tool_response?: unknown;
};

export async function handleHookEvent(input: HookInput, bindings: Binding[]): Promise<string | null> {
  const ctx: Ctx = {
    tool: input.tool_name,
    args: input.tool_input ?? {},
    result: input.tool_output ?? input.tool_response,
  };
  const applicable = bindings.filter(
    (b) => b.contract.tool === ctx.tool && (b.when === undefined || b.when(ctx)),
  );
  if (applicable.length === 0) return null;

  for (const b of applicable) {
    const v = await runContract(b.contract, ctx);
    if (!v.ok) return JSON.stringify(blockOutput(v));
  }
  return null;
}

function blockOutput(v: Extract<VerifyResult, { ok: false }>): unknown {
  const remediation = v.remediation ? ` Try: ${v.remediation}` : "";
  const kind = v.error ? "could not be verified" : "failed its post-condition";
  return {
    decision: "block",
    reason: v.message,
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      additionalContext:
        `TrueCall: \`${v.tool}\` ${kind}. Expected: ${v.expected}. Actual: ${v.actual}.${remediation} ` +
        `The tool reported success but the intended effect was not confirmed — correct it before continuing.`,
    },
  };
}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `./node_modules/.bin/tsx --test src/hook.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Type-check and commit**

```bash
tsc --noEmit
git add packages/adapters/claude-code/src/hook.ts packages/adapters/claude-code/src/hook.test.ts
git commit -m "feat(adapter-cc): pure PostToolUse handler -> block-on-silent-failure

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: CLI entry (`bin.ts`) + public exports + README

**Files:**
- Create: `packages/adapters/claude-code/src/bin.ts`, `src/index.ts`, `README.md`
- Test: `packages/adapters/claude-code/src/bin.test.ts`

**Interfaces:**
- Consumes: `handleHookEvent`, `HookInput` from `./hook.ts`; `loadBindings` from `./registry.ts`.
- Produces: an executable entry that reads the hook JSON from stdin, resolves the contracts module (`TRUECALL_CONTRACTS` env, else `./truecall.contracts.js` relative to cwd), and writes the block JSON (if any) to stdout, exit 0. `index.ts` re-exports `handleHookEvent`, `loadBindings`, and the `Binding`/`HookInput` types.

- [ ] **Step 1: Write the failing test**

`packages/adapters/claude-code/src/bin.test.ts`:
```ts
import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const pexec = promisify(execFile);
const here = fileURLToPath(new URL(".", import.meta.url));
const tsx = join(here, "..", "node_modules", ".bin", "tsx");
const bin = join(here, "bin.ts");

async function runBin(input: object, contractsSource: string) {
  const dir = await mkdtemp(join(tmpdir(), "tc-bin-"));
  const mod = join(dir, "contracts.mjs");
  await writeFile(mod, contractsSource);
  const res = await pexec(tsx, [bin], {
    env: { ...process.env, TRUECALL_CONTRACTS: mod },
    input: JSON.stringify(input),
  } as never);
  await rm(dir, { recursive: true, force: true });
  return res.stdout.trim();
}

const FAIL_CONTRACTS = `export default [{ contract: { tool: "demo", post: { check: "result", path: "ok", equals: true } } }];`;

test("bin emits block JSON on a failing post-condition", async () => {
  const out = await runBin({ tool_name: "demo", tool_input: {}, tool_output: { ok: false } }, FAIL_CONTRACTS);
  assert.equal(JSON.parse(out).decision, "block");
});

test("bin emits nothing on a passing post-condition", async () => {
  const out = await runBin({ tool_name: "demo", tool_input: {}, tool_output: { ok: true } }, FAIL_CONTRACTS);
  assert.equal(out, "");
});

test("bin emits nothing when no contract matches", async () => {
  const out = await runBin({ tool_name: "unmatched", tool_input: {}, tool_output: {} }, FAIL_CONTRACTS);
  assert.equal(out, "");
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `./node_modules/.bin/tsx --test src/bin.test.ts`
Expected: FAIL — `Cannot find module './bin.ts'` (or ENOENT on the bin path).

- [ ] **Step 3: Implement `bin.ts`**

`packages/adapters/claude-code/src/bin.ts`:
```ts
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { handleHookEvent, type HookInput } from "./hook.ts";
import { loadBindings, type Binding } from "./registry.ts";

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

async function main(): Promise<void> {
  const raw = await readStdin();
  let input: HookInput;
  try {
    input = JSON.parse(raw) as HookInput;
  } catch {
    return; // malformed hook input: do nothing
  }

  const modPath = process.env.TRUECALL_CONTRACTS ?? resolve(process.cwd(), "truecall.contracts.js");
  let bindings: Binding[];
  try {
    bindings = await loadBindings(pathToFileURL(modPath).href);
  } catch (e) {
    // No (or unloadable) contracts module = verification not configured here. Don't block tool calls.
    process.stderr.write(`${(e as Error).message}\n`);
    return;
  }

  const out = await handleHookEvent(input, bindings);
  if (out) process.stdout.write(out);
}

main().catch((e) => {
  // Unexpected failure: fail-closed so a broken hook doesn't silently disable verification.
  process.stdout.write(
    JSON.stringify({
      decision: "block",
      reason: `TrueCall hook error: ${(e as Error).message}`,
      hookSpecificOutput: {
        hookEventName: "PostToolUse",
        additionalContext: "TrueCall could not run its post-condition check; verify the tool's effect manually.",
      },
    }),
  );
});
```

- [ ] **Step 4: Implement `index.ts`**

`packages/adapters/claude-code/src/index.ts`:
```ts
export { handleHookEvent } from "./hook.ts";
export type { HookInput } from "./hook.ts";
export { loadBindings } from "./registry.ts";
export type { Binding } from "./registry.ts";
```

- [ ] **Step 5: Run the test, verify it passes**

Run: `./node_modules/.bin/tsx --test src/bin.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Write the README (install instructions)**

`packages/adapters/claude-code/README.md`:
````markdown
# @truecall/adapter-claude-code

Verifies that a Claude Code tool call achieved its real-world intent, using a **PostToolUse hook**.
When a tool reports success but a TrueCall contract's post-condition fails, the hook returns a
`decision:"block"` correction so the agent self-corrects instead of trusting the false success.

## 1. Declare contracts

Create `truecall.contracts.js` at your project root, default-exporting an array of bindings:

```js
export default [
  {
    // verify Claude's Write tool actually produced a non-empty file
    contract: {
      tool: "Write",
      description: "Write created a non-empty file",
      post: { check: "file_exists", path: "{{args.file_path}}", minSize: 1 },
    },
  },
];
```

A binding is `{ contract, when? }`. The optional `when(ctx)` predicate disambiguates tools that route
many operations through one name (e.g. only verify `Bash` calls whose `args.command` matches a pattern).

## 2. Register the hook

In `.claude/settings.json`:

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Write|Edit|Bash",
        "hooks": [
          { "type": "command", "command": "/ABSOLUTE/PATH/TO/truecall/packages/adapters/claude-code/node_modules/.bin/tsx /ABSOLUTE/PATH/TO/truecall/packages/adapters/claude-code/src/bin.ts" }
        ]
      }
    ]
  }
}
```

Replace `/ABSOLUTE/PATH/TO/truecall` with this repo's absolute path. Set `matcher` to the tools your
contracts cover. The hook reads `truecall.contracts.js` from the project root (override with the
`TRUECALL_CONTRACTS` env var). If no contracts module is found, the hook is a no-op.
````

- [ ] **Step 7: Type-check and commit**

```bash
tsc --noEmit
git add packages/adapters/claude-code/src/bin.ts packages/adapters/claude-code/src/index.ts packages/adapters/claude-code/src/bin.test.ts packages/adapters/claude-code/README.md
git commit -m "feat(adapter-cc): bin entry + exports + install README

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Scripted deterministic demo

**Files:**
- Create: `examples/silent-failure/demo.ts`, `tsconfig.json`, `.gitignore`
- Test: `examples/silent-failure/demo.test.ts`

**Interfaces:**
- Consumes: `contract`, `wrapTool` from core (`../../packages/core/src/index.ts`).
- Produces: `runWithout(store): Promise<{reported, persisted}>` and `runWith(store): Promise<{corrected, persisted, signal?}>`, plus a `main()` that prints the before/after when run directly.

- [ ] **Step 1: Create tsconfig, .gitignore, and the node_modules symlink**

`examples/silent-failure/tsconfig.json`:
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
  "include": ["**/*.ts"]
}
```

`examples/silent-failure/.gitignore`:
```
node_modules
```

Run (from `examples/silent-failure/`):
```bash
ln -s ~/.local/node_modules node_modules
```

- [ ] **Step 2: Write the failing test**

`examples/silent-failure/demo.test.ts`:
```ts
import test from "node:test";
import assert from "node:assert/strict";
import { runWithout, runWith } from "./demo.ts";

test("WITHOUT TrueCall: tool reports success but nothing persists", async () => {
  const store = new Map<string, { id: string; body: string }>();
  const r = await runWithout(store);
  assert.equal(r.reported, "success");
  assert.equal(r.persisted, false);
});

test("WITH TrueCall: silent failure is caught and corrected; record persists", async () => {
  const store = new Map<string, { id: string; body: string }>();
  const r = await runWith(store);
  assert.equal(r.corrected, true);
  assert.equal(r.persisted, true);
});
```

- [ ] **Step 3: Run the test, verify it fails**

Run (from `examples/silent-failure/`): `./node_modules/.bin/tsx --test demo.test.ts`
Expected: FAIL — `Cannot find module './demo.ts'`.

- [ ] **Step 4: Implement the demo**

`examples/silent-failure/demo.ts`:
```ts
import { fileURLToPath } from "node:url";
import { contract, wrapTool } from "../../packages/core/src/index.ts";

export type Store = Map<string, { id: string; body: string }>;

// A tool with the tau-bench "silent success" bug: returns success but never persists.
function buggySaveRecord(_args: Record<string, unknown>) {
  return Promise.resolve({ status: "success", id: String(_args.id) });
}

export async function runWithout(store: Store) {
  const res = await buggySaveRecord({ id: "r1", body: "hello" });
  return { reported: res.status, persisted: store.has("r1") };
}

export async function runWith(store: Store) {
  const verified = wrapTool(
    contract({
      tool: "save_record",
      description: "the record is persisted in the store",
      post: { verify: ({ args }) => store.has(String(args.id)), describe: "record persisted in store" },
    }),
    buggySaveRecord,
  );
  const first = await verified({ id: "r1", body: "hello" });
  if (first.ok) return { corrected: false, persisted: store.has("r1") };

  // The agent reacts to the correction signal by calling the FIXED writer.
  store.set("r1", { id: "r1", body: "hello" });
  return { corrected: true, signal: first.signal.message, persisted: store.has("r1") };
}

async function main() {
  console.log("=== WITHOUT TrueCall ===");
  const a = await runWithout(new Map());
  console.log(`tool reported: ${a.reported}  ->  agent says: done ✅`);
  console.log(`reality: record persisted = ${a.persisted}  ${a.persisted ? "" : "❌ SILENT FAILURE"}\n`);

  console.log("=== WITH TrueCall ===");
  const store: Store = new Map();
  const b = await runWith(store);
  console.log(`TrueCall caught it: "${b.signal}"`);
  console.log(`agent self-corrects -> record persisted = ${b.persisted}  ${b.persisted ? "✅ actually done" : "❌"}`);
}

if (process.argv[1] && import.meta.url === fileURLToPath(new URL(import.meta.url)) && process.argv[1].endsWith("demo.ts")) {
  await main();
}
```

- [ ] **Step 5: Run the test, verify it passes**

Run: `./node_modules/.bin/tsx --test demo.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Run the demo end-to-end (manual sanity)**

Run: `./node_modules/.bin/tsx demo.ts`
Expected: prints the WITHOUT block showing `❌ SILENT FAILURE`, then the WITH block showing `✅ actually done`.

- [ ] **Step 7: Type-check and commit**

```bash
tsc --noEmit
git add examples/silent-failure/tsconfig.json examples/silent-failure/.gitignore examples/silent-failure/demo.ts examples/silent-failure/demo.test.ts
git commit -m "feat(example): deterministic silent-failure before/after demo

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Live Claude Code demo project + walkthrough docs + adapter stubs

**Files:**
- Create: `examples/silent-failure/claude-code/tools/save-note.sh`
- Create: `examples/silent-failure/claude-code/truecall.contracts.js`
- Create: `examples/silent-failure/claude-code/.claude/settings.json`
- Create: `examples/silent-failure/claude-code/README.md`
- Create: `docs/demo-claude-code.md`, `docs/demo-video-script.md`
- Create: `packages/adapters/antigravity/README.md`, `packages/adapters/codex/README.md`
- Test: `examples/silent-failure/claude-code/save-note.test.ts`

**Interfaces:** none consumed by later tasks (final task). The test proves the demo's premise (the buggy tool reports success but creates no note file).

- [ ] **Step 1: Write the failing test (proves the bug is real)**

`examples/silent-failure/claude-code/save-note.test.ts`:
```ts
import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm, cp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const pexec = promisify(execFile);
const here = fileURLToPath(new URL(".", import.meta.url));

test("save-note.sh reports success but does NOT create the note file (the bug)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tc-note-"));
  await cp(join(here, "tools"), join(dir, "tools"), { recursive: true });
  const { stdout } = await pexec("bash", [join(dir, "tools", "save-note.sh"), "n1", "hello world"], { cwd: dir });
  assert.match(stdout, /"status":\s*"success"/);
  const exists = await stat(join(dir, "notes", "n1.md")).then(() => true, () => false);
  assert.equal(exists, false, "note file should NOT exist — that is the silent failure");
  await rm(dir, { recursive: true, force: true });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run (from `examples/silent-failure/`): `./node_modules/.bin/tsx --test claude-code/save-note.test.ts`
Expected: FAIL — ENOENT on `save-note.sh` (not created yet).

- [ ] **Step 3: Create the buggy tool**

`examples/silent-failure/claude-code/tools/save-note.sh`:
```bash
#!/usr/bin/env bash
# A "tool" that SILENTLY FAILS: reports success but writes the note to /dev/null
# instead of notes/<id>.md. TrueCall's post-condition catches the lie.
set -euo pipefail
id="${1:?usage: save-note.sh <id> <text>}"
text="${2:-}"
mkdir -p notes
echo "$text" > /dev/null   # BUG: should be > "notes/$id.md"
echo "{\"status\":\"success\",\"id\":\"$id\"}"
```
Then make it executable:
```bash
chmod +x examples/silent-failure/claude-code/tools/save-note.sh
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `./node_modules/.bin/tsx --test claude-code/save-note.test.ts`
Expected: PASS (1 test) — confirms the tool reports success yet creates no note file.

- [ ] **Step 5: Create the contracts binding**

`examples/silent-failure/claude-code/truecall.contracts.js`:
```js
// Verify that `save-note.sh <id> ...` actually produced a non-empty notes/<id>.md.
// The id lives inside the Bash command string, so we parse it in a custom verify fn.
export default [
  {
    contract: {
      tool: "Bash",
      description: "save-note.sh created the note file",
      post: {
        verify: async ({ args }) => {
          const m = String(args.command ?? "").match(/save-note\.sh\s+"?(\w+)"?/);
          if (!m) return false;
          const { stat } = await import("node:fs/promises");
          return await stat(`notes/${m[1]}.md`).then((s) => s.size > 0, () => false);
        },
        describe: "a non-empty notes/<id>.md exists after save-note.sh",
      },
    },
    when: (ctx) => String(ctx.args.command ?? "").includes("save-note.sh"),
  },
];
```

- [ ] **Step 6: Create the hook settings**

`examples/silent-failure/claude-code/.claude/settings.json`:
```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "/ABSOLUTE/PATH/TO/truecall/packages/adapters/claude-code/node_modules/.bin/tsx /ABSOLUTE/PATH/TO/truecall/packages/adapters/claude-code/src/bin.ts"
          }
        ]
      }
    ]
  }
}
```

- [ ] **Step 7: Create the demo README + walkthrough + video script + stubs**

`examples/silent-failure/claude-code/README.md`:
````markdown
# Live demo: TrueCall catches a silently-failing Claude Code tool

`tools/save-note.sh` reports `{"status":"success"}` but writes the note to `/dev/null` — so the note file
never appears. This is the "returns success and is wrong" pattern. With the TrueCall PostToolUse hook
enabled, the lie is caught and Claude is told to correct it.

## Run it

1. Edit `.claude/settings.json` — replace `/ABSOLUTE/PATH/TO/truecall` with this repo's absolute path.
2. Open this folder (`examples/silent-failure/claude-code/`) as a project in Claude Code.
3. **Without the hook** (rename `.claude/settings.json` aside): ask Claude to run
   `bash tools/save-note.sh note1 "buy milk"`. It reports success — but `notes/note1.md` does not exist.
4. **With the hook** (restore `.claude/settings.json`): ask again. The PostToolUse hook runs the
   contract in `truecall.contracts.js`, finds no `notes/note1.md`, and returns a `decision:"block"`
   correction. Claude sees the post-condition failed and self-corrects (e.g. writes the note itself).

See `../../../docs/demo-claude-code.md` for the full narrative and `../../../docs/demo-video-script.md`
for the 30-second script.
````

`docs/demo-claude-code.md`:
````markdown
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
````

`docs/demo-video-script.md`:
````markdown
# 30-second demo video script — "Your agent says done. Did it?"

**0:00–0:05 — Hook.** Title card: *"Your AI agent returns success. The work didn't happen."*

**0:05–0:13 — Without TrueCall.** Split screen. Left: Claude Code runs `save-note.sh note1 "buy milk"`,
prints `{"status":"success"}`, says "Saved your note." Right: a terminal `ls notes/` → empty. Caption:
*"200 OK. Nothing saved. The agent has no idea."*

**0:13–0:23 — With TrueCall.** Same prompt, hook enabled. The tool returns success, but a red TrueCall
banner appears: *"`Bash` failed its post-condition — notes/note1.md does not exist."* Claude reads it and
self-corrects; `ls notes/` now shows `note1.md`. Caption: *"A deterministic post-condition caught the lie
— and the agent fixed it."*

**0:23–0:30 — Close.** Title card: *"TrueCall — open, cross-harness, deterministic verification that your
agent actually did the thing. github.com/abhid1234/truecall"*
````

`packages/adapters/antigravity/README.md`:
```markdown
# @truecall/adapter-antigravity (stub — Phase 4)

Planned: wire TrueCall's `runContract` into Antigravity's tool-call lifecycle, mapping its tool
call/result shape to a core `Ctx` and surfacing the correction signal back to the agent — the same
contract format as the Claude Code adapter. Not yet implemented.
```

`packages/adapters/codex/README.md`:
```markdown
# @truecall/adapter-codex (stub — Phase 4)

Planned: wire TrueCall's `runContract` into Codex's tool-call lifecycle, mapping its tool call/result
shape to a core `Ctx` and returning the correction signal — the same contract format as the Claude Code
adapter. Not yet implemented.
```

- [ ] **Step 8: Commit**

```bash
chmod +x examples/silent-failure/claude-code/tools/save-note.sh
git add examples/silent-failure/claude-code docs/demo-claude-code.md docs/demo-video-script.md packages/adapters/antigravity/README.md packages/adapters/codex/README.md
git commit -m "feat(example): live Claude Code silent-failure demo + walkthrough + adapter stubs

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**1. Spec coverage** (`docs/design-phase3-claude-code-adapter.md` → task):
- Adapter `hook.ts` pure handler (normalize ctx, select bindings, runContract, block JSON) → Task 2. ✓
- `tool_output ?? tool_response` fallback → Task 2 (tested). ✓
- `registry.ts` Binding + loadBindings (Binding[] or bare Contract[]) → Task 1. ✓
- `when(ctx)` guard in the adapter (core spec unchanged) → Task 1 (type) + Task 2 (filter + test). ✓
- `bin.ts` stdin→stdout, contracts-module resolution (`TRUECALL_CONTRACTS` / `./truecall.contracts.js`), no-contracts = no-op, unexpected error = fail-closed → Task 3. ✓
- Adapter README + settings.json install → Task 3. ✓
- Scripted demo + test-backed end states → Task 4. ✓
- Live demo project (buggy save-note.sh, contracts binding, settings, README) + bug-proving test → Task 5. ✓
- Walkthrough doc + 30-sec video script → Task 5. ✓
- Antigravity/Codex stubs → Task 5. ✓
- Core untouched → no task modifies `packages/core` (verified in final review). ✓

**2. Placeholder scan:** The two `settings.json` files and the README intentionally contain
`/ABSOLUTE/PATH/TO/truecall` — this is user-localized config data (the README/walkthrough instruct
replacing it), not an unfinished code step. All code steps contain complete, runnable source.

**3. Type consistency:** `HookInput` (Task 2) consumed by `bin.ts`/`index.ts` (Task 3). `Binding`
(Task 1) consumed by `hook.ts` (Task 2) and re-exported by `index.ts` (Task 3). `handleHookEvent`
signature identical across Tasks 2–3. Demo `runWithout`/`runWith` (Task 4) match their test. Core
imports use the relative source path `../../../core/src/...` (adapter) and `../../packages/core/src/...`
(examples) consistently.

## Notes
- Adapter imports core by **relative path to source** (no install, no build) — `tsc`/`tsx` resolve `.ts`
  via `allowImportingTsExtensions`.
- After this phase: Phase 4 turns the Antigravity/Codex stubs into real adapters.
