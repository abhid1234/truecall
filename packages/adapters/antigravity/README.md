# @truecall/adapter-antigravity (not yet available)

**Status: blocked on a public API.** As of this writing, Antigravity exposes no documented
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
