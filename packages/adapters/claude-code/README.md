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
