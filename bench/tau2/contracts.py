"""Generic, DEVELOPER-AUTHORED post-conditions for tau2-bench domain tools.

INTEGRITY LINE (read me): these contracts are written from generic domain knowledge —
"a write tool should change the world", "after cancel, the order is cancelled". They do
NOT read the per-task `evaluation_criteria` / goal DB that tau2 scores against. Feeding
that oracle back to the agent would be cheating. Never do it.

The workhorse for the injected-fault experiment is `db_changed`: any WRITE tool that
returns a success-shaped result but left the DB byte-identical is a silent failure.
Richer per-tool contracts (e.g. cancel -> status 'cancelled') are stronger examples.
"""
from __future__ import annotations
from typing import Any, Optional
from truecall import Contract, Ctx


def _dump(db: Any) -> Any:
    """Stable serialization for equality (pydantic model or plain object)."""
    if hasattr(db, "model_dump"):
        return db.model_dump()
    return db


def _orders(db: Any) -> dict:
    o = getattr(db, "orders", None)
    return o if isinstance(o, dict) else {}


def _order_status(db: Any, order_id: str) -> Optional[str]:
    order = _orders(db).get(order_id)
    if order is None:
        return None
    s = getattr(order, "status", None)
    return str(s) if s is not None else None


# --- generic: a WRITE tool must change the world -----------------------------
def db_changed(tool: str) -> Contract:
    def check(ctx: Ctx) -> Optional[str]:
        if _dump(ctx.before) == _dump(ctx.after):
            return "the write returned success but the database did not change"
        return None
    return Contract(tool=tool, describe="the write actually changed the database", check=check)


# --- richer per-tool examples (retail) ---------------------------------------
def _cancel_pending_order(ctx: Ctx) -> Optional[str]:
    oid = ctx.args.get("order_id")
    st = _order_status(ctx.after, oid)
    if st is None:
        return f"order {oid} not found after the call"
    if st != "cancelled":
        return f"order {oid} status is '{st}', expected 'cancelled'"
    return None


SPECIFIC: dict[str, Contract] = {
    "cancel_pending_order": Contract(
        tool="cancel_pending_order",
        describe="the order's status is 'cancelled'",
        check=_cancel_pending_order,
    ),
}


def contract_for(tool_name: str, is_write: bool) -> Optional[Contract]:
    """The contract to enforce for a tool: a specific one if defined, else the generic
    db_changed for any WRITE tool, else None (read-only tools are not verified)."""
    if tool_name in SPECIFIC:
        return SPECIFIC[tool_name]
    if is_write:
        return db_changed(tool_name)
    return None
