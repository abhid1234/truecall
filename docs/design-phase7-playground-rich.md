# Phase 7 Design — Rich Playground (Inspector-grade)

> **Status:** brainstorm output. Upgrades the Phase 6 playground to the depth of the RL Trajectory
> Auditor "Inspector": metrics masthead, searchable/filterable scenario rail with status dots, an
> animated verification timeline, a before/after diff, a challenge/quiz mode, and aesthetic polish.
> Same static / zero-build / zero-dep shape. `packages/core` untouched; the verify `engine.js` is unchanged.

## Goal

Make the playground *feel* as rich and explorable as the Inspector while serving TrueCall's story: a
visitor lands, browses many scenarios, plays the verification step-by-step, sees the before/after, and can
test themselves — all client-side.

## What changes vs Phase 6

Phase 6 shipped a working engine + 3 scenarios + a 3-panel UI + a static result console. Phase 7 keeps
`engine.js` as-is and rebuilds the presentation layer richer. The four approved pillars:

1. **Animated verification timeline + before/after diff**
2. **Filterable rail + 7 scenarios + status dots**
3. **Challenge / quiz mode**
4. **Aesthetic depth**

## Architecture (files)

```
playground/
├── engine.js         # UNCHANGED (the verify engine)
├── scenarios.js      # EXPANDED → 7 scenarios, each gets a `category`
├── highlight.js      # NEW — tiny JSON syntax highlighter that builds colored spans (XSS-safe, no innerHTML)
├── app.js            # REWRITTEN — masthead+counter, rail (search/filter/status dots), panels, run→timeline, diff
├── features.js       # NEW — challenge/quiz mode, first-visit intro card, localStorage stats
├── engine.test.js    # EXTENDED — covers all 7 scenarios (ok→pass, bug→catch) + fail-closed
├── styles.css        # EXPANDED — metrics strip, chips, timeline, diff, animations, highlight colors
├── index.html        # EXPANDED structure
├── favicon.svg vercel.json package.json README.md  # unchanged/minor
```

Module boundaries: `engine.js` (verdicts) ← `app.js`/`features.js` (UI) ← `highlight.js` (presentation
util) ← `scenarios.js` (data). `engine.js`/`scenarios.js`/`highlight.js` stay DOM-free so `node --test`
can import them; `app.js`/`features.js` are browser-only (DOM).

## Pillar 1 — Animated verification timeline + before/after diff

On **▶ Run**, instead of an instant result, render a 4-stage timeline into the console pane, advancing
with a short delay (and play/step/replay controls):

