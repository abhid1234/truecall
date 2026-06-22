# TrueCall Playground (Phase 6) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A static, zero-build, in-browser playground where anyone runs TrueCall's verifier and watches it catch a silent tool failure (curated scenarios + a "silently failed" toggle + an editable contract), deployable to Vercel.

**Architecture:** A new `playground/` directory served as static files (like the RL Trajectory Auditor "Inspector"): `index.html` + `styles.css` + `app.js` + a faithful browser port of the verify engine (`engine.js`) + curated `scenarios.js`. The engine runs the real verification semantics; the IO checks (`file_exists`/`http`/`shell`) run against a simulated `world` object. `packages/core` is not modified.

**Tech Stack:** Vanilla HTML/CSS/JS, ES modules, **no framework, no build, no runtime deps**. Engine + scenarios are plain ESM `.js` (DOM-free) so they test under Node's built-in runner directly: `node --test` (no tsx/tsc needed — these files have no TypeScript and no Node-version TS dependency). Fonts via Google Fonts `<link>` (DM Serif Display / DM Sans / Fira Code). Deploy: Vercel static.

## Global Constraints

- **Static, zero-build, zero runtime dependencies.** `playground/` is served as-is. The only `package.json` is `{ "type": "module", "private": true }` so Node treats `.js` as ESM for tests; it declares no dependencies and is ignored by Vercel static serving.
- **`packages/core` untouched.** No file under `packages/core/` changes.
- **Deterministic.** The engine has no LLM; verdicts are predicate-based.
- **Faithful to `docs/spec.md`.** `engine.js` mirrors the spec's `runContract`/checks/`VerifyResult`; IO is simulated against `world`. Playground extension: a custom `verify` receives `(ctx, world)` so it can read the simulated world (the real core's `verify` receives only `ctx` and does its own IO — note this in a comment).
- **Honest UI.** A visible "simulated environment" badge.
- **No employer references**; pro-ecosystem framing.
- **Brand:** `--navy:#1a1a2e; --bg:#fafaf8; --blue:#4285F4; --console:#0d0f15; --good:#46d39a; --bad:#ff6b6b;`. Fonts DM Serif Display / DM Sans / Fira Code.
- **Tests:** `node --test playground/engine.test.js` (run from repo root or `playground/`).

## File Structure

```
playground/
├── package.json      # { "type": "module", "private": true }
├── engine.js         # browser+node verify engine (mirrors docs/spec.md; simulated IO)
├── scenarios.js      # curated scenario data (create_file, save_record, send_email)
├── engine.test.js    # node:test — engine verdicts match spec across all scenarios
├── index.html        # masthead + left rail + 3 panels + result console
├── styles.css        # TrueCall palette; light shell + dark console pane
├── app.js            # UI wiring (DOM); imports engine.js + scenarios.js
├── favicon.svg
├── vercel.json       # { "cleanUrls": true }
└── README.md         # what it is + local-run + deploy
```

---

### Task 1: The browser verify engine + scenarios + tests

**Files:**
- Create: `playground/package.json`, `playground/engine.js`, `playground/scenarios.js`
- Test: `playground/engine.test.js`

**Interfaces:**
- `engine.js` exports: `getPath(obj,path)`, `deepEqual(a,b)`, `interpolate(tmpl,ctx,transform?)`, `runCheck(check,ctx,world)`, `runContract(contract,ctx,world)→VerifyResult`, `class TemplateError`.
- `scenarios.js` exports: `SCENARIOS` — an array of `{ id, label, tool, blurb, call:{tool,args,result}, contract:{tool,description,post}, worlds:{ok,bug}, remediation }`.

- [ ] **Step 1: Create the package marker**

`playground/package.json`:
```json
{ "type": "module", "private": true }
```

- [ ] **Step 2: Write the engine**

