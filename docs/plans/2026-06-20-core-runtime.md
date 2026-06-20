# TrueCall Core Runtime (Phase 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `packages/core` — the zero-dependency TypeScript runtime that executes a TrueCall contract against a tool call and returns a structured correction signal on silent failure (instead of a false success).

**Architecture:** Pure, harness-neutral library. A `Contract` (per `docs/spec.md`) is validated, then `runContract(contract, ctx)` evaluates its check(s) — built-ins (`file_exists`, `http`, `shell`, `result`) or a custom `verify` fn — under a timeout, fail-closed, and produces a `VerifyResult`. `wrapTool(contract, toolFn)` composes a tool with its contract so the tool's success is gated by the post-condition. No harness-specific code lives here (adapters are Phase 3).

**Tech Stack:** TypeScript 5.9 (type-check only, `tsc --noEmit`), Node 22 + `tsx` (from the symlinked `~/.local/node_modules`) to run `.ts` tests directly — this Node build is compiled WITHOUT TypeScript support, so `--experimental-strip-types` fails with `ERR_NO_TYPESCRIPT`; `tsx` is the offline-safe substitute. Built-in `node:test` + `node:assert` for tests, global `fetch`, `node:fs/promises`, `node:child_process`. **Zero runtime and dev dependencies in `package.json`** (`tsx`/`tsc`/`@types/node` come from the symlink, never an install).

## Global Constraints

Copied verbatim from `docs/spec.md` and `CLAUDE.md` — every task's requirements implicitly include these.

- **Zero-dependency.** `package.json` has NO `dependencies` and NO `devDependencies`. The locked-down build environment blocks external npm (403). `tsc` and `@types/node` come from the symlinked `~/.local/node_modules`, never an `npm install` in the repo.
- **Deterministic only.** No LLM-judge check type. A custom `verify` must check state, never call a model. (LLM fallback is v2.)
- **Cross-harness neutral.** `packages/core` imports nothing harness-specific (no Claude Code / Codex / Antigravity references). Adapters are Phase 3.
- **Node:** v22.22.2 (confirmed). This build is compiled WITHOUT TypeScript support — `node --experimental-strip-types` fails (`ERR_NO_TYPESCRIPT`). Run `.ts` tests with `tsx` (v4.21.0, present in `~/.local/node_modules`). Type-check with `tsc` 5.9.3 (on PATH).
- **Fail-closed:** a verifier that cannot produce a verdict (throw, missing template path, timeout) returns `{ ok: false, error: true, ... }` — never a pass.
- **License:** MIT.
- **Spec is normative:** field names, check types, and `VerifyResult` shape must match `docs/spec.md §10` exactly.

## File Structure

```
packages/core/
├── package.json            # @truecall/core, type:module, zero deps, scripts
├── tsconfig.json           # strict, noEmit, allowImportingTsExtensions
├── node_modules            # SYMLINK -> ~/.local/node_modules (gitignored; for tsc only)
└── src/
    ├── types.ts            # spec §10 types: Tmpl, Ctx, Check, Contract, VerifyResult
    ├── template.ts         # getPath, deepEqual, interpolate, TemplateError (value resolution)
    ├── contract.ts         # validateContract(), contract()
    ├── checks.ts           # CheckOutcome, runCheck() dispatcher + 4 built-ins + custom verify
    ├── verify.ts           # runContract() — AND, timeout, fail-closed, builds VerifyResult
    ├── index.ts            # public exports
    ├── template.test.ts
    ├── contract.test.ts
    ├── checks.test.ts
    ├── verify.test.ts
    └── wrap.test.ts
└── src/wrap.ts             # wrapTool() — compose tool + contract (acceptance deliverable)
```

Run all tests from `packages/core/`: `./node_modules/.bin/tsx --test "src/**/*.test.ts"`
Type-check from `packages/core/`: `tsc --noEmit`

---

### Task 1: Scaffold + types + value-resolution utilities

**Files:**
- Create: `packages/core/package.json`
- Create: `packages/core/tsconfig.json`
- Create: `packages/core/.gitignore`
- Create: `packages/core/src/types.ts`
- Create: `packages/core/src/template.ts`
- Test: `packages/core/src/template.test.ts`

**Interfaces:**
- Produces: `Tmpl`, `Ctx`, `Check`, `Contract`, `VerifyResult` (types); `getPath(obj: unknown, path: string): unknown`; `deepEqual(a: unknown, b: unknown): boolean`; `interpolate(tmpl: string, ctx: Ctx, transform?: (v: string) => string): string`; `class TemplateError extends Error`.

- [ ] **Step 1: Create the package manifest**

