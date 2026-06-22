import { runContract, runCheck } from "./engine.js";
import { SCENARIOS } from "./scenarios.js";
import { highlightJson } from "./highlight.js";
import { initFeatures } from "./features.js";

const $ = (id) => document.getElementById(id);
const els = {
  search: $("search"), chips: $("chips"), list: $("scenario-list"),
  call: $("call"), world: $("world"), worldPanel: $("world-panel"), contract: $("contract"),
  editor: $("contract-editor"), editorNote: $("editor-note"), editBtn: $("edit-btn"),
  bug: $("bug-toggle"), bugLabel: $("bug-label"), run: $("run"),
  play: $("play"), step: $("step"), replay: $("replay"),
  console: $("console"), diff: $("diff"), diffPanel: $("diff-panel"),
  caught: $("caught"),
};

let current = SCENARIOS[0];
let filter = "all";
let query = "";
let editing = false;
const runStatus = {}; // id -> 'good' | 'bad'

const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const LS_CAUGHT = "truecall.pg.caught";

/* ---------- helpers ---------- */
function el(tag, cls, text) { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; }
function spanList(obj) { return highlightJson(obj).map((t) => el("span", "t-" + t.cls, t.text)); }
function renderJson(node, obj) { node.replaceChildren(...spanList(obj)); }
function getCaught() { return Number(localStorage.getItem(LS_CAUGHT) || 0); }
function setCaught(n) { localStorage.setItem(LS_CAUGHT, String(n)); els.caught.textContent = `silent failures caught: ${n}`; }

function checkLabel(c) {
  if (c && typeof c.verify === "function") return c.describe || "custom verify";
  if (!c) return "check";
  if (c.check === "file_exists") return `file_exists ${c.path}`;
  if (c.check === "http") return `http ${c.url}`;
  if (c.check === "shell") return `shell \`${c.cmd}\``;
  if (c.check === "result") return `result.${c.path}`;
  return c.check || "check";
}

/* ---------- rail ---------- */
function renderChips() {
  const cats = ["all", ...Array.from(new Set(SCENARIOS.map((s) => s.category)))];
  els.chips.replaceChildren(...cats.map((c) => {
    const b = el("button", "chip" + (c === filter ? " active" : ""), c);
    b.addEventListener("click", () => { filter = c; renderRail(); });
    return b;
  }));
}
function renderRail() {
  renderChips();
  const q = query.toLowerCase();
  const items = SCENARIOS.filter((s) =>
    (filter === "all" || s.category === filter) &&
    (q === "" || (s.tool + " " + s.blurb).toLowerCase().includes(q)));
  els.list.replaceChildren(...items.map((s) => {
    const li = el("li", "scn" + (s.id === current.id ? " active" : ""));
    const top = el("div", "scn-top");
    top.append(el("span", "dot" + (runStatus[s.id] ? " " + runStatus[s.id] : "")),
      el("span", "t", s.tool), el("span", "cat", s.category));
    li.append(top, el("div", "b", s.blurb));
    li.addEventListener("click", () => selectScenario(s.id));
    return li;
  }));
}

/* ---------- panels ---------- */
function renderPanels() {
  els.call.replaceChildren(
    el("span", "t-plain", "tool: " + current.call.tool + "\nargs: "), ...spanList(current.call.args),
    el("span", "t-plain", "\nreturned: "), ...spanList(current.call.result));
  syncWorld();
  renderContract();
}
function renderContract() {
  renderJson(els.contract, current.contract);
  els.contract.hidden = editing;
  els.editor.hidden = !editing;
  els.editorNote.hidden = !editing;
  els.editBtn.textContent = editing ? "done" : "edit";
  if (editing) els.editor.value = JSON.stringify(JSON.parse(JSON.stringify(current.contract, (k, v) => (typeof v === "function" ? "<fn:kept-from-scenario>" : v))), null, 2);
}
function worldKey() { return els.bug.checked ? "bug" : "ok"; }
function syncWorld() {
  els.bugLabel.textContent = els.bug.checked ? "Silently failed ❌" : "Tool actually did it ✅";
  renderJson(els.world, current.worlds[worldKey()]);
}

function buildContract() {
  if (!editing) return current.contract;
  let parsed;
  try { parsed = JSON.parse(els.editor.value); } catch (e) { throw new Error("contract JSON is invalid: " + e.message); }
  const orig = Array.isArray(current.contract.post) ? current.contract.post : [current.contract.post];
  const posts = Array.isArray(parsed.post) ? parsed.post : [parsed.post];
  posts.forEach((p, i) => { if (p && p.verify === "<fn:kept-from-scenario>" && orig[i]) p.verify = orig[i].verify; });
  parsed.post = Array.isArray(parsed.post) ? posts : posts[0];
  return parsed;
}