`playground/engine.js`:
```js
// TrueCall verify engine — browser/Node port of the runtime (mirrors ../docs/spec.md).
// The IO checks (file_exists/http/shell) run against a SIMULATED `world` object, since a
// browser has no fs/shell/network-to-localhost. The orchestration, `result` check, custom
// `verify`, templating, and fail-closed semantics are faithful to the real core.
// Note: a custom `verify` here receives (ctx, world) so it can read the simulated world;
// the real core's verify receives only (ctx) and performs its own IO.

export class TemplateError extends Error {}

export function getPath(obj, path) {
  return String(path).split(".").reduce(
    (acc, k) => (acc == null || typeof acc !== "object" ? undefined : acc[k]),
    obj,
  );
}

export function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a), kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && deepEqual(a[k], b[k]));
}

const TOKEN = /\{\{\s*([\w.]+)\s*\}\}/g;
export function interpolate(tmpl, ctx, transform = (v) => v) {
  return String(tmpl).replace(TOKEN, (_m, expr) => {
    const val = getPath(ctx, expr);
    if (val === undefined) throw new TemplateError(`template path "{{${expr}}}" resolved to undefined`);
    return transform(String(val));
  });
}

export async function runCheck(check, ctx, world = {}) {
  if (check && typeof check.verify === "function") {
    const passed = !!(await check.verify(ctx, world));
    return {
      passed,
      expected: check.describe ?? "custom post-condition holds",
      actual: passed ? "predicate returned true" : "predicate returned false",
    };
  }
  switch (check && check.check) {
    case "file_exists": return fileExists(check, ctx, world);
    case "http": return httpCheck(check, ctx, world);
    case "shell": return shellCheck(check, ctx, world);
    case "result": return resultCheck(check, ctx);
    default: throw new Error(`unknown check type: ${check && check.check}`);
  }
}

function fileExists(c, ctx, world) {
  const path = interpolate(c.path, ctx);
  const expected = `file at ${path}` +
    (c.minSize !== undefined ? ` (size >= ${c.minSize})` : "") +
    (c.contains !== undefined ? ` containing "${c.contains}"` : "");
  const f = (world.files || {})[path];
  if (!f) return { passed: false, expected, actual: `no file exists at ${path}` };
  if (c.minSize !== undefined && (f.size ?? 0) < c.minSize)
    return { passed: false, expected, actual: `file size ${f.size ?? 0} < ${c.minSize}` };
  if (c.contains !== undefined && !String(f.content ?? "").includes(c.contains))
    return { passed: false, expected, actual: `file does not contain "${c.contains}"` };
  return { passed: true, expected, actual: `file exists at ${path} (size ${f.size ?? 0})` };
}

function resultCheck(c, ctx) {
  const val = getPath(ctx.result, c.path);
  const expected = `result.${c.path} ` +
    (c.exists ? "is present" : c.equals !== undefined ? `=== ${JSON.stringify(c.equals)}` : "present");
  if (c.exists && (val === undefined || val === null))
    return { passed: false, expected, actual: `result.${c.path} is ${String(val)}` };
  if (c.equals !== undefined && !deepEqual(val, c.equals))
    return { passed: false, expected, actual: `result.${c.path} = ${JSON.stringify(val)}` };
  return { passed: true, expected, actual: `result.${c.path} = ${JSON.stringify(val)}` };
}

function httpCheck(c, ctx, world) {
  const url = interpolate(c.url, ctx);
  const expected = `GET ${url}` +
    (c.status !== undefined ? ` -> status ${c.status}` : "") +
    (c.jsonPath !== undefined ? ` with ${c.jsonPath} === ${JSON.stringify(c.equals)}` : "");
  const res = (world.http || {})[url];
  if (!res) return { passed: false, expected, actual: "no response (the resource was never created)" };
  if (c.status !== undefined && res.status !== c.status)
    return { passed: false, expected, actual: `status ${res.status}` };
  if (c.jsonPath !== undefined) {
    const val = getPath(res.body, c.jsonPath);
    if (!deepEqual(val, c.equals)) return { passed: false, expected, actual: `${c.jsonPath} = ${JSON.stringify(val)}` };
  }
  return { passed: true, expected, actual: `status ${res.status}` };
}

function shellCheck(c, ctx, world) {
  const cmd = interpolate(c.cmd, ctx);
  const wantExit = c.exitCode ?? (c.stdoutMatches !== undefined ? undefined : 0);
  const expected = "`" + cmd + "`" +
    (wantExit !== undefined ? ` exits ${wantExit}` : "") +
    (c.stdoutMatches !== undefined ? ` stdout ~ /${c.stdoutMatches}/` : "");
  const r = (world.shell || {})[cmd] || { exitCode: 127, stdout: "" };
  if (wantExit !== undefined && r.exitCode !== wantExit)
    return { passed: false, expected, actual: `exit ${r.exitCode}` };
  if (c.stdoutMatches !== undefined && !new RegExp(c.stdoutMatches).test(r.stdout))
    return { passed: false, expected, actual: "stdout did not match" };
  return { passed: true, expected, actual: `exit ${r.exitCode}` };
}

export async function runContract(contract, ctx, world = {}) {
  const checks = Array.isArray(contract.post) ? contract.post : [contract.post];
  try {
    for (const chk of checks) {
      const outcome = await runCheck(chk, ctx, world);
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
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      error: true,
      tool: contract.tool,
      expected: contract.description ?? "post-condition is verifiable",
      actual: `verifier error: ${reason}`,
      message: `TrueCall could not verify ${contract.tool}: ${reason}`,
      remediation: "fix the contract or the simulated environment, then retry",
    };
  }
}
```