`packages/core/package.json`:
```json
{
  "name": "@truecall/core",
  "version": "0.0.1",
  "description": "Deterministic runtime post-condition verification for AI agent tool calls.",
  "license": "MIT",
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "./node_modules/.bin/tsx --test \"src/**/*.test.ts\""
  }
}
```

- [ ] **Step 2: Create tsconfig**

`packages/core/tsconfig.json`:
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

- [ ] **Step 3: Create .gitignore and the node_modules symlink for tooling**

`packages/core/.gitignore`:
```
node_modules
```

Run (from `packages/core/`):
```bash
ln -s ~/.local/node_modules node_modules
```
This gives `tsc` access to `typescript` + `@types/node` without an npm install (offline-safe). The symlink is gitignored.

- [ ] **Step 4: Write the types (spec §10, verbatim)**

`packages/core/src/types.ts`:
```ts
export type Tmpl = string;

export type Ctx = {
  tool: string;
  args: Record<string, unknown>;
  result: unknown;
};

export type Check =
  | { check: "file_exists"; path: Tmpl; minSize?: number; contains?: string }
  | { check: "http"; url: Tmpl; method?: "GET"; status?: number; jsonPath?: string; equals?: unknown }
  | { check: "shell"; cmd: Tmpl; exitCode?: number; stdoutMatches?: string }
  | { check: "result"; path: string; exists?: boolean; equals?: unknown }
  | { verify: (ctx: Ctx) => boolean | Promise<boolean>; describe?: string };

export type Contract = {
  tool: string;
  description?: string;
  post: Check | Check[];
  timeoutMs?: number;
};

export type VerifyResult =
  | { ok: true }
  | {
      ok: false;
      tool: string;
      expected: string;
      actual: string;
      message: string;
      remediation?: string;
      error?: boolean;
    };
```

- [ ] **Step 5: Write the failing test for value-resolution utilities**

`packages/core/src/template.test.ts`:
```ts
import test from "node:test";
import assert from "node:assert/strict";
import { getPath, deepEqual, interpolate, TemplateError } from "./template.ts";
import type { Ctx } from "./types.ts";

const ctx: Ctx = {
  tool: "create_file",
  args: { path: "/tmp/out.txt", nested: { id: 7 } },
  result: { id: "abc", state: "sent" },
};

test("getPath reads dotted paths", () => {
  assert.equal(getPath(ctx, "args.path"), "/tmp/out.txt");
  assert.equal(getPath(ctx, "args.nested.id"), 7);
  assert.equal(getPath(ctx, "result.state"), "sent");
  assert.equal(getPath(ctx, "args.missing.deep"), undefined);
});

test("deepEqual compares primitives, arrays, objects", () => {
  assert.equal(deepEqual(1, 1), true);
  assert.equal(deepEqual({ a: [1, 2] }, { a: [1, 2] }), true);
  assert.equal(deepEqual({ a: 1 }, { a: 2 }), false);
  assert.equal(deepEqual([1], [1, 2]), false);
});

test("interpolate substitutes resolved values", () => {
  assert.equal(interpolate("GET /m/{{result.id}}", ctx), "GET /m/abc");
  assert.equal(interpolate("{{args.path}}", ctx), "/tmp/out.txt");
});

test("interpolate applies a transform to each value", () => {
  assert.equal(interpolate("{{result.id}}", ctx, (v) => `'${v}'`), "'abc'");
});

test("interpolate throws TemplateError on missing path (fail-closed)", () => {
  assert.throws(() => interpolate("{{args.nope}}", ctx), TemplateError);
});
```

- [ ] **Step 6: Run the test, verify it fails**

Run (from `packages/core/`): `./node_modules/.bin/tsx --test src/template.test.ts`
Expected: FAIL — `Cannot find module './template.ts'`.

- [ ] **Step 7: Implement the utilities**

`packages/core/src/template.ts`:
```ts
import type { Ctx } from "./types.ts";

export class TemplateError extends Error {}

export function getPath(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc == null || typeof acc !== "object") return undefined;
    return (acc as Record<string, unknown>)[key];
  }, obj);
}

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a as object);
  const kb = Object.keys(b as object);
  if (ka.length !== kb.length) return false;
  return ka.every(
    (k) =>
      Object.prototype.hasOwnProperty.call(b, k) &&
      deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
  );
}

const TOKEN = /\{\{\s*([\w.]+)\s*\}\}/g;

export function interpolate(tmpl: string, ctx: Ctx, transform: (v: string) => string = (v) => v): string {
  return tmpl.replace(TOKEN, (_match, expr: string) => {
    const val = getPath(ctx, expr);
    if (val === undefined) {
      throw new TemplateError(`template path "{{${expr}}}" resolved to undefined`);
    }
    return transform(String(val));
  });
}
```

