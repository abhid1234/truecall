# Rich Playground (Phase 7) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Upgrade the TrueCall playground to Inspector-grade richness — metrics masthead, searchable/filterable 7-scenario rail with status dots, an animated verification timeline, before/after diff, challenge mode, and JSON syntax highlighting — keeping it static/zero-build/zero-dep.

**Architecture:** Keep `engine.js` unchanged. Expand `scenarios.js` (7 + category). Add a DOM-free `highlight.js` (JSON→colored span tokens). Rebuild the presentation in `app.js` (masthead, rail, panels, run→timeline, diff) + `features.js` (challenge mode, intro, stats). All XSS-safe (textContent/DOM nodes only).

**Tech Stack:** Vanilla HTML/CSS/ESM JS, no framework/build/deps. Pure modules (`engine.js`, `scenarios.js`, `highlight.js`) are DOM-free and tested with `node --test`. `app.js`/`features.js` are browser-only.

## Global Constraints

- Static, zero-build, **zero runtime deps** (`package.json` = `{type:module,private:true}`).
- `packages/core` untouched; `engine.js` unchanged.
- **XSS-safe:** NO `innerHTML`/`outerHTML`/`eval`/`new Function`; all dynamic content via `textContent`/`createElement`/`createTextNode`. The highlighter returns `{text,cls}[]` tokens rendered as `textContent` spans. Edited contracts are `JSON.parse`d; `verify` fns re-attached from the scenario via the `"<fn:kept-from-scenario>"` sentinel.
- Deterministic; honest **"simulated environment"** badge retained.
- Brand: `--navy:#1a1a2e;--bg:#fafaf8;--blue:#4285F4;--console:#0d0f15;--good:#46d39a;--bad:#ff6b6b;` + DM Serif Display / DM Sans / Fira Code.
- Animations gated by `prefers-reduced-motion`.
- No employer references.
- Tests: `node --test` (engine + highlight). Render check via headless Chrome over **http** (modules don't load over file://).

## File Structure

```
playground/
├── engine.js        # unchanged
├── scenarios.js     # 7 scenarios, each with `category` and `remediation`
├── highlight.js     # NEW: highlightJson(str) -> {text,cls}[] ; cls in {key,str,num,punct,plain}
├── highlight.test.js# NEW: round-trip + classification tests (node:test)
├── engine.test.js   # EXTENDED: all 7 scenarios ok→pass / bug→catch + fail-closed cases
├── app.js           # REWRITTEN: masthead+counter, rail(search/filter/dots), panels, run→timeline, diff
├── features.js      # NEW: challenge mode, first-visit intro, localStorage stats
├── styles.css       # EXPANDED
├── index.html       # EXPANDED
├── favicon.svg vercel.json package.json README.md  # unchanged
```

---

### Task 1: Data + pure utilities + tests (scenarios, highlighter)

**Files:**
- Modify: `playground/scenarios.js` (3 → 7, add `category`)
- Create: `playground/highlight.js`, `playground/highlight.test.js`
- Modify: `playground/engine.test.js` (cover all 7)

**Interfaces:**
- `scenarios.js` exports `SCENARIOS`: `{ id, label, tool, category, blurb, call:{tool,args,result}, contract, worlds:{ok,bug}, remediation }`. `category ∈ {filesystem, api, db, shell, composite}`.
- `highlight.js` exports `highlightJson(value): {text,cls}[]` — `value` is an object; it `JSON.stringify(value,null,2)`s then tokenizes; `cls ∈ {key,str,num,punct,plain}`; concatenating all `.text` reproduces the pretty JSON exactly.

- [ ] **Step 1: Expand `scenarios.js` to 7 with categories**

`playground/scenarios.js` (full replacement):
```js
// Curated silent-failure scenarios. Each has a success-shaped tool result, a contract,
// and two simulated worlds: `ok` (the tool really did it) and `bug` (silent failure).
export const SCENARIOS = [
  {
    id: "create_file", label: "create_file", tool: "create_file", category: "filesystem",
    blurb: "Writes a file — but did the file actually land?",
    call: { tool: "create_file", args: { path: "/notes/out.txt", contents: "hello world" }, result: { status: "success", path: "/notes/out.txt" } },
    contract: { tool: "create_file", description: "a non-empty file exists at the requested path",
      post: { check: "file_exists", path: "{{args.path}}", minSize: 1 } },
    worlds: { ok: { files: { "/notes/out.txt": { size: 11, content: "hello world" } } }, bug: { files: {} } },
    remediation: "retry create_file and confirm the write actually flushed to disk",
  },
  {
    id: "append_log", label: "append_log", tool: "append_log", category: "filesystem",
    blurb: "Appends a line to a log — is the line really there?",
    call: { tool: "append_log", args: { path: "/var/app.log", line: "ORDER 42 shipped" }, result: { status: "ok" } },
    contract: { tool: "append_log", description: "the log contains the appended line",
      post: { check: "file_exists", path: "{{args.path}}", contains: "ORDER 42 shipped" } },
    worlds: { ok: { files: { "/var/app.log": { size: 64, content: "...\nORDER 42 shipped\n" } } },
      bug: { files: { "/var/app.log": { size: 40, content: "...older lines...\n" } } } },
    remediation: "the write opened the file but the line was never flushed — fsync and re-read",
  },
  {
    id: "save_record", label: "save_record", tool: "save_record", category: "db",
    blurb: "Persists a record to a store — or only claims to.",
    call: { tool: "save_record", args: { id: "r1", body: "buy milk" }, result: { status: "success", id: "r1" } },
    contract: { tool: "save_record", description: "the record is persisted in the store",
      post: { verify: (ctx, world) => !!(world.store && world.store[ctx.args.id]), describe: "record persisted in the store" } },
    worlds: { ok: { store: { r1: { id: "r1", body: "buy milk" } } }, bug: { store: {} } },
    remediation: "the write returned success but committed nothing — retry inside a transaction and verify the row",
  },
  {
    id: "charge_card", label: "charge_card", tool: "charge_card", category: "db",
    blurb: "Charges a card — did the payment actually post?",
    call: { tool: "charge_card", args: { id: "pay_9", amount: 4200 }, result: { status: "success", id: "pay_9" } },
    contract: { tool: "charge_card", description: "the payment is marked paid",
      post: { verify: (ctx, world) => (world.payments && world.payments[ctx.args.id] || {}).state === "paid", describe: "payment state is 'paid'" } },
    worlds: { ok: { payments: { pay_9: { state: "paid", amount: 4200 } } }, bug: { payments: { pay_9: { state: "pending", amount: 4200 } } } },
    remediation: "the gateway returned success but the charge is still pending — reconcile against the gateway before continuing",
  },
  {
    id: "send_email", label: "send_email", tool: "send_email", category: "api",
    blurb: "Sends an email — re-fetch to confirm it really sent.",
    call: { tool: "send_email", args: { to: "a@b.com", id: "m1" }, result: { status: "success", id: "m1" } },
    contract: { tool: "send_email", description: "a sent message exists for this recipient",
      post: { check: "http", url: "https://mail.local/api/messages/{{result.id}}", status: 200, jsonPath: "state", equals: "sent" } },
    worlds: { ok: { http: { "https://mail.local/api/messages/m1": { status: 200, body: { state: "sent" } } } },
      bug: { http: { "https://mail.local/api/messages/m1": { status: 404, body: {} } } } },
    remediation: "the API returned 200 but no message record exists — re-queue the send and re-check",
  },
  {
    id: "deploy_build", label: "deploy_build", tool: "deploy_build", category: "shell",
    blurb: "Runs a deploy script — did it exit clean AND mark done?",
    call: { tool: "deploy_build", args: { env: "prod" }, result: { status: "success", marker: "dist/BUILT" } },
    contract: { tool: "deploy_build", description: "deploy exited 0 and reported a marker",
      post: [ { check: "shell", cmd: "test -f dist/BUILT", exitCode: 0 }, { check: "result", path: "marker", exists: true } ] },
    worlds: { ok: { shell: { "test -f dist/BUILT": { exitCode: 0, stdout: "" } } },
      bug: { shell: { "test -f dist/BUILT": { exitCode: 1, stdout: "" } } } },
    remediation: "the deploy reported success but the build marker is missing — the artifact never published; re-run and gate on the marker",
  },
  {
    id: "publish_post", label: "publish_post", tool: "publish_post", category: "composite",
    blurb: "Publishes a post — result looks right AND the URL resolves?",
    call: { tool: "publish_post", args: { slug: "hello" }, result: { status: "success", url: "https://blog.local/p/hello" } },
    contract: { tool: "publish_post", description: "the result has a url and that url is live",
      post: [ { check: "result", path: "url", exists: true }, { check: "http", url: "{{result.url}}", status: 200 } ] },
    worlds: { ok: { http: { "https://blog.local/p/hello": { status: 200, body: {} } } },
      bug: { http: { "https://blog.local/p/hello": { status: 404, body: {} } } } },
    remediation: "the publish call returned a URL that 404s — the post row exists but wasn't rendered; trigger a rebuild and re-check the URL",
  },
];
```

- [ ] **Step 2: Write `highlight.test.js` (failing)**

`playground/highlight.test.js`:
```js
import test from "node:test";
import assert from "node:assert/strict";
import { highlightJson } from "./highlight.js";

test("tokens concatenate back to the exact pretty JSON", () => {
  const obj = { tool: "create_file", post: { minSize: 1, ok: true, note: null } };
  const tokens = highlightJson(obj);
  assert.equal(tokens.map((t) => t.text).join(""), JSON.stringify(obj, null, 2));
});

test("classifies keys, strings, numbers", () => {
  const tokens = highlightJson({ a: "x", n: 5 });
  const cls = (txt) => tokens.find((t) => t.text.includes(txt))?.cls;
  assert.equal(tokens.some((t) => t.cls === "key" && t.text.includes('"a"')), true);
  assert.equal(tokens.some((t) => t.cls === "str" && t.text.includes('"x"')), true);
  assert.equal(tokens.some((t) => t.cls === "num" && t.text.includes("5")), true);
});

test("every token has a class from the known set", () => {
  const tokens = highlightJson({ a: [1, "two", false] });
  const known = new Set(["key", "str", "num", "punct", "plain"]);
  assert.ok(tokens.every((t) => known.has(t.cls)));
});
```

- [ ] **Step 3: Implement `highlight.js`**

`playground/highlight.js`:
```js
// Tokenize pretty-printed JSON into {text, cls} spans for safe colored rendering.
// Returns DATA, not markup — the caller renders each token as a textContent span,
// so there is no XSS surface even for user-edited contracts.
// cls ∈ { key, str, num, punct, plain }. Concatenating .text reproduces the input exactly.
export function highlightJson(value) {
  const src = JSON.stringify(value, null, 2);
  const tokens = [];
  // matches: strings (with following optional `:` => key), numbers, literals, punctuation, whitespace
  const re = /("(?:\\.|[^"\\])*")(\s*:)?|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|(true|false|null)|([{}\[\],])|(\s+)/g;
  let m, last = 0;
  while ((m = re.exec(src)) !== null) {
    if (m.index > last) tokens.push({ text: src.slice(last, m.index), cls: "plain" });
    if (m[1] !== undefined) {
      tokens.push({ text: m[1], cls: m[2] ? "key" : "str" });
      if (m[2]) tokens.push({ text: m[2], cls: "punct" });
    } else if (m[3] !== undefined) tokens.push({ text: m[3], cls: "num" });
    else if (m[4] !== undefined) tokens.push({ text: m[4], cls: "num" });
    else if (m[5] !== undefined) tokens.push({ text: m[5], cls: "punct" });
    else if (m[6] !== undefined) tokens.push({ text: m[6], cls: "plain" });
    last = re.lastIndex;
  }
  if (last < src.length) tokens.push({ text: src.slice(last), cls: "plain" });
  return tokens;
}
```

- [ ] **Step 4: Extend `engine.test.js` to cover all 7 scenarios**

Replace the scenario loop in `playground/engine.test.js` (the `for (const s of SCENARIOS)` block stays as-is — it already iterates ALL scenarios, so adding scenarios auto-covers them). Keep the two fail-closed tests. Add one composite-AND assertion:
```js
test("composite AND: deploy_build catches when the shell check fails", async () => {
  const { SCENARIOS } = await import("./scenarios.js");
  const { runContract } = await import("./engine.js");
  const s = SCENARIOS.find((x) => x.id === "deploy_build");
  const r = await runContract(s.contract, s.call, s.worlds.bug);
  assert.equal(r.ok, false);
  assert.match(r.actual, /exit 1/);
});
```

- [ ] **Step 5: Run tests**

Run (from `playground/`): `node --test`
Expected: all pass — 7 scenarios × 2 + fail-closed throw + missing-template + composite-AND + 3 highlight tests = **19 pass**.

- [ ] **Step 6: Commit**

```bash
git add playground/scenarios.js playground/highlight.js playground/highlight.test.js playground/engine.test.js
git commit -m "feat(playground): 7 categorized scenarios + JSON highlighter + tests

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Rich UI (masthead, rail, timeline, diff, challenge, intro)

**Files:**
- Modify: `playground/index.html`, `playground/styles.css`, `playground/app.js`
- Create: `playground/features.js`

**Interfaces (the contract between app.js and features.js):**
- `app.js` exports (ESM) for `features.js` to drive: `selectScenario(id)`, `setWorld('ok'|'bug')`, `runVerification()` (returns the `VerifyResult`), `getState()` → `{ current, world }`, and `els` (cached DOM refs). `app.js` imports `initFeatures(api)` from `features.js` and calls it after first render.
- `features.js` exports `initFeatures(api)` — wires the challenge button, intro card, and reads/writes `localStorage` stats; calls back into `api.selectScenario/setWorld/runVerification`.
- Shared `localStorage` keys: `truecall.pg.caught` (number), `truecall.pg.stats` (`{streak,best,total}`), `sessionStorage truecall.pg.seen`.

**Components to build (each fully implemented at build; structure + behavior fixed here):**

1. **Masthead** (`index.html` + `app.js`): brand + tagline + a metrics chip strip (`deterministic`, `cross-harness`, `5 checks`, `fail-closed`) + a live counter element `#caught` ("silent failures caught: N", from `localStorage truecall.pg.caught`) + the "simulated environment" badge + GitHub/Spec links.

2. **Rail** (`app.js renderRail()`): a search `<input>` (filters by `tool`/`blurb`, case-insensitive), category filter chips (`All` + unique categories), and a card per scenario showing tool, blurb, a category tag, and a **status dot** (`<span class="dot">` — neutral, or `.good`/`.bad` set from `runStatus[id]` after a run). Clicking a card → `selectScenario(id)`.

3. **Panels** (`app.js renderPanels()`): panel 1 tool call (args + result via `highlightJson` → spans), panel 2 world (toggle ✅/❌ + highlighted world JSON), panel 3 contract (highlighted; edit reveal as in Phase 6, with the sentinel re-attach in `buildContract`).

4. **Timeline** (`app.js runVerification()` + `renderTimeline(stages)`): build stages = `[{label:"Tool returned", body:<result>}, {label:"TrueCall builds context", body:<ctx>}, ...one per check via engine.runCheck..., {label:"Verdict", body:<signal|ok>}]`. Render into `#console` as stage rows; animate reveal with `setTimeout` (~450ms/stage) unless `prefers-reduced-motion`. Controls: `#play` (auto-advance), `#step` (one stage), `#replay`. The first failing check row gets `.bad`; passing rows `.good`. On a caught result, increment `truecall.pg.caught` and refresh `#caught`; set `runStatus[current.id]`.

5. **Before/after diff** (`app.js renderDiff()`): two columns under the timeline — "Without TrueCall" (tool→success→agent "done ✅"→ reality from the current world: broken if bug) and "With TrueCall" (→ caught → self-corrects → fixed). Plain text/DOM nodes.

6. **Challenge mode** (`features.js`): a `#challenge` button toggles challenge state: hide panel 2, pick a random scenario + random world, show "Will TrueCall pass or catch this?" with `#guess-pass`/`#guess-catch` buttons; on guess → reveal world, run timeline, compare to actual, update `truecall.pg.stats` (streak/best/total), render the streak in the masthead, offer "Next".

7. **Intro card** (`features.js`): if `!sessionStorage.truecall.pg.seen`, show a dismissible overlay card ("what this is" + "Try the first scenario" button that selects scenario 0 and dismisses); set the flag on dismiss.

- [ ] **Step 1: Build `index.html`** — masthead (brand/tagline/metrics chips/#caught/badge/links), `<main>` with rail (`#search`, `#chips`, `#scenario-list`), stage (3 panels with `#call`/`#world`/`#contract`/editor, `#bug-toggle`, run button + `#play`/`#step`/`#replay`, `#console`, `#diff`), challenge controls (`#challenge`, `#guess-pass`, `#guess-catch`, `#streak`), and `#intro` overlay. Load `<script type="module" src="app.js">`. (app.js imports features.js.)

- [ ] **Step 2: Build `styles.css`** — extend Phase 6 with: metrics chip strip, search input, filter chips (active state), status dots (`.dot`/`.dot.good`/`.dot.bad` with a pulse keyframe), timeline stage rows (fade/slide-in keyframe), `.good`/`.bad` stage glyphs, diff two-column grid, challenge panel, intro overlay, and JSON highlight token colors (`.t-key{color:#6ea8ff}.t-str{color:#9ece6a}.t-num{color:#e0af68}.t-punct{color:#7c8190}` on light bg use darker variants for panels vs console). Wrap motion in `@media (prefers-reduced-motion: no-preference)`.

- [ ] **Step 3: Build `app.js`** — implement the masthead counter, `renderRail` (search+chips+dots), `renderPanels` (with `highlightJson` spans), `buildContract` (sentinel re-attach, from Phase 6), `runVerification`→`renderTimeline` (animated stages from real `runCheck` outcomes, increment caught-counter, set status dot), `renderDiff`, play/step/replay controls, and the exported `api` object; call `initFeatures(api)`. All DOM built with `createElement`/`textContent` (no innerHTML). A `spanList(tokens)` helper turns highlighter tokens into `<span class="t-...">` textContent spans.

- [ ] **Step 4: Build `features.js`** — `initFeatures(api)`: intro card (sessionStorage), challenge mode (localStorage stats, streak rendering), wired to `api`.

- [ ] **Step 5: Verify the engine/highlight tests still pass + render over http**

```bash
cd playground && node --test 2>&1 | grep -E "^# (tests|pass|fail)"   # expect 19 pass
python3 -m http.server 8099 >/tmp/h.log 2>&1 & SRV=$!; sleep 1.2
google-chrome --headless=new --no-sandbox --disable-gpu --hide-scrollbars --window-size=1280,1400 \
  --virtual-time-budget=6000 --screenshot=/tmp/rich.png "http://localhost:8099/index.html" 2>/dev/null
kill $SRV; magick identify -format '%wx%h colors=%k\n' /tmp/rich.png
```
Expected: many colors; eyeball `/tmp/rich.png` — masthead metrics, rail with chips + dots + 7 cards, panels with highlighted JSON, run controls. (Click-through interactions verified manually.)

- [ ] **Step 6: Commit**

```bash
git add playground/index.html playground/styles.css playground/app.js playground/features.js
git commit -m "feat(playground): rich UI — metrics masthead, filterable rail, animated timeline, diff, challenge mode

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**1. Spec coverage** (`docs/design-phase7-playground-rich.md` → task):
- 7 categorized scenarios → Task 1. ✓
- JSON highlighter (XSS-safe tokens) + tests → Task 1. ✓
- Engine tests cover all 7 + composite AND → Task 1. ✓
- Metrics masthead + caught counter → Task 2 (masthead). ✓
- Filterable rail + search + status dots → Task 2 (rail). ✓
- Animated timeline (play/step/replay, real runCheck outcomes, reduced-motion) → Task 2 (timeline). ✓
- Before/after diff → Task 2 (diff). ✓
- Challenge mode + localStorage streak → Task 2 (features.js). ✓
- Intro card → Task 2 (features.js). ✓
- XSS-safe (textContent/spans, highlighter returns data) → Global Constraints + Task 2. ✓
- engine.js / packages/core untouched → not modified by any task. ✓

**2. Placeholder scan:** Task 1 has complete code. Task 2 specifies each component's DOM ids, function names, behavior, and the app.js↔features.js interface precisely; full code authored at build, render+test-gated. The `<fn:kept-from-scenario>` sentinel is an intentional marker (Phase 6), not a placeholder.

**3. Type consistency:** `highlightJson(value)→{text,cls}[]` consistent across highlight.js, its test, and app.js's `spanList`. `SCENARIOS` item shape (adds `category`) consistent across scenarios.js, engine.test.js, app.js. The `api` object (`selectScenario`/`setWorld`/`runVerification`/`getState`/`els`) is the single contract between app.js and features.js. localStorage keys consistent (`truecall.pg.caught`, `truecall.pg.stats`, `truecall.pg.seen`).

## Notes
- Re-deploy after merge: `cd playground && vercel deploy --prod --yes --scope ai-edge-gallery` (public URL `truecall-eosin.vercel.app`).
- `app.js`/`features.js` are larger DOM modules; they're authored in full at build and verified by the engine/highlight unit tests + an http render screenshot (file:// can't load ES modules).
