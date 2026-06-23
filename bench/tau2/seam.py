"""The integration seam: monkeypatch tau2's `Environment.get_response` so every tool
call is (optionally) fault-injected and then verified by a TrueCall contract, with the
correction injected back in-flight (the agent sees the correction, not the false success).

Verified against sierra-research/tau2-bench:
    Environment.get_response(self, message: ToolCall) -> ToolMessage
      -> make_tool_call -> use_tool -> self.tools.use_tool(...)  # mutates self.tools.db
    ToolMessage has .content (str) and .error (bool); ToolCall has .name, .arguments.

Modes:
  - inject:  fault-inject WRITE tools (silent failure) then catch + correct  [experiment 1]
  - gate:    no injection; contracts act as an "are you actually done?" gate  [experiment 2]
Both run the same verify+correct path; they differ only in whether faults are injected.
"""
from __future__ import annotations
import copy
from dataclasses import dataclass, field

from truecall import Ctx, run_contract
from contracts import contract_for


@dataclass
class Stats:
    write_calls: int = 0
    faults_injected: int = 0
    caught: int = 0            # contract returned not-ok on a verify
    corrected: int = 0         # correction injected back to the agent
    false_positive: int = 0    # caught when NO fault was injected (a genuine success blocked)
    per_tool: dict = field(default_factory=dict)

    def record(self, tool: str, injected: bool, ok: bool):
        d = self.per_tool.setdefault(tool, {"calls": 0, "caught": 0})
        d["calls"] += 1
        if not ok:
            self.caught += 1
            d["caught"] += 1
            if not injected:
                self.false_positive += 1


def install(write_tools: set[str], faults=None, correct: bool = True) -> Stats:
    """Patch Environment.get_response. `write_tools` is the set of WRITE tool names for the
    domain. Returns a Stats object updated as the eval runs. Call once per environment build."""
    from tau2.environment.environment import Environment

    stats = Stats()
    original = Environment.get_response

    def patched(self, message):
        tool_name = getattr(message, "name", None)
        is_write = tool_name in write_tools
        toolkit = self.tools
        before = copy.deepcopy(getattr(toolkit, "db", None))

        inject = bool(faults and faults.should_fail(tool_name, is_write))

        resp = original(self, message)  # runs the tool; mutates toolkit.db; returns ToolMessage

        if inject and before is not None:
            toolkit.db = copy.deepcopy(before)  # silently undo the mutation, keep the success-shaped resp

        if is_write:
            stats.write_calls += 1
            if inject:
                stats.faults_injected += 1

        contract = contract_for(tool_name, is_write)
        if contract is not None and not getattr(resp, "error", False):
            after = copy.deepcopy(getattr(toolkit, "db", None))
            ctx = Ctx(tool=tool_name, args=dict(getattr(message, "arguments", {}) or {}),
                      result=getattr(resp, "content", None), before=before, after=after)
            v = run_contract(contract, ctx)
            stats.record(tool_name, inject, v.ok)
            if not v.ok and correct:
                # in-flight correction: hand the agent the structured signal as a tool error.
                # Ergonomics matter: trajectory analysis showed agents read a soft "it failed,
                # verify before continuing" as "report failure to the user" and gave up 82% of
                # the time. This phrasing is an IMPERATIVE to retry the same call and explicitly
                # forbids reporting failure / moving on.
                try:
                    resp.content = (
                        f"[TrueCall] NOT DONE: `{tool_name}` returned success but the change did NOT "
                        f"take effect ({v.message}). ACTION REQUIRED: call `{tool_name}` again now with "
                        f"the same arguments to actually complete it. Do NOT tell the user it failed and "
                        f"do NOT move on to anything else — retry this exact call; TrueCall will re-verify."
                    )
                    resp.error = True
                    stats.corrected += 1
                except Exception:
                    pass
        return resp

    Environment.get_response = patched
    stats._restore = lambda: setattr(Environment, "get_response", original)  # type: ignore[attr-defined]
    return stats
