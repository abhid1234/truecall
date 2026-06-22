# Phase 6 Design — TrueCall Playground (in-browser, Vercel-deployed)

> **Status:** Phase 6 design (brainstorm output). An interactive, static, zero-build web playground that
> lets anyone run TrueCall's verification in their browser and watch it catch a silent tool failure.
> Modeled on the RL Trajectory Auditor "Inspector" (single static `index.html` + `app.js` + `styles.css`,
> all logic client-side, deployed by linking the folder to Vercel). `packages/core` is not modified.

## Goal

A shareable URL where a developer, in ~10 seconds, *sees* the TrueCall idea: a tool returns success, the
world didn't change, and a deterministic post-condition catches the lie and emits a correction — with a
toggle to flip the silent failure on/off, curated scenarios, and an editable contract for power users.

## Reference pattern (Trajectory Inspector — replicate this shape)

Single static directory deployed to Vercel, no framework, no build, no backend: `index.html` + `app.js`
+ `styles.css` + self/CDN fonts + pre-baked data. All interactivity is pure client-side JS. We copy the
*shape and deploy mechanics*; the visual brand is TrueCall's own (not the Inspector's oxblood palette).

## Key technical reality: simulated IO

TrueCall's core runs `file_exists`/`http`/`shell` via Node APIs (`node:fs`, `node:child_process`, `fetch`)
— none of which run in a browser. So the playground ships a **faithful browser port of the pure verify
engine** and runs the IO checks against a **simulated "world"** the user controls. The deterministic
catch behavior (orchestration, `result` check, custom `verify`, templating, fail-closed) is fully real;
only the environment is simulated. The UI labels this honestly ("simulated environment").

## Architecture

A new static directory in the repo, deployed as its own Vercel project:

```
playground/
├── index.html        # structure: masthead, left rail (scenarios), main (3 panels), result console
├── styles.css        # TrueCall palette via CSS custom props; light shell + dark console pane
├── engine.js         # browser verify engine (ESM): mirrors docs/spec.md; simulated IO checks
├── engine.test.ts    # Node tests: engine verdicts match the spec (run with tsx)
├── scenarios.js      # curated scenario data (create_file, save_record, send_email)
├── app.js            # UI wiring: render rail, panels, run, toggle, editor
├── favicon.svg
└── vercel.json       # static config (no build)
```

Fonts: the same Google Fonts `<link>` the blog uses (DM Serif Display / DM Sans / Fira Code) — the
locked-down build env can't fetch woff2 to self-host, and a font CDN is not an employer reference.

### `engine.js` (the faithful part)
ESM module, no imports, browser + Node compatible. Mirrors `docs/spec.md`:
- `getPath(obj, path)`, `deepEqual(a,b)`, `interpolate(tmpl, ctx, transform?)` — ported from `template.ts`.
- `runCheck(check, ctx, world)`:
  - `result` → real (operates on `ctx.result`).
  - `verify` → real (runs the predicate). For safety the editor does NOT eval user JS: the contract is
    edited as JSON (`JSON.parse`, never `eval`/`new Function`), and any `verify` function is re-attached
    from the curated scenario via a `"<fn:kept-from-scenario>"` sentinel — so user text can never
    introduce executable code.
  - `file_exists` → simulated against `world.files` (`{ [path]: { size, content } }`).
  - `http` → simulated against `world.http` (`{ [url]: { status, body } }`).
  - `shell` → simulated against `world.shell` (`{ [cmd]: { exitCode, stdout } }`).
  - Returns `CheckOutcome = { passed, expected, actual }`; throws → caught upstream as fail-closed.
- `runContract(contract, ctx, world)` → `VerifyResult` (single/array AND, short-circuit, fail-closed
  `error:true` on a thrown verifier; timeout is omitted in-browser — noted in a comment).
- Exported so `engine.test.ts` can assert verdicts in Node (keeps it from drifting from the real core).

### `scenarios.js`
Array of curated scenarios, each: `{ id, label, tool, args, result, contract, world_ok, world_bug, blurb }`.
- **create_file** — `result {status:"success", path:"/out.txt"}`; contract `file_exists {{args.path}}`;
  `world_ok` has the file, `world_bug` doesn't.
- **save_record** — custom `verify` checks a mock store; `world_bug` store is empty.
- **send_email** — `http` re-fetch of the message; `world_bug` returns 404 / wrong state.

### UX (TrueCall brand)
- **Masthead:** "Your agent says done. Did it?" + one-line sub + repo/spec links + a "simulated environment" badge.
- **Left rail:** scenario cards (tool + intent), plus a "Custom" entry.
- **Main — three stacked panels:**
  1. **The tool call** — `tool`, `args`, and the success-shaped `result` it returned.
  2. **The world** — the simulated environment, with a prominent **"Tool actually did it ✅ / Silently failed ❌"** toggle (the before/after control).
  3. **The contract** — the post-condition; read-only for presets, with an **"Edit"** reveal that makes the contract + result + world editable (the power-user "bring your own" path).
- **▶ Run TrueCall** → the dark **result console** renders either `✅ verified — result passes through to the agent` or the red **correction signal** (`expected` / `actual` / `message` / `remediation`), styled like the demo/video.
- Flipping the toggle and re-running *is* the before/after moment.

### Visual style
TrueCall palette as CSS custom props: `--navy:#1a1a2e; --bg:#fafaf8; --blue:#4285F4; --console:#0d0f15;
--good:#46d39a; --bad:#ff6b6b;`. Fonts: DM Serif Display (display), DM Sans (UI), Fira Code (code/console).
Layout: warm light shell, dark console result pane — the Inspector's dev-tool feel, TrueCall's colors.

## Constraints (carried)
- **Static, zero-build, zero runtime deps** — pure HTML/CSS/JS, served as-is by Vercel.
- **`packages/core` untouched.**
- **Deterministic** — the engine has no LLM; verdicts are predicate-based.
- **Honest** — the "simulated environment" badge makes clear IO is simulated client-side.
- **No employer references**; pro-ecosystem framing.

## Testing
- `engine.test.ts` (Node via tsx): for each scenario, assert `runContract` returns `ok:true` with
  `world_ok` and `ok:false` (with the right `expected`/`actual`) with `world_bug`; plus fail-closed on a
  throwing `verify`, and the `tool_output`-style `result` check. This is the regression guard against drift.
- Render check: load `index.html` in headless Chrome, run a scenario, confirm the console shows the
  correction (screenshot eyeballed). Manual interaction otherwise.

## Deploy (Vercel)
- `playground/` is the deployable unit. `vercel.json`: `{ "cleanUrls": true }` (static; no build command).
- Deploy: `cd playground && vercel deploy --prod --yes` (CLI may require `--scope`). Project name `truecall`.
- **Needs the user's Vercel auth.** If logged in, deploy and report the URL; else hand over the exact
  command. Custom domain deferred (Vercel refuses agent-run domain purchases — the user buys it).

## Out of scope
- Running real `fs`/`shell`/`http` (impossible client-side — simulated by design).
- A backend/API, accounts, persistence beyond `localStorage` for the last-edited contract.
- Auto-generating scenarios from the real packages (curated by hand for v1).

## Acceptance
- A visitor picks a scenario, sees the tool "succeed," flips "silently failed," clicks Run, and watches
  TrueCall catch it with a structured correction — then flips it back to see it pass.
- The contract/result/world are editable; a custom contract runs in-browser.
- `engine.test.ts` passes (verdicts match the spec); `packages/core` unchanged.
- Deployed to a public Vercel URL (or handed off as one command if auth is needed).