- [ ] **Step 3: Write the scenarios**

`playground/scenarios.js`:
```js
// Curated silent-failure scenarios. Each has a success-shaped tool result, a contract,
// and two simulated worlds: `ok` (the tool really did it) and `bug` (silent failure).
export const SCENARIOS = [
  {
    id: "create_file",
    label: "create_file",
    tool: "create_file",
    blurb: "Writes a file — but did the file actually land?",
    call: { tool: "create_file", args: { path: "/notes/out.txt", contents: "hello world" }, result: { status: "success", path: "/notes/out.txt" } },
    contract: {
      tool: "create_file",
      description: "a non-empty file exists at the requested path",
      post: { check: "file_exists", path: "{{args.path}}", minSize: 1 },
    },
    worlds: {
      ok: { files: { "/notes/out.txt": { size: 11, content: "hello world" } } },
      bug: { files: {} },
    },
    remediation: "retry create_file and confirm the write actually flushed to disk",
  },
  {
    id: "save_record",
    label: "save_record",
    tool: "save_record",
    blurb: "Persists a record to a store — or only claims to.",
    call: { tool: "save_record", args: { id: "r1", body: "buy milk" }, result: { status: "success", id: "r1" } },
    contract: {
      tool: "save_record",
      description: "the record is persisted in the store",
      post: { verify: (ctx, world) => !!(world.store && world.store[ctx.args.id]), describe: "record persisted in the store" },
    },
    worlds: {
      ok: { store: { r1: { id: "r1", body: "buy milk" } } },
      bug: { store: {} },
    },
    remediation: "the write returned success but committed nothing — retry inside a transaction and verify the row",
  },
  {
    id: "send_email",
    label: "send_email",
    tool: "send_email",
    blurb: "Sends an email — re-fetch to confirm it really sent.",
    call: { tool: "send_email", args: { to: "a@b.com", id: "m1" }, result: { status: "success", id: "m1" } },
    contract: {
      tool: "send_email",
      description: "a sent message exists for this recipient",
      post: { check: "http", url: "https://mail.local/api/messages/{{result.id}}", status: 200, jsonPath: "state", equals: "sent" },
    },
    worlds: {
      ok: { http: { "https://mail.local/api/messages/m1": { status: 200, body: { state: "sent" } } } },
      bug: { http: { "https://mail.local/api/messages/m1": { status: 404, body: {} } } },
    },
    remediation: "the API returned 200 but no message record exists — re-queue the send and re-check",
  },
];
```

- [ ] **Step 4: Write the failing test**

`playground/engine.test.js`:
```js
import test from "node:test";
import assert from "node:assert/strict";
import { runContract } from "./engine.js";
import { SCENARIOS } from "./scenarios.js";

for (const s of SCENARIOS) {
  test(`${s.id}: verified when the world reflects the effect`, async () => {
    const r = await runContract(s.contract, s.call, s.worlds.ok);
    assert.equal(r.ok, true);
  });
  test(`${s.id}: silent failure caught when the world didn't change`, async () => {
    const r = await runContract(s.contract, s.call, s.worlds.bug);
    assert.equal(r.ok, false);
    assert.ok(r.expected && r.actual && r.message, "signal must carry expected/actual/message");
  });
}