/* ---------- timeline ---------- */
let stages = [], shown = 0, timer = null;
function clearTimer() { if (timer) { clearTimeout(timer); timer = null; } }
function stageRow(s) {
  const row = el("div", "stagerow" + (s.kind ? " " + s.kind : ""));
  row.append(el("span", "glyph", s.glyph || "·"), el("span", "lbl", s.label));
  const body = el("span", "body");
  if (s.json !== undefined) body.append(...spanList(s.json)); else body.textContent = s.text || "";
  row.append(body);
  return row;
}
function paint() { els.console.replaceChildren(...stages.slice(0, shown).map(stageRow)); }
function play() { clearTimer(); const tick = () => { if (shown < stages.length) { shown++; paint(); timer = setTimeout(tick, 480); } else clearTimer(); }; tick(); }
function stepOne() { clearTimer(); if (shown < stages.length) { shown++; paint(); } }
function replay() { shown = 0; paint(); if (reduced) { shown = stages.length; paint(); } else play(); }

async function computeStages(contract, ctx, world) {
  const out = [
    { label: "Tool returned", glyph: "→", json: ctx.result },
    { label: "TrueCall builds context", glyph: "·", json: { tool: ctx.tool, args: ctx.args, result: ctx.result } },
  ];
  const checks = Array.isArray(contract.post) ? contract.post : [contract.post];
  for (const chk of checks) {
    try {
      const o = await runCheck(chk, ctx, world);
      out.push({ label: "check · " + checkLabel(chk), glyph: o.passed ? "✓" : "✗", kind: o.passed ? "good" : "bad",
        text: o.passed ? "passed — " + o.actual : "FAILED — expected " + o.expected + "; got " + o.actual });
      if (!o.passed) break; // AND short-circuit
    } catch (e) {
      out.push({ label: "check · " + checkLabel(chk), glyph: "✗", kind: "bad", text: "could not verify — " + e.message });
      break;
    }
  }
  return out;
}

export async function runVerification() {
  const ctx = current.call, world = current.worlds[worldKey()];
  let contract;
  try { contract = buildContract(); } catch (e) { stages = [{ label: "Error", glyph: "✗", kind: "bad", text: e.message }]; shown = stages.length; paint(); return { ok: false, error: true, message: e.message }; }
  const verdict = await runContract(contract, ctx, world);
  stages = await computeStages(contract, ctx, world);
  if (verdict.ok) {
    stages.push({ label: "Verdict", glyph: "✅", kind: "verdict-good", text: "verified — the tool's result passes through to the agent unchanged." });
  } else {
    const rem = verdict.remediation || current.remediation;
    stages.push({ label: "Verdict", glyph: "❌", kind: "verdict-bad",
      text: `${verdict.error ? "could not verify" : "silent failure caught"}\nexpected ${verdict.expected || ""}\nactual   ${verdict.actual || ""}\n${rem ? "try      " + rem + "\n" : ""}→ returned to the agent instead of a false success.` });
  }
  // side effects
  runStatus[current.id] = verdict.ok ? "good" : "bad";
  if (!verdict.ok && !verdict.error) setCaught(getCaught() + 1);
  renderRail();
  renderDiff(verdict, world);
  els.play.hidden = els.step.hidden = els.replay.hidden = false;
  els.diffPanel.hidden = false;
  shown = 0; paint();
  if (reduced) { shown = stages.length; paint(); } else play();
  return verdict;
}

function renderDiff(verdict, world) {
  const bug = els.bug.checked;
  const without = el("div", "col without");
  without.append(el("h4", null, "Without TrueCall"));
  without.append(el("div", "step", "1 · tool returns success"));
  without.append(el("div", "step", "2 · agent reports: done ✅"));
  without.append(el("div", "reality " + (bug ? "broken" : "fixed"), bug ? "reality: the work never happened — ships broken" : "reality: the work happened"));
  const wi = el("div", "col with");
  wi.append(el("h4", null, "With TrueCall"));
  wi.append(el("div", "step", "1 · tool returns success"));
  wi.append(el("div", "step", "2 · TrueCall runs the post-condition"));
  if (verdict.ok) {
    wi.append(el("div", "step", "3 · verified → passes through"));
    wi.append(el("div", "reality fixed", "reality: confirmed done"));
  } else {
    wi.append(el("div", "step", "3 · " + (verdict.error ? "could not verify → flagged" : "silent failure caught → correction sent")));
    wi.append(el("div", "step", "4 · agent self-corrects"));
    wi.append(el("div", "reality fixed", "reality: caught before it shipped"));
  }
  els.diff.replaceChildren(without, wi);
}

/* ---------- selection + events ---------- */
function selectScenario(id) {
  current = SCENARIOS.find((s) => s.id === id) || current;
  editing = false;
  els.console.replaceChildren(el("span", "dim", "Press Run to verify this tool call."));
  els.play.hidden = els.step.hidden = els.replay.hidden = true;
  els.diffPanel.hidden = true;
  renderRail(); renderPanels();
}
function setWorld(key) { els.bug.checked = key === "bug"; syncWorld(); }
function getState() { return { current, world: worldKey() }; }

els.search.addEventListener("input", () => { query = els.search.value; renderRail(); });
els.bug.addEventListener("change", syncWorld);
els.run.addEventListener("click", runVerification);
els.play.addEventListener("click", () => { if (shown >= stages.length) replay(); else play(); });
els.step.addEventListener("click", stepOne);
els.replay.addEventListener("click", replay);
els.editBtn.addEventListener("click", () => { editing = !editing; renderContract(); });

renderRail();
renderPanels();
setCaught(getCaught());
initFeatures({ selectScenario, setWorld, runVerification, getState, els, SCENARIOS });
