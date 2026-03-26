from __future__ import annotations

import json
import logging
import os
import time
from collections import defaultdict, deque
from dataclasses import dataclass
from typing import Any

from fastapi import HTTPException, status


logger = logging.getLogger("ai_travel_assistant")


@dataclass
class CacheEntry:
    value: Any
    expires_at: float


class TTLCache:
    def __init__(self, ttl_seconds: int) -> None:
        self.ttl_seconds = ttl_seconds
        self._store: dict[str, CacheEntry] = {}

    def get(self, key: str) -> Any | None:
        entry = self._store.get(key)
        if not entry:
            return None
        if entry.expires_at < time.time():
            self._store.pop(key, None)
            return None
        return entry.value

    def set(self, key: str, value: Any) -> None:
        self._store[key] = CacheEntry(value=value, expires_at=time.time() + self.ttl_seconds)

    def delete(self, key: str) -> None:
        self._store.pop(key, None)


class JsonFileStore:
    def __init__(self, file_path: str) -> None:
        self.file_path = file_path
        directory = os.path.dirname(self.file_path)
        if directory:
            os.makedirs(directory, exist_ok=True)
        if not os.path.exists(self.file_path):
            self._write({})

    def get(self, key: str) -> Any | None:
        data = self._read()
        return data.get(key)

    def set(self, key: str, value: Any) -> None:
        data = self._read()
        data[key] = value
        self._write(data)

    def delete(self, key: str) -> None:
        data = self._read()
        data.pop(key, None)
        self._write(data)

    def _read(self) -> dict[str, Any]:
        try:
            with open(self.file_path, "r", encoding="utf-8") as file:
                content = file.read().strip()
                if not content:
                    return {}
                return json.loads(content)
        except FileNotFoundError:
            return {}
        except json.JSONDecodeError:
            logger.warning("Invalid JSON in %s. Resetting store.", self.file_path)
            return {}

    def _write(self, data: dict[str, Any]) -> None:
        temp_path = f"{self.file_path}.tmp"
        with open(temp_path, "w", encoding="utf-8") as file:
            json.dump(data, file, ensure_ascii=True, indent=2)
        os.replace(temp_path, self.file_path)


class InMemoryRateLimiter:
    def __init__(self, max_requests: int, window_seconds: int) -> None:
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        self._buckets: dict[str, deque[float]] = defaultdict(deque)

    def check(self, key: str) -> None:
        now = time.time()
        bucket = self._buckets[key]
        while bucket and bucket[0] <= now - self.window_seconds:
            bucket.popleft()
        if len(bucket) >= self.max_requests:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Rate limit exceeded. Please try again later.",
            )
        bucket.append(now)


def build_location_string(lat: float | None, lng: float | None) -> str | None:
    if lat is None or lng is None:
        return None
    return f"{lat},{lng}"


def create_places_photo_url(photo_reference: str, api_key: str, max_width: int = 400) -> str:
    return (
        "https://maps.googleapis.com/maps/api/place/photo"
        f"?maxwidth={max_width}&photo_reference={photo_reference}&key={api_key}"
    )


def make_cache_key(prefix: str, **kwargs: Any) -> str:
    normalized = json.dumps(kwargs, sort_keys=True, default=str)
    return f"{prefix}:{normalized}"


def raise_upstream_error(service_name: str, detail: str, status_code: int = status.HTTP_502_BAD_GATEWAY) -> None:
    logger.warning("%s error: %s", service_name, detail)
    raise HTTPException(status_code=status_code, detail=f"{service_name} error: {detail}")