1. **Tool returned** — the success-shaped `result` (deceptively green).
2. **TrueCall builds context** — `ctx = { tool, args, result }`.
3. **Post-condition** — each check in `contract.post` shown evaluating, then ✓/✗; the **first failing
   check highlights red** and short-circuits (matches the engine's AND semantics).
4. **Verdict** — `✅ verified — passes through` OR the red correction signal (`expected`/`actual`/
   `message`/`try`), with a closing line: *"→ returned to the agent instead of a false success."*

Implementation: `runTimeline(contract, ctx, world)` computes the per-stage data by calling the engine's
`runCheck` per check (so the displayed steps are real engine outcomes, not re-derived), then animates with
`setTimeout`/`requestAnimationFrame`; a "step" button advances one stage, "play" auto-advances, "replay"
resets. Respects `prefers-reduced-motion` (renders all stages instantly).

**Before/after diff** (below the timeline, two columns):
- **Without TrueCall:** tool → `success` → *agent: "done ✅"* → **reality:** broken (when the world is the
  bug world) — the silent failure ships.
- **With TrueCall:** same call → TrueCall catches → *agent self-corrects* → **reality:** fixed.
Driven by the current world toggle; the columns make the value proposition concrete.

## Pillar 2 — Filterable rail + 7 scenarios + status dots

`scenarios.js` grows to 7, each gaining `category` (`filesystem` | `api` | `db` | `shell` | `composite`):

| id | category | check | bug world |
|----|----------|-------|-----------|
| create_file | filesystem | file_exists | file missing |
| append_log | filesystem | file_exists + contains | wrong content |
| save_record | db | custom verify (store) | empty store |
| charge_card | db | custom verify (paid flag) | not charged |
| send_email | api | http re-fetch | 404 |
| deploy_build | shell | shell exit + a result check (composite AND) | nonzero exit |
| publish_post | composite | result + http (AND) | http 404 |

Rail gets: a **search input** (filters by tool/blurb), **category filter chips** (All + each category), and
each card shows a **status dot** — neutral until run, then green (verified) / red (caught) per the last run
in the session.

## Pillar 3 — Challenge / quiz mode

A **"Challenge me"** toggle (in `features.js`): hides panel 2 (the world), randomizes the world to ok/bug,
and asks *"Will TrueCall pass or catch this?"* with two buttons. On pick → reveal the world + run the
timeline → mark correct/incorrect. Tracks **streak + best streak + total** in `localStorage`
(`truecall.pg.stats`), shown in the masthead. "Next challenge" picks another scenario+world.

## Pillar 4 — Aesthetic depth

- **Metrics masthead strip:** `deterministic · cross-harness · 5 checks · fail-closed` chips + a live
  **"silent failures caught: N"** counter (localStorage, increments on each caught run).
- **JSON syntax highlighting** (`highlight.js`): tokenizes a JSON string and returns an array of
  `{text, cls}` spans (keys/strings/numbers/punctuation) that `app.js` appends as `textContent` spans —
  **no `innerHTML`**, so it stays XSS-safe even for user-edited contracts.
- **Animations:** stage fade/slide-in on the timeline, dot pulse on status change, chip transitions; all
  gated by `prefers-reduced-motion`.
- **First-visit intro card** (sessionStorage `truecall.pg.seen`): one-paragraph "what this is" + a "try the
  first scenario" button; dismissible.
- **Dark-console polish:** monospace, colored stage glyphs (✓/✗), the correction signal styled like the demo.

## Constraints (carried)
- Static, zero-build, **zero runtime deps**; served as-is by Vercel.
- `packages/core` untouched; `engine.js` unchanged (verdicts already faithful + tested).
- Deterministic; honest **"simulated environment"** badge retained.
- **XSS-safe:** no `innerHTML`/`eval`/`new Function`; all dynamic content via `textContent`/DOM nodes;
  highlighter emits spans, not markup; edited contracts are `JSON.parse`d, `verify` fns re-attached from
  the scenario via the existing sentinel.
- No employer references; pro-ecosystem framing; TrueCall brand palette/fonts.

## Testing
- `engine.test.js` extended: for all 7 scenarios assert `worlds.ok`→`ok:true` and `worlds.bug`→`ok:false`
  with a populated signal; keep the fail-closed (throwing verify, missing template) cases. `node --test`.
- `highlight.js`: a small node:test asserting the tokenizer round-trips text (concatenated span text ===
  input) and classifies keys/strings/numbers — guards XSS (output is data, not markup) and correctness.
- Render check: serve over http, headless-Chrome screenshot, eyeball the rich UI (masthead, rail, timeline).
  (file:// won't run ES modules — must serve over http, as in Phase 6.)

## Deploy
Re-deploy `playground/` to the existing Vercel project (`ai-edge-gallery/truecall`):
`cd playground && vercel deploy --prod --yes --scope ai-edge-gallery`. Public URL stays
`truecall-eosin.vercel.app` (the other aliases need Deployment Protection disabled in project settings).

## Out of scope
- A backend/API or persistence beyond `localStorage`.
- A "failure map" canvas (the Inspector's scatter plot has no clean TrueCall analogue for v1).
- Real fs/shell/http (simulated by design).

## Acceptance
- Rich rail (search + chips + 7 cards + status dots), animated timeline (play/step/replay), before/after
  diff, challenge mode with a localStorage streak, metrics masthead + caught-counter, JSON highlighting,
  intro card — all working over the deployed https URL.
- `engine.test.js` + `highlight.test.js` pass; `packages/core` unchanged; no XSS/eval; no employer refs.