- [ ] **Step 8: Run the test, verify it passes**

Run: `./node_modules/.bin/tsx --test src/template.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 9: Type-check**

Run (from `packages/core/`): `tsc --noEmit`
Expected: no output, exit 0.

- [ ] **Step 10: Commit**

```bash
git add packages/core/package.json packages/core/tsconfig.json packages/core/.gitignore packages/core/src/types.ts packages/core/src/template.ts packages/core/src/template.test.ts
git commit -m "feat(core): scaffold package + spec types + value-resolution utils

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Contract validation + builder

**Files:**
- Create: `packages/core/src/contract.ts`
- Test: `packages/core/src/contract.test.ts`

**Interfaces:**
- Consumes: `Contract`, `Check` from `./types.ts`.
- Produces: `validateContract(c: Contract): string[]` (empty array = valid); `contract(c: Contract): Contract` (throws on invalid, returns the contract).

- [ ] **Step 1: Write the failing test**

`packages/core/src/contract.test.ts`:
```ts
import test from "node:test";
import assert from "node:assert/strict";
import { validateContract, contract } from "./contract.ts";

test("a valid file_exists contract has no errors", () => {
  const errs = validateContract({
    tool: "create_file",
    post: { check: "file_exists", path: "{{args.path}}", minSize: 1 },
  });
  assert.deepEqual(errs, []);
});

test("missing tool is an error", () => {
  const errs = validateContract({ tool: "", post: { check: "result", path: "id" } });
  assert.ok(errs.some((e) => e.includes("tool")));
});

test("unknown check type is an error", () => {
  const errs = validateContract({ tool: "t", post: { check: "magic" } as never });
  assert.ok(errs.some((e) => e.includes("known check type")));
});

test("custom verify without describe is an error", () => {
  const errs = validateContract({ tool: "t", post: { verify: () => true } });
  assert.ok(errs.some((e) => e.includes("describe")));
});

test("an array post validates each check", () => {
  const errs = validateContract({
    tool: "t",
    post: [{ check: "file_exists", path: "{{args.path}}" }, { check: "result", path: "id", exists: true }],
  });
  assert.deepEqual(errs, []);
});

test("contract() throws on invalid input", () => {
  assert.throws(() => contract({ tool: "", post: { check: "result", path: "id" } }), /Invalid contract/);
});

test("contract() returns the contract when valid", () => {
  const c = contract({ tool: "create_file", post: { check: "file_exists", path: "{{args.path}}" } });
  assert.equal(c.tool, "create_file");
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `./node_modules/.bin/tsx --test src/contract.test.ts`
Expected: FAIL — `Cannot find module './contract.ts'`.

- [ ] **Step 3: Implement validation + builder**

`packages/core/src/contract.ts`:
```ts
import type { Contract, Check } from "./types.ts";

const BUILTIN = new Set(["file_exists", "http", "shell", "result"]);

export function validateContract(c: Contract): string[] {
  const errs: string[] = [];
  if (!c || typeof c !== "object") return ["contract must be an object"];
  if (typeof c.tool !== "string" || c.tool.length === 0) {
    errs.push("contract.tool must be a non-empty string");
  }
  if (c.timeoutMs !== undefined && (typeof c.timeoutMs !== "number" || c.timeoutMs <= 0)) {
    errs.push("contract.timeoutMs must be a positive number");
  }
  if (c.post === undefined) {
    errs.push("contract.post is required");
  } else {
    const checks = Array.isArray(c.post) ? c.post : [c.post];
    if (checks.length === 0) errs.push("contract.post must not be an empty array");
    checks.forEach((chk, i) => errs.push(...validateCheck(chk, i)));
  }
  return errs;
}

function validateCheck(chk: Check, i: number): string[] {
  const p = `post[${i}]`;
  if (!chk || typeof chk !== "object") return [`${p} must be an object`];
  if ("verify" in chk) {
    const e: string[] = [];
    if (typeof chk.verify !== "function") e.push(`${p}.verify must be a function`);
    if (typeof chk.describe !== "string" || chk.describe.length === 0) {
      e.push(`${p}.describe is required when using a custom verify`);
    }
    return e;
  }
  const t = (chk as { check?: string }).check;
  if (!t || !BUILTIN.has(t)) {
    return [`${p} must have a known check type (${[...BUILTIN].join(", ")}) or a verify function`];
  }
  const e: string[] = [];
  const anyChk = chk as Record<string, unknown>;
  if (t === "file_exists" && typeof anyChk.path !== "string") e.push(`${p}.path is required`);
  if (t === "http" && typeof anyChk.url !== "string") e.push(`${p}.url is required`);
  if (t === "shell" && typeof anyChk.cmd !== "string") e.push(`${p}.cmd is required`);
  if (t === "result" && typeof anyChk.path !== "string") e.push(`${p}.path is required`);
  return e;
}

