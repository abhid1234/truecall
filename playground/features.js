// Challenge/quiz mode, first-visit intro, and localStorage stats. Driven via the `api`
// object app.js passes in (selectScenario/setWorld/runVerification/getState/els/SCENARIOS).
const $ = (id) => document.getElementById(id);
const LS_STATS = "truecall.pg.stats";
const SS_SEEN = "truecall.pg.seen";

function getStats() {
  try { return JSON.parse(localStorage.getItem(LS_STATS)) || { streak: 0, best: 0, total: 0, correct: 0 }; }
  catch { return { streak: 0, best: 0, total: 0, correct: 0 }; }
}
function setStats(s) { localStorage.setItem(LS_STATS, JSON.stringify(s)); }

export function initFeatures(api) {
  const refs = {
    challenge: $("challenge"), bar: $("challenge-bar"), q: $("challenge-q"),
    pass: $("guess-pass"), katch: $("guess-catch"), next: $("challenge-next"),
    exit: $("challenge-exit"), streak: $("streak"),
    intro: $("intro"), introGo: $("intro-go"),
  };
  let active = false;

  function renderStreak() {
    const s = getStats();
    if (s.total === 0) { refs.streak.hidden = true; return; }
    refs.streak.hidden = false;
    refs.streak.textContent = `challenge: ${s.correct}/${s.total} · streak ${s.streak} · best ${s.best}`;
  }

  function pick() {
    const list = api.SCENARIOS;
    const s = list[Math.floor(Math.random() * list.length)];
    api.selectScenario(s.id);
    api.setWorld(Math.random() < 0.5 ? "bug" : "ok");
    api.els.worldPanel.hidden = true;           // hide the answer
    refs.q.textContent = `Scenario: ${s.tool} — will TrueCall pass or catch this?`;
    refs.pass.hidden = refs.katch.hidden = false;
    refs.next.hidden = true;
  }

  async function guess(saidPass) {
    refs.pass.hidden = refs.katch.hidden = true;
    api.els.worldPanel.hidden = false;          // reveal the world
    const verdict = await api.runVerification();
    const correct = saidPass === !!verdict.ok;
    const s = getStats();
    s.total += 1;
    if (correct) { s.correct += 1; s.streak += 1; s.best = Math.max(s.best, s.streak); }
    else { s.streak = 0; }
    setStats(s); renderStreak();
    refs.q.textContent = correct ? "✅ Correct!" : "❌ Not quite — see the timeline.";
    refs.next.hidden = false;
  }

  function enter() { active = true; refs.bar.hidden = false; refs.challenge.textContent = "🎯 Challenge: on"; pick(); }
  function exit() { active = false; refs.bar.hidden = true; refs.challenge.textContent = "🎯 Challenge me"; api.els.worldPanel.hidden = false; }

  refs.challenge.addEventListener("click", () => (active ? exit() : enter()));
  refs.pass.addEventListener("click", () => guess(true));
  refs.katch.addEventListener("click", () => guess(false));
  refs.next.addEventListener("click", pick);
  refs.exit.addEventListener("click", exit);

  // first-visit intro
  if (!sessionStorage.getItem(SS_SEEN)) refs.intro.hidden = false;
  const dismiss = () => { sessionStorage.setItem(SS_SEEN, "1"); refs.intro.hidden = true; };
  refs.introGo.addEventListener("click", () => { api.selectScenario(api.SCENARIOS[0].id); dismiss(); });
  refs.intro.addEventListener("click", (e) => { if (e.target === refs.intro) dismiss(); });

  renderStreak();
}
