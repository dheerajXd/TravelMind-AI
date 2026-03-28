from __future__ import annotations

import time
from collections import defaultdict

from app.core.config import get_settings
from app.utils.helpers import logger


try:
    import redis  # type: ignore
except Exception:  # pragma: no cover
    redis = None


class InMemoryRedisFallback:
    def __init__(self) -> None:
        self._values: dict[str, tuple[str, float | None]] = {}
        self._counters: defaultdict[str, int] = defaultdict(int)
        self._expirations: dict[str, float] = {}

    def _cleanup(self, key: str) -> None:
        expires_at = self._expirations.get(key)
        if expires_at is not None and expires_at <= time.time():
            self._values.pop(key, None)
            self._counters.pop(key, None)
            self._expirations.pop(key, None)

    def get(self, key: str) -> str | None:
        self._cleanup(key)
        value = self._values.get(key)
        return value[0] if value else None

    def setex(self, key: str, ttl_seconds: int, value: str) -> bool:
        self._values[key] = (value, time.time() + ttl_seconds)
        self._expirations[key] = time.time() + ttl_seconds
        return True

    def incr(self, key: str) -> int:
        self._cleanup(key)
        self._counters[key] += 1
        return self._counters[key]

    def expire(self, key: str, ttl_seconds: int) -> bool:
        self._expirations[key] = time.time() + ttl_seconds
        return True


def get_redis_client():
    settings = get_settings()
    if redis is not None and settings.redis_url:
        try:
            return redis.from_url(settings.redis_url, decode_responses=True)
        except Exception as exc:  # pragma: no cover
            logger.warning("Redis connection failed, using in-memory fallback: %s", exc)
    return InMemoryRedisFallback()

