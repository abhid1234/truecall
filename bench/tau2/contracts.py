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


def _status_in(db: Any, collection: str, item_id: Any) -> Optional[str]:
    """Read db.<collection>[item_id].status for any domain (retail orders, airline
    reservations, telecom lines, …). Returns None if the item is absent."""
    coll = getattr(db, collection, None)
    if not isinstance(coll, dict):
        return None
    item = coll.get(item_id)
    if item is None:
        return None
    s = getattr(item, "status", None)
    return str(s) if s is not None else None


# --- generic: a WRITE tool must change the world -----------------------------
def db_changed(tool: str) -> Contract:
    def check(ctx: Ctx) -> Optional[str]:
        if _dump(ctx.before) == _dump(ctx.after):
            return "the write returned success but the database did not change"
        return None
    return Contract(tool=tool, describe="the write actually changed the database", check=check)


# --- richer per-tool examples (multi-domain) ---------------------------------
def _cancelled(collection: str, id_arg: str):
    """A check that the named item's status is 'cancelled' after the call."""
    def check(ctx: Ctx) -> Optional[str]:
        iid = ctx.args.get(id_arg)
        st = _status_in(ctx.after, collection, iid)
        if st is None:
            return f"{collection[:-1]} {iid} not found after the call"
        if st != "cancelled":
            return f"{collection[:-1]} {iid} status is '{st}', expected 'cancelled'"
        return None
    return check


SPECIFIC: dict[str, Contract] = {
    # retail
    "cancel_pending_order": Contract("cancel_pending_order", "the order's status is 'cancelled'",
                                     _cancelled("orders", "order_id")),
    # airline
    "cancel_reservation": Contract("cancel_reservation", "the reservation's status is 'cancelled'",
                                   _cancelled("reservations", "reservation_id")),
}


def contract_for(tool_name: str, is_write: bool) -> Optional[Contract]:
    """The contract to enforce for a tool: a specific one if defined, else the generic
    db_changed for any WRITE tool, else None (read-only tools are not verified)."""
    if tool_name in SPECIFIC:
        return SPECIFIC[tool_name]
    if is_write:
        return db_changed(tool_name)
    return None
