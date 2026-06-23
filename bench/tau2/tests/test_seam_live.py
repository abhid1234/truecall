"""LIVE seam test against a real tau2-bench install (no API key needed — exercises the
Environment.get_response monkeypatch + fault injection + contract on the real retail db).
Skips automatically if tau2-bench isn't installed (run ../setup.sh first).
"""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))  # bench/tau2

try:
    from tau2.domains.retail.environment import get_environment
    from tau2.data_model.message import ToolCall
    HAVE_TAU2 = True
except Exception:
    HAVE_TAU2 = False


@unittest.skipUnless(HAVE_TAU2, "tau2-bench not installed (run ./setup.sh)")
class TestSeamLive(unittest.TestCase):
    def _pending_orders(self, env, n):
        return [oid for oid, o in env.tools.db.orders.items() if str(o.status) == "pending"][:n]

    def test_injected_fault_is_caught_and_corrected(self):
        from faults import FaultInjector
        from seam import install
        env = get_environment()
        oid = self._pending_orders(env, 1)[0]
        stats = install(write_tools={"cancel_pending_order"}, faults=FaultInjector(p=1.0, seed=1), correct=True)
        try:
            tc = ToolCall(id="t1", name="cancel_pending_order",
                          arguments={"order_id": oid, "reason": "no longer needed"}, requestor="assistant")
            resp = env.get_response(tc)
            # the fault undid the mutation -> contract catches it -> correction injected
            self.assertTrue(resp.error)
            self.assertIn("[TrueCall]", resp.content)
            # ergonomics: the correction must be an IMPERATIVE to retry (trajectory analysis
            # showed soft phrasing made agents give up 82% of the time). Regression guard.
            self.assertIn("ACTION REQUIRED", resp.content)
            self.assertIn("cancel_pending_order", resp.content)  # names the tool to re-call
            self.assertIn("Do NOT tell the user", resp.content)
            self.assertEqual(str(env.tools.db.orders[oid].status), "pending")  # mutation was undone
            self.assertGreaterEqual(stats.faults_injected, 1)
            self.assertGreaterEqual(stats.caught, 1)
            self.assertEqual(stats.false_positive, 0)
        finally:
            stats._restore()

    def test_no_fault_passes_clean(self):
        from seam import install
        env = get_environment()
        oid = self._pending_orders(env, 1)[0]
        stats = install(write_tools={"cancel_pending_order"}, faults=None, correct=True)
        try:
            tc = ToolCall(id="t2", name="cancel_pending_order",
                          arguments={"order_id": oid, "reason": "no longer needed"}, requestor="assistant")
            resp = env.get_response(tc)
            self.assertFalse(resp.error)                                       # genuine success not blocked
            self.assertEqual(str(env.tools.db.orders[oid].status), "cancelled")
            self.assertEqual(stats.caught, 0)
            self.assertEqual(stats.false_positive, 0)
        finally:
            stats._restore()


if __name__ == "__main__":
    unittest.main()