export function contract(c: Contract): Contract {
  const errs = validateContract(c);
  if (errs.length) throw new Error(`Invalid contract: ${errs.join("; ")}`);
  return c;
}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `./node_modules/.bin/tsx --test src/contract.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Type-check and commit**

```bash
tsc --noEmit
git add packages/core/src/contract.ts packages/core/src/contract.test.ts
git commit -m "feat(core): contract validation + builder

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Checks — dispatcher + all four built-ins + custom verify

**Files:**
- Create: `packages/core/src/checks.ts`
- Test: `packages/core/src/checks.test.ts`

**Interfaces:**
- Consumes: `Check`, `Ctx` from `./types.ts`; `interpolate`, `getPath`, `deepEqual` from `./template.ts`.
- Produces: `type CheckOutcome = { passed: boolean; expected: string; actual: string }`; `runCheck(chk: Check, ctx: Ctx): Promise<CheckOutcome>`. `runCheck` may THROW on a verifier fault (unreachable host, fs fault other than ENOENT, custom verify throw) — the orchestrator (Task 4) catches it as a fail-closed verifier error.

- [ ] **Step 1: Write the failing test**

`packages/core/src/checks.test.ts`:
```ts
import test from "node:test";
import assert from "node:assert/strict";
import { writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { runCheck } from "./checks.ts";
import type { Ctx } from "./types.ts";

function ctxWith(args: Record<string, unknown>, result: unknown = {}): Ctx {
  return { tool: "t", args, result };
}

test("file_exists passes for a non-empty file, fails when absent", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tc-"));
  const path = join(dir, "out.txt");
  await writeFile(path, "hello");
  const pass = await runCheck({ check: "file_exists", path: "{{args.path}}", minSize: 1 }, ctxWith({ path }));
  assert.equal(pass.passed, true);
  const fail = await runCheck({ check: "file_exists", path: "{{args.path}}" }, ctxWith({ path: join(dir, "nope.txt") }));
  assert.equal(fail.passed, false);
  await rm(dir, { recursive: true, force: true });
});

test("file_exists honors contains", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tc-"));
  const path = join(dir, "c.ini");
  await writeFile(path, "[settings]\nx=1");
  const ok = await runCheck({ check: "file_exists", path: "{{args.path}}", contains: "[settings]" }, ctxWith({ path }));
  assert.equal(ok.passed, true);
  const no = await runCheck({ check: "file_exists", path: "{{args.path}}", contains: "[missing]" }, ctxWith({ path }));
  assert.equal(no.passed, false);
  await rm(dir, { recursive: true, force: true });
});

test("result asserts on the tool payload", async () => {
  const ctx = ctxWith({}, { id: "x1", state: "sent" });
  assert.equal((await runCheck({ check: "result", path: "id", exists: true }, ctx)).passed, true);
  assert.equal((await runCheck({ check: "result", path: "state", equals: "sent" }, ctx)).passed, true);
  assert.equal((await runCheck({ check: "result", path: "state", equals: "draft" }, ctx)).passed, false);
  assert.equal((await runCheck({ check: "result", path: "missing", exists: true }, ctx)).passed, false);
});

test("shell checks exit code and stdout", async () => {
  const okExit = await runCheck({ check: "shell", cmd: "exit 0" }, ctxWith({}));
  assert.equal(okExit.passed, true);
  const badExit = await runCheck({ check: "shell", cmd: "exit 3" }, ctxWith({}));
  assert.equal(badExit.passed, false);
  const match = await runCheck({ check: "shell", cmd: "echo hello-{{args.name}}", stdoutMatches: "hello-bob" }, ctxWith({ name: "bob" }));
  assert.equal(match.passed, true);
});

test("shell escapes interpolated values", async () => {
  // a value with a space must not break the command; printf echoes it back
  const out = await runCheck(
    { check: "shell", cmd: "printf %s {{args.v}}", stdoutMatches: "^a b$" },
    ctxWith({ v: "a b" }),
  );
  assert.equal(out.passed, true);
});

test("http re-fetch asserts status and json field", async () => {
  const server = createServer((req, res) => {
    if (req.url === "/m/abc") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ state: "sent" }));
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise<void>((r) => server.listen(0, r));
  const port = (server.address() as AddressInfo).port;
  const ctx = ctxWith({}, { id: "abc" });
  const ok = await runCheck(
    { check: "http", url: `http://127.0.0.1:${port}/m/{{result.id}}`, status: 200, jsonPath: "state", equals: "sent" },
    ctx,
  );
  assert.equal(ok.passed, true);
  const wrong = await runCheck(
    { check: "http", url: `http://127.0.0.1:${port}/m/{{result.id}}`, status: 200, jsonPath: "state", equals: "draft" },
    ctx,
  );
  assert.equal(wrong.passed, false);
  await new Promise<void>((r) => server.close(() => r()));
});

