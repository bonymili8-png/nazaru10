"""Sliding-window rate limiter (in-process).

Milestone 1 runs a single API process, so in-memory state is correct. A multi-instance deployment
needs a shared store (Redis) — tracked in docs/ROADMAP.md.
"""

from __future__ import annotations

import time
from collections import deque
from dataclasses import dataclass

from jlr_shared_types.errors import RateLimitedError


@dataclass(frozen=True, slots=True)
class Limit:
    requests: int
    window_seconds: float


class RateLimiter:
    def __init__(self, limits: dict[str, Limit], *, max_keys: int = 50_000) -> None:
        self.limits = limits
        self.max_keys = max_keys
        self._hits: dict[tuple[str, str], deque[float]] = {}

    def check(self, bucket: str, key: str, *, now: float | None = None) -> None:
        limit = self.limits.get(bucket)
        if limit is None:
            return
        current = time.monotonic() if now is None else now
        hits = self._hits.get((bucket, key))
        if hits is None:
            if len(self._hits) >= self.max_keys:
                self._evict(current)
            hits = self._hits.setdefault((bucket, key), deque())
        while hits and current - hits[0] >= limit.window_seconds:
            hits.popleft()
        if len(hits) >= limit.requests:
            retry_after = max(0.0, limit.window_seconds - (current - hits[0]))
            raise RateLimitedError(
                f"Too many {bucket} requests; retry in {retry_after:.0f}s",
                details={"bucket": bucket, "retry_after_seconds": round(retry_after, 1)},
            )
        hits.append(current)

    def _evict(self, now: float) -> None:
        longest = max((limit.window_seconds for limit in self.limits.values()), default=60.0)
        for key in [k for k, hits in self._hits.items() if not hits or now - hits[-1] >= longest]:
            del self._hits[key]