test("fail-closed: a throwing verify yields error:true", async () => {
  const c = { tool: "x", post: { verify: () => { throw new Error("boom"); }, describe: "x" } };
  const r = await runContract(c, { tool: "x", args: {}, result: {} }, {});
  assert.equal(r.ok, false);
  assert.equal(r.error, true);
});

test("missing template path is fail-closed", async () => {
  const c = { tool: "create_file", post: { check: "file_exists", path: "{{args.nope}}" } };
  const r = await runContract(c, { tool: "create_file", args: {}, result: {} }, { files: {} });
  assert.equal(r.ok, false);
  assert.equal(r.error, true);
});
```

- [ ] **Step 5: Run the test, verify it fails then passes**

Run (from `playground/`): `node --test engine.test.js`
First (before engine.js/scenarios.js exist) it errors on the import. After Steps 2–3 it must PASS — expect `# pass 8` (3 scenarios × 2 + 2 edge cases).

- [ ] **Step 6: Commit**

```bash
git add playground/package.json playground/engine.js playground/scenarios.js playground/engine.test.js
git commit -m "feat(playground): browser verify engine + curated scenarios + tests

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: The playground UI + Vercel config

**Files:**
- Create: `playground/index.html`, `playground/styles.css`, `playground/app.js`, `playground/favicon.svg`, `playground/vercel.json`, `playground/README.md`

**Interfaces:**
- Consumes `runContract` from `./engine.js` and `SCENARIOS` from `./scenarios.js`.
- No exports (browser entry). `app.js` is loaded as `<script type="module" src="app.js">`.

- [ ] **Step 1: Write `index.html`**

`playground/index.html`:
```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>TrueCall Playground — does your agent's tool call actually do the thing?</title>
<meta name="description" content="Run TrueCall's deterministic post-condition verifier in your browser and watch it catch a silent tool failure." />
<link rel="icon" href="favicon.svg" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=DM+Serif+Display&family=DM+Sans:wght@400;500;700&family=Fira+Code:wght@400;500&display=swap" rel="stylesheet" />
<link rel="stylesheet" href="styles.css" />
</head>
<body>
<header class="masthead">
  <div class="brand">TrueCall <span class="brand-sub">Playground</span></div>
  <div class="tagline">Your agent says "done." Did it? Run the verifier in your browser.</div>
  <div class="links">
    <span class="badge" title="file/shell/http checks run against a mock world in your browser">simulated environment</span>
    <a href="https://github.com/abhid1234/truecall" target="_blank" rel="noopener">GitHub</a>
    <a href="https://github.com/abhid1234/truecall/blob/main/docs/spec.md" target="_blank" rel="noopener">Spec</a>
  </div>
</header>
<main>
  <aside class="rail">
    <div class="rail-title">Scenarios</div>
    <ul id="scenario-list"></ul>
    <p class="rail-note">Pick a scenario, flip <b>silently failed</b>, then Run TrueCall.</p>
  </aside>
  <section class="stage">
    <div class="panel">
      <div class="panel-h">1 · The tool call</div>
      <div id="call" class="mono"></div>
    </div>
    <div class="panel">
      <div class="panel-h">2 · The world <span class="panel-hint">(simulated)</span></div>
      <div class="toggle-row">
        <label class="switch"><input type="checkbox" id="bug-toggle" /><span class="slider"></span></label>
        <span id="bug-label" class="toggle-label"></span>
      </div>
      <div id="world" class="mono dim"></div>
    </div>
    <div class="panel">
      <div class="panel-h">3 · The contract <button id="edit-btn" class="ghost">edit</button></div>
      <div id="contract" class="mono"></div>
      <textarea id="contract-editor" class="editor" spellcheck="false" hidden></textarea>
      <div id="editor-note" class="editor-note" hidden>Editing the contract JSON. <code>verify</code> functions are kept from the scenario.</div>
    </div>
    <button id="run" class="run">▶ Run TrueCall</button>
    <div class="panel console-panel">
      <div class="panel-h">Result</div>
      <pre id="console" class="console">Pick a scenario and press Run.</pre>
    </div>
  </section>
