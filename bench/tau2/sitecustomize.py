"""Auto-imported at interpreter startup (when this dir is on PYTHONPATH). If TRUECALL_ENABLE=1,
installs the TrueCall seam into tau2's Environment BEFORE tau2 builds any environment — so it
works even though `tau2 run` is a separate process. Configured entirely via env vars:

  TRUECALL_ENABLE=1            turn the seam on
  TRUECALL_CORRECT=1|0        inject the correction back to the agent (1) or just measure (0)
  TRUECALL_FAULT_P=0.3        probability a WRITE tool is silently fault-injected (0 = none)
  TRUECALL_SEED=12345         fault RNG seed (paired arms must share it)
  TRUECALL_DOMAIN=retail      domain (selects the WRITE-tool set)
  TRUECALL_STATS_OUT=path     write seam stats JSON here at exit
"""
import atexit
import json
import os

# WRITE tools per domain (names with @is_tool(ToolType.WRITE)). Extend as domains are added.
WRITE_TOOLS = {
    "retail": {
        "cancel_pending_order", "modify_pending_order_address", "modify_pending_order_items",
        "modify_pending_order_payment", "modify_user_address", "return_delivered_order_items",
        "exchange_delivered_order_items",
    },
    # airline/telecom: fill from each domain's @is_tool(ToolType.WRITE) methods, or set
    # TRUECALL_AUTODETECT=1 to derive at runtime (see below).
}


def _install():
    domain = os.environ.get("TRUECALL_DOMAIN", "retail")
    write_tools = set(WRITE_TOOLS.get(domain, set()))
    faults_p = float(os.environ.get("TRUECALL_FAULT_P", "0") or 0)
    seed = int(os.environ.get("TRUECALL_SEED", "12345") or 12345)
    correct = os.environ.get("TRUECALL_CORRECT", "1") not in ("0", "", "false")

    from faults import FaultInjector
    from seam import install
    faults = FaultInjector(p=faults_p, seed=seed) if faults_p > 0 else None
    stats = install(write_tools=write_tools, faults=faults, correct=correct)

    out = os.environ.get("TRUECALL_STATS_OUT")
    if out:
        @atexit.register
        def _flush():
            try:
                with open(out, "w") as f:
                    json.dump({
                        "domain": domain, "fault_p": faults_p, "seed": seed, "correct": correct,
                        "write_calls": stats.write_calls, "faults_injected": stats.faults_injected,
                        "caught": stats.caught, "corrected": stats.corrected,
                        "false_positive": stats.false_positive, "per_tool": stats.per_tool,
                    }, f, indent=2)
            except Exception:
                pass


if os.environ.get("TRUECALL_ENABLE") == "1":
    try:
        _install()
    except Exception as e:  # never break the eval because of the seam
        import sys
        print(f"[truecall] seam install failed: {e}", file=sys.stderr)
