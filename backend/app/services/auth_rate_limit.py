"""Bounded, process-local authentication budgets for the single-worker pilot."""

import math
from collections.abc import Callable
from dataclasses import dataclass, field
from threading import Lock
from time import monotonic

from app.config import Settings


@dataclass
class _Window:
    per_client: int
    total_limit: int
    seconds: int
    started_at: float | None = None
    total: int = 0
    clients: dict[str, int] = field(default_factory=dict)

    def consume(self, client: str, now: float) -> int | None:
        if self.started_at is None or now >= self.started_at + self.seconds:
            self.started_at = now
            self.total = 0
            self.clients.clear()
        count = self.clients.get(client, 0)
        if self.total >= self.total_limit or count >= self.per_client:
            return max(1, math.ceil(self.started_at + self.seconds - now))
        # Only accepted attempts allocate entries, bounded by total_limit.
        self.clients[client] = count + 1
        self.total += 1
        return None


class AuthRateLimiter:
    def __init__(self, settings: Settings, clock: Callable[[], float] = monotonic):
        self._clock = clock
        self._lock = Lock()
        self._windows = {
            "/auth/login": _Window(
                settings.auth_login_max_attempts,
                settings.auth_login_max_total_attempts,
                settings.auth_login_window_seconds,
            ),
            "/auth/register": _Window(
                settings.auth_register_max_attempts,
                settings.auth_register_max_total_attempts,
                settings.auth_register_window_seconds,
            ),
        }

    def check(self, path: str, client: str) -> int | None:
        """Consume an attempt or return whole seconds until the window resets."""
        with self._lock:
            return self._windows[path].consume(client, self._clock())
