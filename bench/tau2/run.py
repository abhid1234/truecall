"""Run the paired experiment: same tasks + same fault seed, two arms —
  baseline  : tools are flaky (faults injected) and TrueCall does NOT correct
  truecall  : tools are flaky (SAME faults) and TrueCall catches + corrects in-flight
…then report pass@1 / pass^k for each and the delta.

NEEDS: a working tau2-bench install (run ./setup.sh first) AND an LLM API key
(OPENAI_API_KEY / ANTHROPIC_API_KEY in the environment). The verifier/contracts/faults
themselves are unit-tested key-free (python3 -m unittest discover -s tests).

For the second experiment (premature-done gate on UNMODIFIED tau2), pass --no-faults:
both arms run with real (non-flaky) tools; only the `truecall` arm gates on the generic
contracts. Honest note: native tau2 failures are mostly agent-reasoning, so that lift may
be modest — the injected-fault experiment is the clean, strong result.
"""
from __future__ import annotations
import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
RESULTS = HERE / "results"


def run_arm(name: str, domain: str, model: str, tasks: int, trials: int, seed: int,
            fault_p: float, correct: bool) -> dict:
    RESULTS.mkdir(exist_ok=True)
    stats_out = RESULTS / f"{name}.stats.json"
    save_to = RESULTS / f"{name}.results.json"
    env = dict(os.environ)
    env.update({
        "PYTHONPATH": f"{HERE}:{env.get('PYTHONPATH', '')}",  # picks up our sitecustomize + modules
        "TRUECALL_ENABLE": "1",
        "TRUECALL_CORRECT": "1" if correct else "0",
        "TRUECALL_FAULT_P": str(fault_p),
        "TRUECALL_SEED": str(seed),
        "TRUECALL_DOMAIN": domain,
        "TRUECALL_STATS_OUT": str(stats_out),
    })
    cmd = ["tau2", "run", "--domain", domain, "--agent-llm", model, "--user-llm", model,
           "--num-tasks", str(tasks), "--num-trials", str(trials), "--seed", str(seed),
           "--save-to", str(save_to)]
    print(f"\n=== arm: {name} ===\n$ {' '.join(cmd)}")
    subprocess.run(cmd, env=env, check=True)
    stats = json.loads(stats_out.read_text()) if stats_out.exists() else {}
    return {"results_path": str(save_to), "stats": stats, "pass_at_1": _pass_at_1(save_to)}


def _pass_at_1(results_path: Path) -> float | None:
    try:
        from tau2.metrics.agent_metrics import compute_metrics  # type: ignore
        from tau2.data_model.simulation import Results  # type: ignore
        results = Results.load(results_path) if hasattr(Results, "load") else Results.model_validate_json(results_path.read_text())
        m = compute_metrics(results)
        return float(m.pass_hat_ks.get(1)) if getattr(m, "pass_hat_ks", None) else None
    except Exception as e:
        print(f"[truecall] could not auto-compute pass@1 ({e}); results saved at {results_path}", file=sys.stderr)
        return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--domain", default="retail")
    ap.add_argument("--model", default="gpt-4o-mini")
    ap.add_argument("--tasks", type=int, default=5)
    ap.add_argument("--trials", type=int, default=2)
    ap.add_argument("--seed", type=int, default=12345)
    ap.add_argument("--fault-p", type=float, default=0.3)
    ap.add_argument("--no-faults", action="store_true", help="premature-done-gate experiment (no injected faults)")
    a = ap.parse_args()
    p = 0.0 if a.no_faults else a.fault_p

    baseline = run_arm("baseline", a.domain, a.model, a.tasks, a.trials, a.seed, p, correct=False)
    truecall = run_arm("truecall", a.domain, a.model, a.tasks, a.trials, a.seed, p, correct=True)

    print("\n" + "=" * 56 + "\nTrueCall × τ²-bench — paired result\n" + "=" * 56)
    print(f"domain={a.domain} model={a.model} tasks={a.tasks} trials={a.trials} "
          f"{'(no injected faults)' if a.no_faults else f'fault_p={p}'}")
    print(f"  pass@1  baseline : {baseline['pass_at_1']}")
    print(f"  pass@1  TrueCall : {truecall['pass_at_1']}")
    s = truecall["stats"]
    print(f"  seam: write_calls={s.get('write_calls')} faults_injected={s.get('faults_injected')} "
          f"caught={s.get('caught')} corrected={s.get('corrected')} false_positives={s.get('false_positive')}")
    print("Integrity: contracts are generic developer post-conditions — never the per-task oracle.")


if __name__ == "__main__":
    main()
