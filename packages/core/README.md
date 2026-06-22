# @truecall/core

**Deterministic runtime post-condition verification for AI agent tool calls.**

When an agent's tool returns `success` but didn't actually change the world (the file wasn't written, the
record wasn't saved), TrueCall catches it with a cheap deterministic check and hands the agent a structured
correction — instead of letting a silent failure ship.

This is the zero-dependency core: the contract format and the verifier. For harness integration (Claude
Code, Codex), see the adapters in the [monorepo](https://github.com/abhid1234/truecall).

## Install

```bash
npm install @truecall/core
```

Zero runtime dependencies. Ships compiled ESM + type declarations; runs on Node 18+.

## Use

Declare a **contract** — a cheap post-condition that confirms intent — and wrap your tool with it:

```ts
import { contract, wrapTool } from "@truecall/core";

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

If `realCreateFile` returns `{ status: "success" }` but never writes the file, `r.ok` is `false` and
`r.signal` explains the silent failure.

### Built-in checks (plus a custom escape hatch)

- `file_exists` — a file/dir exists, optional `minSize` / `contains`
- `http` — re-fetch a resource and assert status / a JSON field
- `shell` — run a read-only probe, assert exit code / stdout
- `result` — assert on the tool's own returned payload
- `verify` — a custom async predicate for anything else

Verification is **deterministic** — there is no LLM-judge check type. If a verifier can't produce a verdict
(throws, missing template path, timeout), TrueCall is **fail-closed**: it reports "could not verify," never a
silent pass.

## API

- `contract(def)` — validate and build a contract (throws on an invalid definition).
- `validateContract(def): string[]` — return validation errors (empty = valid).
- `runContract(contract, ctx): Promise<VerifyResult>` — run a contract against `{ tool, args, result }`.
- `runCheck(check, ctx)` — run a single check.
- `wrapTool(contract, toolFn)` — wrap a tool so its success is gated by the post-condition.

Full contract format: [`docs/spec.md`](https://github.com/abhid1234/truecall/blob/main/docs/spec.md).

## License

[MIT](./LICENSE)