test("custom verify is dispatched and uses describe", async () => {
  const ok = await runCheck({ verify: () => true, describe: "always true" }, ctxWith({}));
  assert.equal(ok.passed, true);
  assert.equal(ok.expected, "always true");
  const no = await runCheck({ verify: async () => false, describe: "never" }, ctxWith({}));
  assert.equal(no.passed, false);
});

test("custom verify throw propagates (verifier error)", async () => {
  await assert.rejects(() => runCheck({ verify: () => { throw new Error("boom"); }, describe: "x" }, ctxWith({})));
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `./node_modules/.bin/tsx --test src/checks.test.ts`
Expected: FAIL — `Cannot find module './checks.ts'`.

- [ ] **Step 3: Implement the checks**

`packages/core/src/checks.ts`:
```ts
import { stat, readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Check, Ctx } from "./types.ts";
import { interpolate, getPath, deepEqual } from "./template.ts";

const pexecFile = promisify(execFile);

export type CheckOutcome = { passed: boolean; expected: string; actual: string };

export async function runCheck(chk: Check, ctx: Ctx): Promise<CheckOutcome> {
  if ("verify" in chk) {
    const passed = !!(await chk.verify(ctx));
    return {
      passed,
      expected: chk.describe ?? "custom post-condition holds",
      actual: passed ? "predicate returned true" : "predicate returned false",
    };
  }
  switch (chk.check) {
    case "file_exists": return fileExists(chk, ctx);
    case "http": return httpCheck(chk, ctx);
    case "shell": return shellCheck(chk, ctx);
    case "result": return resultCheck(chk, ctx);
  }
}

async function fileExists(
  chk: { path: string; minSize?: number; contains?: string },
  ctx: Ctx,
): Promise<CheckOutcome> {
  const path = interpolate(chk.path, ctx);
  const expected =
    `file at ${path}` +
    (chk.minSize !== undefined ? ` with size >= ${chk.minSize}` : "") +
    (chk.contains !== undefined ? ` containing "${chk.contains}"` : "");
  let size: number;
  try {
    size = (await stat(path)).size;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { passed: false, expected, actual: `no file exists at ${path}` };
    }
    throw err; // other fs faults => verifier error
  }
  if (chk.minSize !== undefined && size < chk.minSize) {
    return { passed: false, expected, actual: `file size ${size} < ${chk.minSize}` };
  }
  if (chk.contains !== undefined) {
    const body = await readFile(path, "utf8");
    if (!body.includes(chk.contains)) {
      return { passed: false, expected, actual: `file does not contain "${chk.contains}"` };
    }
  }
  return { passed: true, expected, actual: `file exists at ${path} (size ${size})` };
}

function resultCheck(
  chk: { path: string; exists?: boolean; equals?: unknown },
  ctx: Ctx,
): CheckOutcome {
  const val = getPath(ctx.result, chk.path);
  const expected =
    `result.${chk.path} ` +
    (chk.exists ? "is present" : chk.equals !== undefined ? `=== ${JSON.stringify(chk.equals)}` : "present");
  if (chk.exists && (val === undefined || val === null)) {
    return { passed: false, expected, actual: `result.${chk.path} is ${String(val)}` };
  }
  if (chk.equals !== undefined && !deepEqual(val, chk.equals)) {
    return { passed: false, expected, actual: `result.${chk.path} = ${JSON.stringify(val)}` };
  }
  return { passed: true, expected, actual: `result.${chk.path} = ${JSON.stringify(val)}` };
}

async function httpCheck(
  chk: { url: string; method?: "GET"; status?: number; jsonPath?: string; equals?: unknown },
  ctx: Ctx,
): Promise<CheckOutcome> {
  const url = interpolate(chk.url, ctx);
  const expected =
    `GET ${url}` +
    (chk.status !== undefined ? ` -> status ${chk.status}` : "") +
    (chk.jsonPath !== undefined ? ` with ${chk.jsonPath} === ${JSON.stringify(chk.equals)}` : "");
  const res = await fetch(url, { method: chk.method ?? "GET" });
  if (chk.status !== undefined && res.status !== chk.status) {
    return { passed: false, expected, actual: `status ${res.status}` };
  }
  if (chk.jsonPath !== undefined) {
    const body = await res.json();
    const val = getPath(body, chk.jsonPath);
    if (!deepEqual(val, chk.equals)) {
      return { passed: false, expected, actual: `${chk.jsonPath} = ${JSON.stringify(val)}` };
    }
  }
  return { passed: true, expected, actual: `status ${res.status}` };
}

function shellEscape(v: string): string {
  return `'${v.replace(/'/g, `'\\''`)}'`;
}

