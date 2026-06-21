# TrueCall

**Your agent says "done." TrueCall checks whether it actually did the thing — and makes it fix silent failures before they ship.**

TrueCall is an open, cross-harness, runtime layer that verifies whether an AI agent's tool call *actually achieved its real-world intent* — not just whether it returned `success` or `200`. When a tool silently fails (returns success but the world didn't change), TrueCall catches it with a cheap **deterministic post-condition check** and hands the agent a structured correction signal so it can self-correct.

> Status: early. The contract format ([`docs/spec.md`](docs/spec.md)) and the zero-dependency core runtime ([`packages/core`](packages/core)) are built and tested. Harness adapters and the end-to-end demo are next.

## The problem

State-of-the-art tool-using agents fail more often than their `success` responses suggest. On τ-bench, leading function-calling agents complete **under 50%** of real-world tool-use tasks, and consistency (pass^8) drops **below 25%** in retail. A whole genre of practitioner write-ups now has a name for the failure mode: *"returns 200 and is wrong."* The tool reports success, the agent moves on, and the database row was never written / the file never landed / the email never sent.

The fix works: a verification layer has been shown to cut agent failure rates by up to ~50% on τ²-bench. TrueCall is an **open and deterministic** take on that layer.

## The wedge

TrueCall is the combination that nothing else is, all at once:

| | TrueCall |
|---|---|
| **Runtime** | Runs live, mid-task — not an offline benchmark |
| **Verifies real intent** | Checks the world actually changed — not a `success` shape, not a schema |
| **Deterministic** | Queries state and asserts a predicate — not "does a model feel confident" |
| **Cross-harness** | Designed to run in front of any harness (Claude Code, and others) |
| **Open** | MIT-licensed |

It is **not** confidence scoring, **not** an offline eval, **not** a pre-execution authorization gate, and **not** an observability dashboard. It is the post-condition check that confirms the effect happened.

## How it works

You declare a **contract** for a tool: a cheap post-condition that confirms intent. After the tool runs, TrueCall evaluates it. Pass → the result flows through untouched. Fail → the agent gets a structured signal describing what was expected, what was actually found, and how to fix it.

```ts
import { contract, wrapTool } from "@truecall/core";

// "After create_file succeeds, a non-empty file must exist at the path."
const createFile = wrapTool(
  contract({
    tool: "create_file",
    description: "a non-empty file exists at the requested path",
    post: { check: "file_exists", path: "{{args.path}}", minSize: 1 },
  }),
  realCreateFile, // your tool implementation
);

const r = await createFile({ path: "/tmp/out.txt", contents: "hi" });
if (!r.ok) {
  // r.signal: { expected, actual, message, remediation? } — feed it back to the agent
}
```

When a tool returns `{ status: "success" }` but never wrote the file, `r.ok` is `false` and `r.signal` explains the silent failure — instead of the agent trusting a false success.

### Built-in checks (plus a custom escape hatch)

- `file_exists` — a file/dir exists, optional `minSize` / `contains`
- `http` — re-fetch a resource and assert status / a JSON field (the canonical "returned 200 but nothing changed" catch)
- `shell` — run a read-only probe, assert exit code / stdout
- `result` — assert on the tool's own returned payload
- `verify` — a custom async predicate for anything the built-ins don't cover

Verification is **deterministic by design** — there is no LLM-judge check type. If a verifier can't produce a verdict (throws, a template path is missing, or it times out), TrueCall is **fail-closed**: it reports "could not verify," never a silent pass.

See [`docs/spec.md`](docs/spec.md) for the full contract format.

## Design constraints

- **Zero dependencies.** The core is plain TypeScript on Node built-ins (`node:fs`, `node:child_process`, global `fetch`). No external npm packages.
- **Cross-harness from day one.** Nothing in the core couples to a specific harness; adapters are thin and live separately.
- **Deterministic first.** Real post-condition checks, not confidence scoring.
- **Pro-ecosystem.** TrueCall makes agents on every platform more reliable. It is not framed against any vendor.

## Repository

```
docs/
  gap-analysis.md   # the competitive map: why this niche is open
  spec.md           # the contract / post-condition format (v1)
packages/
  core/             # zero-dependency runtime: contracts, checks, verify, wrapTool
```

### Build & test the core

The core is type-checked with `tsc` and tested with Node's built-in test runner (run via `tsx`, since type-stripping is environment-dependent):

```bash
cd packages/core
tsc --noEmit            # type-check
npm test               # run the suite (tsx --test)
```

## Roadmap

- ✅ Confirm the gap is open ([`docs/gap-analysis.md`](docs/gap-analysis.md))
- ✅ Contract format spec ([`docs/spec.md`](docs/spec.md))
- ✅ Zero-dependency core runtime ([`packages/core`](packages/core))
- ◻︎ Harness adapters (Claude Code first) + the before/after silent-failure demo
- ◻︎ More built-in checks; contract generation from tool schemas

## License

[MIT](LICENSE) © 2026 Abhi Das
