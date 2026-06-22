"""Key-free unit tests for the TrueCall verifier + the generic/specific contracts.
Runs with plain `python3 -m unittest` — no tau2-bench, no API key, no deps.
(The full live-agent eval, run.py, additionally needs `setup.sh` + an LLM API key.)
"""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))  # bench/tau2

from truecall import Contract, Ctx, run_contract  # noqa: E402
from contracts import db_changed, contract_for, SPECIFIC  # noqa: E402
from faults import FaultInjector  # noqa: E402


# --- mock db (mimics tau2's pydantic models: attribute access + model_dump) ---
class FakeOrder:
    def __init__(self, status):
        self.status = status
    def model_dump(self):
        return {"status": self.status}

class FakeDB:
    def __init__(self, orders):
        self.orders = orders
    def model_dump(self):
        return {"orders": {k: v.model_dump() for k, v in self.orders.items()}}


def db(status):
    return FakeDB({"#W1": FakeOrder(status)})


class TestVerifier(unittest.TestCase):
    def test_db_changed_passes_when_world_changed(self):
        ctx = Ctx(tool="cancel", args={}, result={"status": "success"}, before=db("pending"), after=db("cancelled"))
        self.assertTrue(run_contract(db_changed("cancel"), ctx).ok)

    def test_db_changed_catches_silent_failure(self):
        ctx = Ctx(tool="cancel", args={}, result={"status": "success"}, before=db("pending"), after=db("pending"))
        v = run_contract(db_changed("cancel"), ctx)
        self.assertFalse(v.ok)
        self.assertIn("database did not change", v.message)

    def test_specific_cancel_contract(self):
        c = SPECIFIC["cancel_pending_order"]
        good = Ctx(tool="cancel_pending_order", args={"order_id": "#W1"}, result={}, after=db("cancelled"))
        bad = Ctx(tool="cancel_pending_order", args={"order_id": "#W1"}, result={}, after=db("pending"))
        self.assertTrue(run_contract(c, good).ok)
        self.assertFalse(run_contract(c, bad).ok)

    def test_airline_cancel_reservation_contract(self):
        c = SPECIFIC["cancel_reservation"]
        # a db with a `reservations` collection (airline)
        class ResDB:
            def __init__(self, status): self.reservations = {"R1": FakeOrder(status)}
            def model_dump(self): return {"reservations": {k: v.model_dump() for k, v in self.reservations.items()}}
        good = Ctx(tool="cancel_reservation", args={"reservation_id": "R1"}, result={}, after=ResDB("cancelled"))
        bad = Ctx(tool="cancel_reservation", args={"reservation_id": "R1"}, result={}, after=ResDB(None))
        self.assertTrue(run_contract(c, good).ok)
        self.assertFalse(run_contract(c, bad).ok)

    def test_multi_domain_write_routing(self):
        for wt in ("book_reservation", "suspend_line", "refuel_data", "modify_pending_order_items"):
            self.assertEqual(contract_for(wt, is_write=True).describe, "the write actually changed the database")

    def test_fail_closed_on_verifier_exception(self):
        def boom(ctx):
            raise RuntimeError("kaboom")
        v = run_contract(Contract("t", "x", boom), Ctx(tool="t", args={}, result=None))
        self.assertFalse(v.ok)
        self.assertTrue(v.error)

    def test_contract_for_routing(self):
        self.assertIsNotNone(contract_for("modify_pending_order_items", is_write=True))   # generic db_changed
        self.assertIsNone(contract_for("get_user_details", is_write=False))               # read-only -> none
        self.assertIs(contract_for("cancel_pending_order", True), SPECIFIC["cancel_pending_order"])


class TestFaults(unittest.TestCase):
    def test_seeded_and_reproducible(self):
        a = FaultInjector(p=0.5, seed=7)
        b = FaultInjector(p=0.5, seed=7)
        seq_a = [a.should_fail("w", True) for _ in range(50)]
        seq_b = [b.should_fail("w", True) for _ in range(50)]
        self.assertEqual(seq_a, seq_b)
        self.assertGreater(a.injected, 0)

    def test_read_tools_never_fail(self):
        f = FaultInjector(p=1.0, seed=1)
        self.assertFalse(f.should_fail("get_user_details", is_write=False))


if __name__ == "__main__":
    unittest.main()