async function shellCheck(
  chk: { cmd: string; exitCode?: number; stdoutMatches?: string },
  ctx: Ctx,
): Promise<CheckOutcome> {
  const cmd = interpolate(chk.cmd, ctx, shellEscape);
  const wantExit = chk.exitCode ?? (chk.stdoutMatches !== undefined ? undefined : 0);
  const expected =
    `\`${cmd}\`` +
    (wantExit !== undefined ? ` exits ${wantExit}` : "") +
    (chk.stdoutMatches !== undefined ? ` stdout matches /${chk.stdoutMatches}/` : "");
  let stdout = "";
  let code = 0;
  try {
    const r = await pexecFile("/bin/sh", ["-c", cmd]);
    stdout = r.stdout;
  } catch (err) {
    const e = err as { code?: number; stdout?: string };
    code = typeof e.code === "number" ? e.code : 1;
    stdout = e.stdout ?? "";
  }
  if (wantExit !== undefined && code !== wantExit) {
    return { passed: false, expected, actual: `exit ${code}` };
  }
  if (chk.stdoutMatches !== undefined && !new RegExp(chk.stdoutMatches).test(stdout)) {
    return { passed: false, expected, actual: `stdout did not match (got: ${JSON.stringify(stdout)})` };
  }
  return { passed: true, expected, actual: `exit ${code}` };
}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `./node_modules/.bin/tsx --test src/checks.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Type-check and commit**

```bash
tsc --noEmit
git add packages/core/src/checks.ts packages/core/src/checks.test.ts
git commit -m "feat(core): check dispatcher + file_exists/http/shell/result + custom verify

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Contract orchestration — runContract (AND, timeout, fail-closed)

**Files:**
- Create: `packages/core/src/verify.ts`
- Test: `packages/core/src/verify.test.ts`

**Interfaces:**
- Consumes: `Contract`, `Ctx`, `VerifyResult` from `./types.ts`; `runCheck`, `CheckOutcome` from `./checks.ts`.
- Produces: `runContract(contract: Contract, ctx: Ctx): Promise<VerifyResult>`.
- Behavior: evaluates `post` checks in order (short-circuit on first fail / AND); applies `timeoutMs` (default 2000); any thrown check / template error / timeout becomes `{ ok: false, error: true, ... }` (fail-closed); a clean fail becomes `{ ok: false, error absent, ... }` with the failing check's `expected`/`actual`.

- [ ] **Step 1: Write the failing test**

`packages/core/src/verify.test.ts`:
```ts
import test from "node:test";
import assert from "node:assert/strict";
import { runContract } from "./verify.ts";
import type { Contract, Ctx } from "./types.ts";

const ctx: Ctx = { tool: "send_email", args: { to: "a@b.com" }, result: { id: "1", state: "sent" } };

test("passes when the post-condition holds", async () => {
  const c: Contract = { tool: "send_email", post: { check: "result", path: "state", equals: "sent" } };
  assert.deepEqual(await runContract(c, ctx), { ok: true });
});

test("clean fail returns a signal without error flag", async () => {
  const c: Contract = { tool: "send_email", post: { check: "result", path: "state", equals: "draft" } };
  const r = await runContract(c, ctx);
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.error ?? false, false);
  assert.equal(r.tool, "send_email");
  assert.match(r.message, /post-condition failed/);
  assert.ok(r.expected.length > 0 && r.actual.length > 0);
});

test("AND: array post fails if any check fails", async () => {
  const c: Contract = {
    tool: "send_email",
    post: [
      { check: "result", path: "id", exists: true },
      { check: "result", path: "state", equals: "draft" },
    ],
  };
  const r = await runContract(c, ctx);
  assert.equal(r.ok, false);
});

test("verifier throw is fail-closed with error:true", async () => {
  const c: Contract = { tool: "send_email", post: { verify: () => { throw new Error("boom"); }, describe: "x" } };
  const r = await runContract(c, ctx);
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.error, true);
  assert.match(r.actual, /boom/);
});

test("timeout is fail-closed with error:true", async () => {
  const c: Contract = {
    tool: "slow",
    timeoutMs: 20,
    post: { verify: () => new Promise<boolean>((res) => setTimeout(() => res(true), 200)), describe: "slow" },
  };
  const r = await runContract(c, ctx);
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.error, true);
  assert.match(r.actual, /exceeded/);
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `./node_modules/.bin/tsx --test src/verify.test.ts`
Expected: FAIL — `Cannot find module './verify.ts'`.

- [ ] **Step 3: Implement the orchestrator**

`packages/core/src/verify.ts`:
```ts
import type { Contract, Ctx, VerifyResult, Check } from "./types.ts";
import { runCheck } from "./checks.ts";