</main>
<script type="module" src="app.js"></script>
</body>
</html>
```

- [ ] **Step 2: Write `styles.css`**

`playground/styles.css`:
```css
:root{--navy:#1a1a2e;--bg:#fafaf8;--card:#fff;--ink:#23232b;--muted:#5b5b6b;--line:#e7e7e0;
--blue:#4285F4;--console:#0d0f15;--good:#46d39a;--bad:#ff6b6b;
--mono:"Fira Code",ui-monospace,monospace;--sans:"DM Sans",system-ui,sans-serif;--display:"DM Serif Display",Georgia,serif;}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font-family:var(--sans);line-height:1.5}
.masthead{display:flex;flex-wrap:wrap;align-items:baseline;gap:14px;padding:18px 26px;border-bottom:1px solid var(--line);background:#fff}
.brand{font-family:var(--display);font-size:26px;color:var(--navy)}
.brand-sub{color:var(--blue)}
.tagline{color:var(--muted);font-size:15px;flex:1;min-width:220px}
.links{display:flex;gap:14px;align-items:center;font-size:14px}
.links a{color:var(--blue);text-decoration:none}
.badge{background:#fff4d6;border:1px solid #f0d98a;color:#7a5b00;border-radius:20px;padding:3px 11px;font-size:12px}
main{display:grid;grid-template-columns:260px 1fr;gap:22px;max-width:1080px;margin:0 auto;padding:22px 26px}
.rail-title{font-size:12px;letter-spacing:2px;text-transform:uppercase;color:var(--muted);margin-bottom:10px}
#scenario-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px}
.scn{border:1px solid var(--line);background:#fff;border-radius:12px;padding:12px 14px;cursor:pointer}
.scn:hover{border-color:var(--blue)}
.scn.active{border-color:var(--blue);box-shadow:0 0 0 2px rgba(66,133,244,.15)}
.scn .t{font-family:var(--mono);font-weight:500;color:var(--navy)}
.scn .b{font-size:13px;color:var(--muted);margin-top:2px}
.rail-note{font-size:12.5px;color:var(--muted);margin-top:14px}
.stage{display:flex;flex-direction:column;gap:16px;min-width:0}
.panel{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px 18px}
.panel-h{font-size:13px;font-weight:700;color:var(--navy);margin-bottom:10px;display:flex;align-items:center;gap:8px}
.panel-hint{font-weight:400;color:var(--muted)}
.mono{font-family:var(--mono);font-size:13.5px;white-space:pre-wrap;word-break:break-word}
.dim{color:var(--muted)}
.toggle-row{display:flex;align-items:center;gap:12px;margin-bottom:10px}
.toggle-label{font-weight:500}
.switch{position:relative;display:inline-block;width:52px;height:28px}
.switch input{display:none}
.slider{position:absolute;inset:0;background:var(--good);border-radius:28px;transition:.15s;cursor:pointer}
.slider:before{content:"";position:absolute;height:22px;width:22px;left:3px;top:3px;background:#fff;border-radius:50%;transition:.15s}
input:checked + .slider{background:var(--bad)}
input:checked + .slider:before{transform:translateX(24px)}
.ghost{margin-left:auto;background:none;border:1px solid var(--line);border-radius:8px;color:var(--blue);font-size:12px;padding:3px 10px;cursor:pointer}
.editor{width:100%;height:200px;font-family:var(--mono);font-size:13px;border:1px solid var(--line);border-radius:10px;padding:12px;margin-top:10px;resize:vertical}
.editor-note{font-size:12px;color:var(--muted);margin-top:8px}
.run{align-self:flex-start;background:var(--blue);color:#fff;border:none;border-radius:12px;font-size:16px;font-weight:700;padding:12px 22px;cursor:pointer}
.run:hover{filter:brightness(1.05)}
.console-panel{padding-bottom:18px}
.console{background:var(--console);color:#cfd2dc;border-radius:12px;padding:18px 18px;font-family:var(--mono);font-size:13.5px;white-space:pre-wrap;word-break:break-word;min-height:120px;margin:0}
.console .good{color:var(--good)} .console .bad{color:var(--bad)} .console .key{color:#6ea8ff} .console .dim{color:#7c8190}
@media(max-width:760px){main{grid-template-columns:1fr}}
```

- [ ] **Step 3: Write `app.js`**

`playground/app.js`:
```js
import { runContract } from "./engine.js";
import { SCENARIOS } from "./scenarios.js";

const $ = (id) => document.getElementById(id);
let current = SCENARIOS[0];
let editing = false;

function esc(s) { return String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c])); }
function pretty(o) { return JSON.stringify(o, null, 2); }

// contract -> display string (verify fns can't JSON-serialize; show a marker)
function contractDisplay(c) {
  return pretty(c, ).replace(/"verify": *null/, '"verify": <fn>');
}
function contractToText(c) {
  const clone = JSON.parse(JSON.stringify(c, (k, v) => (typeof v === "function" ? "<fn:kept-from-scenario>" : v)));
  return pretty(clone);
}

function renderRail() {
  $("scenario-list").innerHTML = "";
  for (const s of SCENARIOS) {
    const li = document.createElement("li");
    li.className = "scn" + (s.id === current.id ? " active" : "");
    li.innerHTML = `<div class="t">${esc(s.tool)}</div><div class="b">${esc(s.blurb)}</div>`;
    li.onclick = () => { current = s; editing = false; renderAll(); };
    $("scenario-list").appendChild(li);
  }
}

function renderAll() {
  renderRail();
  $("call").textContent = "tool: " + current.call.tool + "\nargs: " + pretty(current.call.args) + "\nreturned: " + pretty(current.call.result);
  $("contract").textContent = contractToText(current.contract);
  $("contract").hidden = editing;
  $("contract-editor").hidden = !editing;
  $("editor-note").hidden = !editing;
  if (editing) $("contract-editor").value = contractToText(current.contract);
  syncWorld();
  $("console").textContent = "Pick a scenario and press Run.";
}

function syncWorld() {
  const bug = $("bug-toggle").checked;
  $("bug-label").textContent = bug ? "Silently failed ❌" : "Tool actually did it ✅";
  const world = bug ? current.worlds.bug : current.worlds.ok;
  $("world").textContent = pretty(world);
}

function buildContract() {
  if (!editing) return current.contract;
  // power-user: parse edited JSON, but re-attach any verify fn from the scenario
  let parsed;
  try { parsed = JSON.parse($("contract-editor").value); }
  catch (e) { throw new Error("contract JSON is invalid: " + e.message); }
  const orig = Array.isArray(current.contract.post) ? current.contract.post : [current.contract.post];
  const posts = Array.isArray(parsed.post) ? parsed.post : [parsed.post];
  posts.forEach((p, i) => { if (p && p.verify === "<fn:kept-from-scenario>" && orig[i]) p.verify = orig[i].verify; });
  parsed.post = Array.isArray(parsed.post) ? posts : posts[0];
  return parsed;
}

async function run() {
  const bug = $("bug-toggle").checked;
  const world = bug ? current.worlds.bug : current.worlds.ok;
  let contract;
  try { contract = buildContract(); } catch (e) { renderResult({ ok: false, error: true, message: e.message }); return; }
  const v = await runContract(contract, current.call, world);
  renderResult(v, current.remediation);
}

function renderResult(v, remediation) {
  const c = $("console");
  if (v.ok) {
    c.innerHTML = `<span class="good">✅ verified</span> — post-condition holds. The tool's result passes through to the agent unchanged.`;
    return;
  }
  const rem = v.remediation || remediation;
  c.innerHTML =
    `<span class="bad">❌ ${v.error ? "could not verify" : "silent failure caught"}</span>\n\n` +
    `<span class="key">tool</span>     ${esc(v.tool ?? "")}\n` +
    `<span class="key">expected</span> ${esc(v.expected ?? "")}\n` +
    `<span class="key">actual</span>   ${esc(v.actual ?? "")}\n` +
    `<span class="key">message</span>  ${esc(v.message ?? "")}\n` +
    (rem ? `<span class="key">try</span>      ${esc(rem)}\n` : "") +
    `\n<span class="dim">→ TrueCall returns this signal to the agent instead of a false success.</span>`;
}

$("bug-toggle").addEventListener("change", syncWorld);
$("run").addEventListener("click", run);
$("edit-btn").addEventListener("click", () => { editing = !editing; renderAll(); });
renderAll();
```

- [ ] **Step 4: Write `favicon.svg`, `vercel.json`, `README.md`**

`playground/favicon.svg`:
```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="#1a1a2e"/><path d="M8 16.5l5 5 11-12" fill="none" stroke="#46d39a" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
```

`playground/vercel.json`:
```json
{ "cleanUrls": true }
```

`playground/README.md`:
````markdown
# TrueCall Playground

An in-browser, zero-build demo of TrueCall: pick a scenario, flip "silently failed," and watch the
deterministic verifier catch a tool that returned success but didn't change the world.

Static HTML/CSS/JS — no framework, no build, no backend. The verify engine (`engine.js`) mirrors
[`docs/spec.md`](../docs/spec.md); the `file_exists`/`http`/`shell` checks run against a **simulated
environment** in your browser (a real browser has no fs/shell/network-to-localhost).

## Run locally
Open `index.html` in a browser, or serve the folder:
```bash
cd playground && python3 -m http.server 8000   # then open http://localhost:8000
```

## Test the engine
```bash
cd playground && node --test engine.test.js
```

## Deploy (Vercel, static)
```bash
cd playground && vercel deploy --prod --yes
```
````

- [ ] **Step 5: Verify it renders (headless Chrome)**

Run (from `playground/`):
```bash
google-chrome --headless=new --no-sandbox --disable-gpu --hide-scrollbars \
  --window-size=1280,1000 --virtual-time-budget=5000 \
  --screenshot=/tmp/pg.png "file://$PWD/index.html"
magick identify -format '%wx%h colors=%k\n' /tmp/pg.png
```
Expected: a ~1280×1000 PNG with many colors (not blank) — the masthead, scenario rail, and three panels render. Eyeball `/tmp/pg.png`.

- [ ] **Step 6: Re-run the engine test (no regression) and commit**

```bash
node --test engine.test.js   # expect: # pass 8
git add playground/index.html playground/styles.css playground/app.js playground/favicon.svg playground/vercel.json playground/README.md
git commit -m "feat(playground): UI (scenarios, world toggle, contract editor, result console) + Vercel config

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**1. Spec coverage** (`docs/design-phase6-playground.md` → task):
- Static zero-build dir, ESM, no deps → Task 1 (package.json) + Task 2 (static files). ✓
- Faithful engine mirroring spec + simulated IO + fail-closed + verify(ctx,world) extension → Task 1 `engine.js`. ✓
- Curated scenarios (create_file/save_record/send_email) with ok/bug worlds → Task 1 `scenarios.js`. ✓
- Engine regression tests (verdicts match spec) → Task 1 `engine.test.js`. ✓
- UX: masthead + rail + 3 panels (call/world+toggle/contract+editor) + run + console + simulated badge → Task 2. ✓
- TrueCall brand palette + fonts → Task 2 `styles.css`. ✓
- Power-user editable contract (keeps verify fns) → Task 2 `app.js` (`buildContract`). ✓
- Vercel static config + README + deploy command → Task 2. ✓
- `packages/core` untouched → no task touches it. ✓

**2. Placeholder scan:** No TBD/TODO; all code complete. The `<fn>`/`<fn:kept-from-scenario>` tokens are intentional display markers for non-serializable `verify` functions, handled in `buildContract`.

**3. Type consistency:** `runContract(contract, ctx, world)` signature identical in engine, tests, and app. `SCENARIOS` item shape (`call`/`contract`/`worlds.ok`/`worlds.bug`/`remediation`) consistent across scenarios.js, engine.test.js, and app.js. Console renders the `VerifyResult` fields (`tool`/`expected`/`actual`/`message`/`remediation`) the engine produces.

## Notes
- Deploy (`vercel deploy`) needs the user's Vercel auth and is run after merge; not a task gate here.
- Engine/scenarios are DOM-free so `node --test` runs them directly (no tsx/tsc) — `app.js` (DOM) is browser-only and not imported by tests.
