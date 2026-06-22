# TrueCall — Contract Format Specification (v1)

> **Status:** Phase 1 deliverable. Defines *how a developer declares a tool's post-condition* —
> a cheap, deterministic check that confirms a tool call achieved its real-world intent, not just
> that it returned `success`/200. This document specifies the **format only**. How the check is
> executed and injected into a harness is the runtime (Phase 2) and adapters (Phase 3).
>
> **Phase 1 acceptance:** a developer can read this spec and write a valid contract for both
> `create_file` and `send_email` — see [§8 Worked examples](#8-worked-examples).

---

## 1. What a contract is

A **contract** declares the post-condition for exactly one tool. When the tool reports success,
TrueCall runs the contract's check(s); if a check fails, TrueCall returns a structured
[correction signal](#6-the-correction-signal) instead of letting the agent proceed on a silent failure.

A contract is **declarative data first** — a JSON-serializable object describing a built-in check —
with a **custom function escape hatch** (`verify`) for anything the built-ins don't cover. The
declarative form is the default because it is portable across harnesses and languages and is the basis
for v2's auto-generation from tool schemas; the escape hatch guarantees no post-condition is
unexpressible.

```ts
type Contract = {
  tool: string                 // the tool name this contract binds to
  description?: string         // human-readable intent, e.g. "a non-empty file exists at the path"
  post: Check | Check[]        // one check, or an array — ALL must pass (logical AND)
  timeoutMs?: number           // total verifier budget for this contract; default 2000
}
```

- `tool` — required. Matching a contract to a live tool call is the runtime's job (Phase 2); the format
  only records the name.
- `description` — optional but recommended. Used in the correction signal's `expected` field when a
  built-in check doesn't generate a better one, and as documentation.
- `post` — required. A single `Check` or an array. An array passes only if **every** check passes
  (logical AND). There is no `OR` combinator in v1 (YAGNI; a custom `verify` can express disjunction).
- `timeoutMs` — optional. Upper bound on how long the contract's checks may run, total. Default `2000`.
  Post-conditions must be cheap; exceeding the budget is a verifier error (see [§7](#7-evaluation-semantics)).

---

## 2. Checks: the five primitives

`Check` is a tagged union. Four declarative built-ins plus the custom escape hatch. Every built-in
that references tool data does so through [`{{...}}` templates](#4-templates-and-context).

```ts
type Check =
  // 2.1 filesystem
  | { check: 'file_exists', path: Tmpl, minSize?: number, contains?: string }
  // 2.2 http re-fetch
  | { check: 'http', url: Tmpl, method?: 'GET', status?: number, jsonPath?: string, equals?: unknown }
  // 2.3 shell exit / command
  | { check: 'shell', cmd: Tmpl, exitCode?: number, stdoutMatches?: string }
  // 2.4 predicate on the tool's own returned payload
  | { check: 'result', path: string, exists?: boolean, equals?: unknown }
  // 2.5 custom escape hatch
  | { verify: (ctx: Ctx) => boolean | Promise<boolean>, describe?: string }

type Tmpl = string   // a string that may contain {{...}} interpolation; see §4
```

### 2.1 `file_exists` — filesystem
Asserts a file or directory exists at `path`.
- `path` (required) — resolved template; absolute paths recommended.
- `minSize` (optional) — minimum size in bytes (`>= minSize`). `minSize: 1` means "non-empty".
- `contains` (optional) — the file's UTF-8 contents must include this substring.

### 2.2 `http` — re-fetch and assert
Re-fetches a resource after a write-style tool call and asserts on the response. This is the canonical
catch for *"the API returned 200 but nothing actually changed."*
- `url` (required) — resolved template.
- `method` (optional) — `GET` only in v1 (verification must be side-effect free).
- `status` (optional) — expected HTTP status code (e.g. `200`).
- `jsonPath` + `equals` (optional, used together) — parse the body as JSON, read the dotted path
  `jsonPath`, and assert it deep-equals `equals`.

### 2.3 `shell` — command probe
Runs a command and asserts on its outcome. Useful for deterministic probes the other built-ins don't
cover (e.g. `test -f`, `grep -q`).
- `cmd` (required) — resolved template, run via the runtime's shell.
- `exitCode` (optional) — expected exit code; defaults to `0` if neither `exitCode` nor
  `stdoutMatches` is given.
- `stdoutMatches` (optional) — a regular expression that stdout must match.

> **Caution.** `shell` runs arbitrary commands. Authors must keep the command read-only; TrueCall does
> not sandbox it. Templated values are shell-escaped by the runtime before substitution (Phase 2).

### 2.4 `result` — predicate on the tool's payload
Asserts on the tool's *own* returned value. This is the lightest check and the closest to a schema
check — it can confirm the result is well-formed but **cannot by itself prove the world changed**
(a tool can return a valid-looking payload while the real effect never happened). Prefer §2.1–2.3 for
real-intent verification; use `result` as a supporting check.
- `path` (required) — dotted path into the tool result (e.g. `data.id`).
- `exists` (optional) — assert the path is present (and not `null`/`undefined`).
- `equals` (optional) — assert the value at the path deep-equals this.

### 2.5 `verify` — custom escape hatch
An async predicate. Receives the full [context](#4-templates-and-context) and returns `true` (passed)
or `false` (failed). Use this whenever the built-ins can't express the post-condition (database row
exists, queue depth changed, third-party SDK lookup, …).
- `verify` (required) — `(ctx: Ctx) => boolean | Promise<boolean>`.
- `describe` (required when used) — a short phrase describing the post-condition; populates the
  correction signal's `expected` field (the runtime can't infer it from arbitrary code).

A throw inside `verify` is a **verifier error**, not a pass — see [§7](#7-evaluation-semantics).

---

## 3. Determinism boundary (a hard rule)

Every v1 check is **deterministic**: it queries real state and asserts a predicate. There is **no
LLM-judge check type** — "ask a model whether this looks right" is explicitly out of scope for v1 and
is the line that separates TrueCall from confidence-based tools. A custom `verify` function **must not**
call an LLM to form its verdict; it must check state. (An LLM-judge fallback may be added in v2 as a
clearly separate, opt-in mechanism.)

---

## 4. Templates and context

Built-in checks reference tool-call data through `{{...}}` interpolation, resolved against the context
**before** the check runs. Custom `verify` functions receive the same context directly and need no
templating.

```ts
type Ctx = {
  tool: string                      // the tool name
  args: Record<string, unknown>     // the tool call's input arguments
  result: unknown                   // the value the tool returned
}
```

- Template syntax: `{{args.<path>}}` and `{{result.<path>}}`, dotted paths into `args` / `result`.
  Examples: `{{args.path}}`, `{{result.id}}`, `{{args.recipient.email}}`.
- A template referencing a missing path is a **verifier error** (fail-closed; see [§7](#7-evaluation-semantics)) —
  never silently substituted with empty string.
- Resolved values are coerced to strings for `url`/`path`/`cmd`, and shell-escaped for `cmd`.

---

## 5. Authoring a contract

Contracts are created with the `contract()` helper, which returns a validated `Contract`:

```ts
contract({
  tool: 'create_file',
  description: 'a non-empty file exists at the requested path',
  post: { check: 'file_exists', path: '{{args.path}}', minSize: 1 },
})
```

`contract()` validates the object at construction and throws on a malformed contract (unknown `check`
type, missing required field, `verify` without `describe`, etc.). The validation rules are normative;
the implementation lives in Phase 2 (`packages/core`).

---

## 6. The correction signal

Running a contract yields a `VerifyResult`:

```ts
type VerifyResult =
  | { ok: true }
  | {
      ok: false
      tool: string
      expected: string        // what should have been true
      actual: string          // what was actually found
      message: string         // one-line human-readable diagnosis
      remediation?: string    // optional hint on how to fix/retry
      error?: boolean         // true => the verifier itself failed (see §7), not a clean "false"
    }
```

- On pass, the result is `{ ok: true }` and the runtime returns the tool's original result
  transparently — the agent never sees TrueCall.
- On fail, the structured signal is returned so the agent can self-correct. The richness
  (`expected` vs `actual` + `remediation`) is deliberate: it is what lets the agent actually fix the
  silent failure rather than just retry blindly.
- For built-in checks, the runtime auto-generates `expected`/`actual`/`message` from the check
  definition and observed state. For a custom `verify`, `expected` comes from `describe`.

Example failure signal:

```ts
{
  ok: false,
  tool: 'create_file',
  expected: 'file at /tmp/out.txt with size >= 1 byte',
  actual: 'no file exists at /tmp/out.txt',
  message: 'create_file reported success but no file was created',
  remediation: 'retry create_file with an absolute path and verify write permissions',
}
```

> **Scope note.** *How* this signal is delivered to the agent (e.g. injected via a Claude Code
> PostToolUse hook) is defined by each harness adapter in Phase 3. This spec fixes only the signal's
> shape, so every adapter speaks the same contract.

---

## 7. Evaluation semantics

1. **AND across checks.** When `post` is an array, the contract passes only if every check passes.
   Evaluation may short-circuit on the first failure.
2. **Pass.** All checks true → `{ ok: true }` → tool result passed through unchanged.
3. **Clean fail.** A check ran and its predicate was false → `{ ok: false, ... }` with the failing
   check's details. `error` is absent/false.
4. **Verifier error (fail-closed).** The verifier itself could not produce a verdict — a custom
   `verify` threw, a template referenced a missing path, a check timed out (`timeoutMs`), or an
   environment fault (e.g. filesystem unavailable). This returns `{ ok: false, error: true, ... }`.
   It is reported as **"could not verify,"** distinct from "verified false," and is **never** treated
   as a pass. Fail-closed is intentional: an unverifiable call is not a trusted call.

---

## 8. Worked examples

These two are the Phase 1 acceptance bar.

### 8.1 `create_file` — filesystem built-in

```ts
contract({
  tool: 'create_file',
  description: 'a non-empty file exists at the requested path',
  post: { check: 'file_exists', path: '{{args.path}}', minSize: 1 },
})
```
After `create_file({ path: '/tmp/out.txt', contents: '...' })` returns success, TrueCall asserts a file
exists at `/tmp/out.txt` with at least one byte. If the tool returned success but wrote nothing,
the contract fails with a correction signal.

### 8.2 `send_email` — "a sent/draft record exists for this recipient"

Two valid ways to express the same intent.

**(a) HTTP re-fetch** — re-query the mail backend:
```ts
contract({
  tool: 'send_email',
  description: 'a sent message exists addressed to the recipient',
  post: {
    check: 'http',
    url: 'https://mail.local/api/messages/{{result.id}}',
    status: 200,
    jsonPath: 'state',
    equals: 'sent',
  },
})
```

**(b) Custom escape hatch** — when verification needs an SDK or richer logic:
```ts
contract({
  tool: 'send_email',
  post: {
    verify: async ({ args, result }) => {
      const rec = await mail.getMessage(result.id)
      return rec?.to === args.to && ['sent', 'draft'].includes(rec.state)
    },
    describe: 'a sent/draft message exists addressed to args.to',
  },
})
```
Both catch the silent failure where `send_email` returns `{ status: 'success' }` but no message record
was ever created.

### 8.3 Multiple checks (AND)

```ts
contract({
  tool: 'create_file',
  description: 'a non-empty config file exists and the tool reported a path',
  post: [
    { check: 'file_exists', path: '{{args.path}}', minSize: 1, contains: '[settings]' },
    { check: 'result', path: 'path', exists: true },
  ],
})
```

---

## 9. v1 scope boundaries

In scope: the four built-in checks, the custom escape hatch, templates, the correction signal, and
fail-closed verifier-error semantics — all deterministic, all harness-neutral.

Explicitly **deferred**:
- **Pre-snapshot / delta checks** ("row count increased by 1") — v1 is post-state only. A custom
  `verify` can capture state itself, but there is no first-class pre-hook.
- **Retry / self-correction policy in the format** — the contract emits a signal; the adapter owns the
  retry loop. A core helper, `verifyWithRetry(contract, attempt, { maxRetries })`, is now provided for
  programmatic use (catch → re-attempt with the correction fed back → re-verify → stop after N).
- **LLM-judge check type** — see [§3](#3-determinism-boundary-a-hard-rule); deterministic only in v1.
- **Auto-generating contracts from tool schemas** — v2; v1 is hand-written.
- **`OR` combinator** — express disjunction in a custom `verify`.

---

## 10. Type reference (collected)

```ts
type Tmpl = string

type Ctx = { tool: string; args: Record<string, unknown>; result: unknown }

type Check =
  | { check: 'file_exists'; path: Tmpl; minSize?: number; contains?: string }
  | { check: 'http'; url: Tmpl; method?: 'GET'; status?: number; jsonPath?: string; equals?: unknown }
  | { check: 'shell'; cmd: Tmpl; exitCode?: number; stdoutMatches?: string }
  | { check: 'result'; path: string; exists?: boolean; equals?: unknown }
  | { verify: (ctx: Ctx) => boolean | Promise<boolean>; describe?: string }

type Contract = {
  tool: string
  description?: string
  post: Check | Check[]
  timeoutMs?: number
}

type VerifyResult =
  | { ok: true }
  | {
      ok: false
      tool: string
      expected: string
      actual: string
      message: string
      remediation?: string
      error?: boolean
    }
```

*End of v1 contract format specification.*