const DEFAULT_TIMEOUT_MS = 2000;

export async function runContract(contract: Contract, ctx: Ctx): Promise<VerifyResult> {
  const checks: Check[] = Array.isArray(contract.post) ? contract.post : [contract.post];
  const timeoutMs = contract.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  try {
    return await withTimeout(evalChecks(checks, ctx, contract), timeoutMs);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      error: true,
      tool: contract.tool,
      expected: contract.description ?? "post-condition is verifiable",
      actual: `verifier error: ${reason}`,
      message: `TrueCall could not verify ${contract.tool}: ${reason}`,
      remediation: "fix the contract or the verifier environment, then retry",
    };
  }
}

async function evalChecks(checks: Check[], ctx: Ctx, contract: Contract): Promise<VerifyResult> {
  for (const chk of checks) {
    const outcome = await runCheck(chk, ctx);
    if (!outcome.passed) {
      return {
        ok: false,
        tool: contract.tool,
        expected: outcome.expected,
        actual: outcome.actual,
        message: `${contract.tool} reported success but post-condition failed: expected ${outcome.expected}, got ${outcome.actual}`,
      };
    }
  }
  return { ok: true };
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`verification exceeded ${ms}ms`)), ms);
    p.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `./node_modules/.bin/tsx --test src/verify.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Type-check and commit**

```bash
tsc --noEmit
git add packages/core/src/verify.ts packages/core/src/verify.test.ts
git commit -m "feat(core): runContract orchestration — AND, timeout, fail-closed signal

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: wrapTool + public exports (Phase 2 acceptance)

**Files:**
- Create: `packages/core/src/wrap.ts`
- Create: `packages/core/src/index.ts`
- Test: `packages/core/src/wrap.test.ts`

**Interfaces:**
- Consumes: `Contract`, `VerifyResult` from `./types.ts`; `runContract` from `./verify.ts`.
- Produces:
  - `type WrappedResult<R> = { ok: true; result: R } | { ok: false; result: R; signal: Extract<VerifyResult, { ok: false }> }`
  - `wrapTool<R>(contract: Contract, toolFn: (args: Record<string, unknown>) => R | Promise<R>): (args: Record<string, unknown>) => Promise<WrappedResult<R>>`
  - `index.ts` re-exports: `contract`, `validateContract`, `runContract`, `runCheck`, `wrapTool`, and all types.

This task implements the Phase 2 acceptance: **a wrapped tool whose post-condition fails returns a correction signal, not a false success.**

- [ ] **Step 1: Write the failing test (the silent-failure acceptance)**

`packages/core/src/wrap.test.ts`:
```ts
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { wrapTool } from "./wrap.ts";
import { contract } from "./contract.ts";

test("wrapped tool that truly creates the file returns ok:true", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tc-"));
  const realCreateFile = wrapTool(
    contract({ tool: "create_file", post: { check: "file_exists", path: "{{args.path}}", minSize: 1 } }),
    async (args) => {
      await writeFile(args.path as string, args.contents as string);
      return { status: "success" };
    },
  );
  const r = await realCreateFile({ path: join(dir, "out.txt"), contents: "hi" });
  assert.equal(r.ok, true);
  await rm(dir, { recursive: true, force: true });
});

test("SILENT FAILURE: tool returns success but writes nothing => ok:false + signal", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tc-"));
  const lyingCreateFile = wrapTool(
    contract({ tool: "create_file", post: { check: "file_exists", path: "{{args.path}}", minSize: 1 } }),
    // returns success but never writes the file — the bug TrueCall exists to catch
    async (_args) => ({ status: "success" }),
  );
  const r = await lyingCreateFile({ path: join(dir, "ghost.txt"), contents: "hi" });
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.signal.ok, false);
  assert.equal(r.signal.tool, "create_file");
  assert.match(r.signal.message, /reported success but post-condition failed/);
  // the original (wrong) result is still available to the adapter
  assert.deepEqual(r.result, { status: "success" });
  await rm(dir, { recursive: true, force: true });
});

test("index re-exports the public API", async () => {
  const api = await import("./index.ts");
  for (const name of ["contract", "validateContract", "runContract", "runCheck", "wrapTool"]) {
    assert.equal(typeof (api as Record<string, unknown>)[name], "function", `${name} exported`);
  }
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `./node_modules/.bin/tsx --test src/wrap.test.ts`
Expected: FAIL — `Cannot find module './wrap.ts'`.

- [ ] **Step 3: Implement wrapTool**

`packages/core/src/wrap.ts`:
```ts
import type { Contract, VerifyResult } from "./types.ts";
import { runContract } from "./verify.ts";

