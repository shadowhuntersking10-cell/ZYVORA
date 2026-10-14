"""Simple in-process sliding-window rate limiter (per key).

For a single-process deployment this is sufficient; for multi-instance
deployments front it with nginx limit_req or move the buckets to Redis.
"""
from __future__ import annotations

import threading
import time
from collections import defaultdict, deque
from dataclasses import dataclass


@dataclass
class Rule:
    max_events: int
    per_seconds: int


RULES: dict[str, Rule] = {
    "auth": Rule(max_events=12, per_seconds=300),
    "gen": Rule(max_events=10, per_seconds=3600),
    "assistant": Rule(max_events=40, per_seconds=60),
    "email": Rule(max_events=5, per_seconds=3600),
    "api": Rule(max_events=600, per_seconds=60),
}

_buckets: dict[str, deque[float]] = defaultdict(deque)
_lock = threading.Lock()


def allow(bucket: str, key: str) -> bool:
    rule = RULES.get(bucket)
    if rule is None:
        return True
    now = time.monotonic()
    ident = f"{bucket}:{key}"
    with _lock:
        q = _buckets[ident]
        while q and q[0] < now - rule.per_seconds:
            q.popleft()
        if len(q) >= rule.max_events:
            return False
        q.append(now)
        return True


def reset_for_tests() -> None:
    with _lock:
        _buckets.clear()
