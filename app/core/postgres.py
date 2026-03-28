from __future__ import annotations

from contextlib import contextmanager
from typing import Iterator

from app.core.config import get_settings


try:
    import psycopg
    from psycopg.rows import dict_row
except Exception:  # pragma: no cover
    psycopg = None
    dict_row = None


def _resolve_database_url() -> str | None:
    settings = get_settings()
    return settings.notification_database_url or settings.database_url


def postgres_available() -> bool:
    database_url = _resolve_database_url()
    return bool(psycopg and database_url and database_url.startswith(("postgres://", "postgresql://")))


@contextmanager
def get_postgres_connection() -> Iterator:
    database_url = _resolve_database_url()
    if not psycopg or not database_url:
        raise RuntimeError("PostgreSQL client is not configured.")
    connection = psycopg.connect(database_url, row_factory=dict_row)
    try:
        yield connection
    finally:
        connection.close()
