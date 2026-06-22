"""A minimal, dependency-free Python port of TrueCall's verify semantics, for the
tau2-bench integration. Mirrors the canonical TS core (packages/core): a contract is
a deterministic post-condition; on failure it returns a structured correction signal;
it is fail-closed (a verifier that throws => "could not verify", never a silent pass).

A Contract here is a tool name + a `check(ctx) -> Optional[str]` callable, where ctx
carries the tool args, the returned result, and the world snapshots `before`/`after`.
Returning None = passed; returning a string = the human-readable reason it failed.
"""
from __future__ import annotations
from dataclasses import dataclass
from typing import Any, Callable, Optional


@dataclass
class Ctx:
    tool: str
    args: dict
    result: Any
    before: Any = None  # pre-execution world snapshot (for delta checks)
    after: Any = None   # post-execution world snapshot


# check(ctx) -> None on pass, or a string describing what was expected-but-not-found.
Check = Callable[[Ctx], Optional[str]]


@dataclass
class Contract:
    tool: str
    describe: str
    check: Check


@dataclass
class VerifyResult:
    ok: bool
    tool: str = ""
    message: str = ""
    error: bool = False  # True => could not verify (fail-closed), not "verified false"


def run_contract(contract: Contract, ctx: Ctx) -> VerifyResult:
    try:
        reason = contract.check(ctx)
    except Exception as e:  # fail-closed: an unverifiable call is not a trusted call
        return VerifyResult(
            ok=False, error=True, tool=contract.tool,
            message=f"TrueCall could not verify {contract.tool}: {e}",
        )
    if reason is None:
        return VerifyResult(ok=True, tool=contract.tool)
    return VerifyResult(
        ok=False, tool=contract.tool,
        message=(f"{contract.tool} reported success but its post-condition failed: "
                 f"expected {contract.describe}; {reason}"),
    )
