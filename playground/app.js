import { runContract } from "./engine.js";
import { SCENARIOS } from "./scenarios.js";

const $ = (id) => document.getElementById(id);
let current = SCENARIOS[0];
let editing = false;

function pretty(o) { return JSON.stringify(o, null, 2); }
function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

// contract -> editable text; verify fns can't JSON-serialize, so mark them
function contractToText(c) {
  const clone = JSON.parse(JSON.stringify(c, (k, v) => (typeof v === "function" ? "<fn:kept-from-scenario>" : v)));
  return pretty(clone);
}

function renderRail() {
  const list = $("scenario-list");
  list.textContent = "";
  for (const s of SCENARIOS) {
    const li = el("li", "scn" + (s.id === current.id ? " active" : ""));
    li.append(el("div", "t", s.tool), el("div", "b", s.blurb));
    li.addEventListener("click", () => { current = s; editing = false; renderAll(); });
    list.appendChild(li);
  }
}

function renderAll() {
  renderRail();
  $("call").textContent = "tool: " + current.call.tool + "\nargs: " + pretty(current.call.args) + "\nreturned: " + pretty(current.call.result);
  $("contract").textContent = contractToText(current.contract);
  $("contract").hidden = editing;
  $("contract-editor").hidden = !editing;
  $("editor-note").hidden = !editing;
  $("edit-btn").textContent = editing ? "done" : "edit";
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
  let parsed;
  try { parsed = JSON.parse($("contract-editor").value); }
  catch (e) { throw new Error("contract JSON is invalid: " + e.message); }
  // re-attach any verify fn from the scenario (functions don't survive JSON)
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

// All dynamic values are inserted via textContent (no innerHTML) — XSS-safe even with
// user-edited contract JSON flowing into the result fields.
function renderResult(v, remediation) {
  const c = $("console");
  c.textContent = "";
  if (v.ok) {
    c.append(el("span", "good", "✅ verified"),
      document.createTextNode(" — post-condition holds. The tool's result passes through to the agent unchanged."));
    return;
  }
  const rem = v.remediation || remediation;
  const line = (k, val) => c.append(el("span", "key", k.padEnd(9)), document.createTextNode(" " + (val ?? "") + "\n"));
  c.append(el("span", "bad", `❌ ${v.error ? "could not verify" : "silent failure caught"}`), document.createTextNode("\n\n"));
  line("tool", v.tool);
  line("expected", v.expected);
  line("actual", v.actual);
  line("message", v.message);
  if (rem) line("try", rem);
  c.append(document.createTextNode("\n"),
    el("span", "dim", "→ TrueCall returns this signal to the agent instead of a false success."));
}

$("bug-toggle").addEventListener("change", syncWorld);
$("run").addEventListener("click", run);
$("edit-btn").addEventListener("click", () => { editing = !editing; renderAll(); });
renderAll();
