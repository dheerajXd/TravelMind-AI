from __future__ import annotations

import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator


DATABASE_PATH = Path("data") / "travel_assistant.db"

SQLITE_SCHEMA_STATEMENTS = [
    """
    CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        name TEXT,
        email TEXT UNIQUE,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS user_contexts (
        user_id TEXT PRIMARY KEY,
        payload TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS user_notification_settings (
        user_id TEXT PRIMARY KEY,
        notifications_enabled INTEGER NOT NULL DEFAULT 1,
        radius_km REAL NOT NULL DEFAULT 2,
        quiet_hours_start TEXT,
        quiet_hours_end TEXT,
        max_per_day INTEGER NOT NULL DEFAULT 3,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS user_sessions (
        user_id TEXT PRIMARY KEY,
        last_location_lat REAL,
        last_location_lng REAL,
        last_active TEXT,
        current_intent TEXT,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS places (
        id TEXT PRIMARY KEY,
        name TEXT,
        type TEXT,
        latitude REAL,
        longitude REAL,
        rating REAL,
        price_level INTEGER,
        open_now INTEGER,
        updated_at TEXT
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS user_profile (
        user_id TEXT NOT NULL,
        category TEXT NOT NULL,
        score REAL NOT NULL,
        PRIMARY KEY (user_id, category),
        FOREIGN KEY (user_id) REFERENCES users(id)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS notifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        place_id TEXT,
        type TEXT,
        title TEXT,
        message TEXT,
        sent_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        clicked INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY (user_id) REFERENCES users(id),
        FOREIGN KEY (place_id) REFERENCES places(id)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS notification_history (
        user_id TEXT NOT NULL,
        place_id TEXT NOT NULL,
        last_sent TEXT NOT NULL,
        PRIMARY KEY (user_id, place_id),
        FOREIGN KEY (user_id) REFERENCES users(id),
        FOREIGN KEY (place_id) REFERENCES places(id)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS notification_queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        place_id TEXT,
        type TEXT,
        score REAL,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id),
        FOREIGN KEY (place_id) REFERENCES places(id)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS device_tokens (
        user_id TEXT NOT NULL,
        token TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (user_id, token),
        FOREIGN KEY (user_id) REFERENCES users(id)
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id)",
    "CREATE INDEX IF NOT EXISTS idx_notification_history_user ON notification_history(user_id)",
    "CREATE INDEX IF NOT EXISTS idx_user_profile_user ON user_profile(user_id)",
    "CREATE INDEX IF NOT EXISTS idx_places_open ON places(open_now)",
    "CREATE INDEX IF NOT EXISTS idx_places_geo ON places(latitude, longitude)",
]


def init_db() -> None:
    DATABASE_PATH.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(DATABASE_PATH) as connection:
        connection.execute("PRAGMA foreign_keys = ON")
        for statement in SQLITE_SCHEMA_STATEMENTS:
            connection.execute(statement)
        connection.commit()


@contextmanager
def get_db_connection() -> Iterator[sqlite3.Connection]:
    DATABASE_PATH.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(DATABASE_PATH)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    try:
        yield connection
    finally:
        connection.close()
