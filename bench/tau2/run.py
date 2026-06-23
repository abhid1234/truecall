"""Run the paired TrueCall × τ²-bench experiment and report the metrics that matter.

Two arms on the SAME tasks + SAME fault seed:
  baseline : WRITE tools silently fail (faults injected); TrueCall does NOT correct
  truecall : same faults; TrueCall catches + corrects in-flight

Reports, per arm: mean reward (normally-terminated sims), a matched-task Δreward (only
(task,trial) pairs that completed in both arms — controls for transient API errors), the
TrueCall seam stats (catches / corrections / false positives), and — the key recovery
indicator — the **retry rate**: after a correction, how often the agent re-calls the failed
tool (vs. gives up).

NEEDS: ./setup.sh first, and an LLM API key in the env (OPENAI_API_KEY / ANTHROPIC_API_KEY /
GEMINI_API_KEY). Gemini 2.5 models need `--reasoning-effort disable` (their thinking mode
otherwise emits empty messages τ²-bench rejects). The verifier/contracts/faults are
unit-tested key-free: `python3 -m unittest discover -s tests`.
"""
from __future__ import annotations
import argparse
import json
import os
import shutil
import subprocess
from glob import glob
from pathlib import Path

HERE = Path(__file__).resolve().parent


# --- locating + loading saved tau2 results -----------------------------------
def _find_results(name: str) -> Path | None:
    for base in (HERE, HERE / ".tau2", Path.cwd()):
        hits = glob(str(base / "**" / "simulations" / name / "results.json"), recursive=True)
        if hits:
            return Path(hits[0])
    return None


def _clear(name: str) -> None:
    for base in (HERE, HERE / ".tau2", Path.cwd()):
        for d in glob(str(base / "**" / "simulations" / name), recursive=True):
            shutil.rmtree(d, ignore_errors=True)


def _load(name: str) -> list[dict]:
    p = _find_results(name)
    return json.loads(p.read_text())["simulations"] if p else []


def _reward(s: dict):
    ri = s.get("reward_info") or {}
    return ri.get("reward") if isinstance(ri, dict) else None


def _normal(s: dict) -> bool:
    return str(s.get("termination_reason") or "") in ("user_stop", "agent_stop", "max_steps") and _reward(s) is not None


def _tcname(tc: dict):
    return tc.get("name") or (tc.get("function") or {}).get("name")


# --- metrics -----------------------------------------------------------------
def mean_reward(sims: list[dict]):
    rs = [_reward(s) for s in sims if _normal(s)]
    return sum(rs) / len(rs) if rs else None


def matched_delta(base: list[dict], tc: list[dict]):
    B = {(s["task_id"], s["trial"]): s for s in base}
    T = {(s["task_id"], s["trial"]): s for s in tc}
    keys = [k for k in B if k in T and _normal(B[k]) and _normal(T[k])]
    if not keys:
        return None
    br = sum(_reward(B[k]) for k in keys) / len(keys)
    tr = sum(_reward(T[k]) for k in keys) / len(keys)
    return {"n": len(keys), "baseline": br, "truecall": tr, "delta": tr - br}


def retry_rate(sims: list[dict]):
    """After each [TrueCall] correction, did the agent re-call the failed tool?"""
    retried = other = gave_up = 0
    for s in sims:
        msgs = s.get("messages") or []
        for i, m in enumerate(msgs):
            if "[TrueCall]" not in str(m.get("content") or ""):
                continue
            prev = next((msgs[j] for j in range(i - 1, -1, -1)
                         if msgs[j].get("role") == "assistant" and msgs[j].get("tool_calls")), None)
            corrected = _tcname((prev.get("tool_calls") or [{}])[0]) if prev else None
            nxt = next((msgs[j] for j in range(i + 1, len(msgs)) if msgs[j].get("role") == "assistant"), None)
            if not nxt:
                continue
            ntools = [_tcname(tc) for tc in (nxt.get("tool_calls") or [])]
            if not ntools:
                gave_up += 1
            elif corrected in ntools:
                retried += 1
            else:
                other += 1
    n = retried + other + gave_up
    return {"n": n, "retried_pct": 100 * retried / n, "gave_up_pct": 100 * gave_up / n} if n else None