export type WrappedResult<R> =
  | { ok: true; result: R }
  | { ok: false; result: R; signal: Extract<VerifyResult, { ok: false }> };

export function wrapTool<R>(
  contract: Contract,
  toolFn: (args: Record<string, unknown>) => R | Promise<R>,
): (args: Record<string, unknown>) => Promise<WrappedResult<R>> {
  return async (args) => {
    const result = await toolFn(args);
    const verdict = await runContract(contract, { tool: contract.tool, args, result });
    if (verdict.ok) return { ok: true, result };
    return { ok: false, result, signal: verdict };
  };
}
```

- [ ] **Step 4: Implement the public index**

`packages/core/src/index.ts`:
```ts
export { contract, validateContract } from "./contract.ts";
export { runContract } from "./verify.ts";
export { runCheck } from "./checks.ts";
export type { CheckOutcome } from "./checks.ts";
export { wrapTool } from "./wrap.ts";
export type { WrappedResult } from "./wrap.ts";
export type { Tmpl, Ctx, Check, Contract, VerifyResult } from "./types.ts";
```

- [ ] **Step 5: Run the test, verify it passes**

Run: `./node_modules/.bin/tsx --test src/wrap.test.ts`
Expected: PASS (3 tests). The middle test is the Phase 2 acceptance proof.

- [ ] **Step 6: Run the full suite + type-check**

Run (from `packages/core/`):
```bash
tsc --noEmit
./node_modules/.bin/tsx --test "src/**/*.test.ts"
```
Expected: type-check clean; all tests pass across template/contract/checks/verify/wrap (28 tests total).

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/wrap.ts packages/core/src/index.ts packages/core/src/wrap.test.ts
git commit -m "feat(core): wrapTool + public API — silent failure returns correction signal

Closes Phase 2: a wrapped tool with a failing post-condition returns a
structured correction signal instead of a false success.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**1. Spec coverage** (`docs/spec.md` → task):
- §1 Contract shape → Task 1 (types) + Task 2 (validation). ✓
- §2.1–2.4 four built-in checks → Task 3. ✓
- §2.5 custom verify + describe → Task 3 (dispatch) + Task 2 (describe required). ✓
- §3 determinism boundary → enforced by design (no LLM check type exists); Global Constraints. ✓
- §4 templates + Ctx → Task 1 (`interpolate`, `getPath`, missing-path throws). ✓
- §5 `contract()` builder throws on invalid → Task 2. ✓
- §6 VerifyResult shape (rich signal, `error?`) → Task 1 (type) + Task 4 (construction). ✓
- §7 AND, pass-through, clean fail vs verifier error (fail-closed), timeout → Task 4. ✓
- §8 worked examples (`create_file`, `send_email`) → exercised in Task 3 / Task 5 tests. ✓
- §9 scope cuts (post-state only, no retry in format, no LLM, no auto-gen, no OR) → respected; nothing implements them. ✓
- §10 type reference → Task 1 `types.ts` verbatim. ✓

**2. Placeholder scan:** No TBD/TODO; every code step contains complete, runnable source and tests. ✓

**3. Type consistency:** `CheckOutcome` defined in Task 3, consumed in Task 4. `runCheck`/`runContract`/`wrapTool`/`contract`/`validateContract` names match across tasks and `index.ts`. `Ctx` fields (`tool`,`args`,`result`) consistent everywhere. `VerifyResult` `error?` flag set only on the fail-closed path. ✓

## Notes
- **Plan location** uses `docs/plans/` (matching the repo's flat `docs/` convention from the seed) rather than the skill's default `docs/superpowers/plans/`.
- **Next phase (3):** Claude Code adapter + the `examples/silent-failure/` wow demo, which wires `wrapTool`'s signal into a PostToolUse hook. Out of scope here.
