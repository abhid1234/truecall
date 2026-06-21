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
