from __future__ import annotations

import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator


DATABASE_PATH = Path("data") / "travel_assistant.db"


def init_db() -> None:
    DATABASE_PATH.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(DATABASE_PATH) as connection:
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS user_contexts (
                user_id TEXT PRIMARY KEY,
                payload TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )
        connection.commit()


@contextmanager
def get_db_connection() -> Iterator[sqlite3.Connection]:
    DATABASE_PATH.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(DATABASE_PATH)
    connection.row_factory = sqlite3.Row
    try:
        yield connection
    finally:
        connection.close()
