"""Seeded, reproducible fault injection: make WRITE tools silently fail with probability
`p` — return a success-shaped result but skip the database mutation. This models flaky
real-world tools (the thing TrueCall exists to catch). Deterministic given the seed.
"""
from __future__ import annotations
import random


class FaultInjector:
    def __init__(self, p: float = 0.3, seed: int = 12345):
        self.p = p
        self.rng = random.Random(seed)
        self.injected = 0
        self.considered = 0

    def should_fail(self, tool_name: str, is_write: bool) -> bool:
        if not is_write or self.p <= 0:
            return False
        self.considered += 1
        fail = self.rng.random() < self.p
        if fail:
            self.injected += 1
        return fail