def total_cost(*name_lists) -> float:
    seen, tot = set(), 0.0
    for name in name_lists:
        for s in _load(name):
            sid = s.get("id")
            if sid in seen:
                continue
            seen.add(sid)
            tot += (s.get("agent_cost") or 0) + (s.get("user_cost") or 0)
    return tot


# --- running an arm ----------------------------------------------------------
def run_arm(name, domain, model, tasks, trials, seed, fault_p, correct, max_steps,
            concurrency, reasoning_effort):
    _clear(name)  # avoid tau2's interactive "resume? (y/n)" prompt on a stale dir
    stats_out = HERE / f".{name}.stats.json"
    env = dict(os.environ)
    env.update({
        "PYTHONPATH": f"{HERE}:{env.get('PYTHONPATH', '')}",  # auto-imports sitecustomize -> installs seam
        "TRUECALL_ENABLE": "1", "TRUECALL_CORRECT": "1" if correct else "0",
        "TRUECALL_FAULT_P": str(fault_p), "TRUECALL_SEED": str(seed),
        "TRUECALL_DOMAIN": domain, "TRUECALL_STATS_OUT": str(stats_out),
    })
    cmd = ["tau2", "run", "--domain", domain, "--agent-llm", model, "--user-llm", model,
           "--num-tasks", str(tasks), "--num-trials", str(trials), "--seed", str(seed),
           "--max-concurrency", str(concurrency), "--max-steps", str(max_steps),
           "--save-to", name]
    if reasoning_effort:
        args = json.dumps({"reasoning_effort": reasoning_effort})
        cmd += ["--agent-llm-args", args, "--user-llm-args", args]
    print(f"\n=== arm: {name} (correct={int(correct)}, fault_p={fault_p}) ===")
    subprocess.run(cmd, env=env, check=True)
    stats = json.loads(stats_out.read_text()) if stats_out.exists() else {}
    return {"name": name, "stats": stats, "sims": _load(name)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--domain", default="retail")
    ap.add_argument("--model", default="gpt-4o-mini")
    ap.add_argument("--tasks", type=int, default=5)
    ap.add_argument("--trials", type=int, default=2)
    ap.add_argument("--seed", type=int, default=12345)
    ap.add_argument("--fault-p", type=float, default=0.3)
    ap.add_argument("--max-steps", type=int, default=40)
    ap.add_argument("--concurrency", type=int, default=4)
    ap.add_argument("--reasoning-effort", default="",
                    help="pass to the LLM (gemini-2.5 needs 'disable' to avoid empty messages)")
    ap.add_argument("--no-faults", action="store_true", help="premature-done-gate experiment (no injected faults)")
    a = ap.parse_args()
    p = 0.0 if a.no_faults else a.fault_p
    common = dict(domain=a.domain, model=a.model, tasks=a.tasks, trials=a.trials, seed=a.seed,
                  fault_p=p, max_steps=a.max_steps, concurrency=a.concurrency,
                  reasoning_effort=a.reasoning_effort)

    base = run_arm("tc_baseline", correct=False, **common)
    tc = run_arm("tc_truecall", correct=True, **common)

    md = matched_delta(base["sims"], tc["sims"])
    rr = retry_rate(tc["sims"])
    s = tc["stats"]
    line = "=" * 60
    print(f"\n{line}\nTrueCall × τ²-bench — paired result\n{line}")
    print(f"domain={a.domain} model={a.model} tasks={a.tasks} trials={a.trials} "
          f"{'(no faults)' if a.no_faults else f'fault_p={p}'}")
    print(f"  mean reward   baseline : {mean_reward(base['sims'])}")
    print(f"  mean reward   TrueCall : {mean_reward(tc['sims'])}")
    if md:
        print(f"  matched Δreward (n={md['n']}): {md['baseline']:.3f} -> {md['truecall']:.3f} ({md['delta']:+.3f})")
    print(f"  seam: caught={s.get('caught')} corrected={s.get('corrected')} "
          f"false_positives={s.get('false_positive')} (of {s.get('faults_injected')} injected)")
    if rr:
        print(f"  recovery: after a correction the agent retried the failed call "
              f"{rr['retried_pct']:.0f}% (gave up {rr['gave_up_pct']:.0f}%), n={rr['n']}")
    print(f"  spend (this run): ${total_cost('tc_baseline', 'tc_truecall'):.4f}")
    print("Integrity: contracts are generic developer post-conditions — never the per-task oracle.")


if __name__ == "__main__":
    main()
