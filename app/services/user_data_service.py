from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from app.core.database import get_db_connection
from app.core.postgres import get_postgres_connection, postgres_available
from app.utils.helpers import logger


def _now_iso() -> str:
    return datetime.now(UTC).isoformat()


class UserDataService:
    def ensure_user(self, user_id: str, name: str | None = None, email: str | None = None) -> None:
        with get_db_connection() as connection:
            connection.execute(
                """
                INSERT INTO users (id, name, email)
                VALUES (?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    name = COALESCE(excluded.name, users.name),
                    email = COALESCE(excluded.email, users.email)
                """,
                (user_id, name, email),
            )
            connection.commit()

        if postgres_available():
            with get_postgres_connection() as connection:
                connection.execute(
                    """
                    INSERT INTO users (id, name, email)
                    VALUES (%s, %s, %s)
                    ON CONFLICT (id) DO UPDATE SET
                        name = COALESCE(EXCLUDED.name, users.name),
                        email = COALESCE(EXCLUDED.email, users.email)
                    """,
                    (user_id, name, email),
                )
                connection.commit()

    def upsert_notification_settings(
        self,
        user_id: str,
        *,
        notifications_enabled: bool = True,
        radius_km: float = 2,
        quiet_hours_start: str | None = None,
        quiet_hours_end: str | None = None,
        max_per_day: int = 3,
    ) -> None:
        updated_at = _now_iso()
        with get_db_connection() as connection:
            connection.execute(
                """
                INSERT INTO user_notification_settings (
                    user_id, notifications_enabled, radius_km, quiet_hours_start, quiet_hours_end, max_per_day, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(user_id) DO UPDATE SET
                    notifications_enabled = excluded.notifications_enabled,
                    radius_km = excluded.radius_km,
                    quiet_hours_start = COALESCE(excluded.quiet_hours_start, user_notification_settings.quiet_hours_start),
                    quiet_hours_end = COALESCE(excluded.quiet_hours_end, user_notification_settings.quiet_hours_end),
                    max_per_day = excluded.max_per_day,
                    updated_at = excluded.updated_at
                """,
                (user_id, int(notifications_enabled), radius_km, quiet_hours_start, quiet_hours_end, max_per_day, updated_at),
            )
            connection.commit()

        if postgres_available():
            with get_postgres_connection() as connection:
                connection.execute(
                    """
                    INSERT INTO user_notification_settings (
                        user_id, notifications_enabled, radius_km, quiet_hours_start, quiet_hours_end, max_per_day, updated_at
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (user_id) DO UPDATE SET
                        notifications_enabled = EXCLUDED.notifications_enabled,
                        radius_km = EXCLUDED.radius_km,
                        quiet_hours_start = COALESCE(EXCLUDED.quiet_hours_start, user_notification_settings.quiet_hours_start),
                        quiet_hours_end = COALESCE(EXCLUDED.quiet_hours_end, user_notification_settings.quiet_hours_end),
                        max_per_day = EXCLUDED.max_per_day,
                        updated_at = EXCLUDED.updated_at
                    """,
                    (user_id, notifications_enabled, radius_km, quiet_hours_start, quiet_hours_end, max_per_day, updated_at),
                )
                connection.commit()

    def upsert_user_session(
        self,
        user_id: str,
        *,
        latitude: float | None,
        longitude: float | None,
        current_intent: str | None = None,
    ) -> None:
        now = _now_iso()
        with get_db_connection() as connection:
            connection.execute(
                """
                INSERT INTO user_sessions (
                    user_id, last_location_lat, last_location_lng, last_active, current_intent, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(user_id) DO UPDATE SET
                    last_location_lat = excluded.last_location_lat,
                    last_location_lng = excluded.last_location_lng,
                    last_active = excluded.last_active,
                    current_intent = COALESCE(excluded.current_intent, user_sessions.current_intent),
                    updated_at = excluded.updated_at
                """,
                (user_id, latitude, longitude, now, current_intent, now),
            )
            connection.commit()

        if postgres_available():
            with get_postgres_connection() as connection:
                connection.execute(
                    """
                    INSERT INTO user_sessions (
                        user_id, last_location_lat, last_location_lng, last_active, current_intent, updated_at
                    )
                    VALUES (%s, %s, %s, %s, %s, %s)
                    ON CONFLICT (user_id) DO UPDATE SET
                        last_location_lat = EXCLUDED.last_location_lat,
                        last_location_lng = EXCLUDED.last_location_lng,
                        last_active = EXCLUDED.last_active,
                        current_intent = COALESCE(EXCLUDED.current_intent, user_sessions.current_intent),
                        updated_at = EXCLUDED.updated_at
                    """,
                    (user_id, latitude, longitude, now, current_intent, now),
                )
                connection.commit()

    def replace_user_profile(self, user_id: str, profile_scores: dict[str, float]) -> None:
        with get_db_connection() as connection:
            connection.execute("DELETE FROM user_profile WHERE user_id = ?", (user_id,))
            for category, score in profile_scores.items():
                connection.execute(
                    """
                    INSERT INTO user_profile (user_id, category, score)
                    VALUES (?, ?, ?)
                    """,
                    (user_id, category, float(score)),
                )
            connection.commit()

        if postgres_available():
            with get_postgres_connection() as connection:
                connection.execute("DELETE FROM user_profile WHERE user_id = %s", (user_id,))
                for category, score in profile_scores.items():
                    connection.execute(
                        """
                        INSERT INTO user_profile (user_id, category, score)
                        VALUES (%s, %s, %s)
                        """,
                        (user_id, category, float(score)),
                    )
                connection.commit()

    def upsert_place(
        self,
        place_id: str,
        *,
        name: str,
        place_type: str | None = None,
        latitude: float | None = None,
        longitude: float | None = None,
        rating: float | None = None,
        price_level: int | None = None,
        open_now: bool | None = None,
    ) -> None:
        updated_at = _now_iso()
        sqlite_open_now = None if open_now is None else int(open_now)
        with get_db_connection() as connection:
            connection.execute(
                """
                INSERT INTO places (
                    id, name, type, latitude, longitude, rating, price_level, open_now, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    name = excluded.name,
                    type = excluded.type,
                    latitude = excluded.latitude,
                    longitude = excluded.longitude,
                    rating = excluded.rating,
                    price_level = excluded.price_level,
                    open_now = excluded.open_now,
                    updated_at = excluded.updated_at
                """,
                (
                    place_id,
                    name,
                    place_type,
                    latitude,
                    longitude,
                    rating,
                    price_level,
                    sqlite_open_now,
                    updated_at,
                ),
            )
            connection.commit()

        if postgres_available():
            with get_postgres_connection() as connection:
                connection.execute(
                    """
                    INSERT INTO places (
                        id, name, type, latitude, longitude, rating, price_level, open_now, updated_at
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (id) DO UPDATE SET
                        name = EXCLUDED.name,
                        type = EXCLUDED.type,
                        latitude = EXCLUDED.latitude,
                        longitude = EXCLUDED.longitude,
                        rating = EXCLUDED.rating,
                        price_level = EXCLUDED.price_level,
                        open_now = EXCLUDED.open_now,
                        updated_at = EXCLUDED.updated_at
                    """,
                    (
                        place_id,
                        name,
                        place_type,
                        latitude,
                        longitude,
                        rating,
                        price_level,
                        open_now,
                        updated_at,
                    ),
                )
                connection.commit()

    def register_device_token(self, user_id: str, token: str) -> None:
        created_at = _now_iso()
        logger.info("Registering device token for user %s", user_id)
        with get_db_connection() as connection:
            connection.execute(
                """
                DELETE FROM device_tokens
                WHERE user_id = ?
                """,
                (user_id,),
            )
            connection.execute(
                """
                INSERT OR REPLACE INTO device_tokens (user_id, token, created_at)
                VALUES (?, ?, ?)
                """,
                (user_id, token, created_at),
            )
            connection.commit()

        if postgres_available():
            with get_postgres_connection() as connection:
                connection.execute(
                    """
                    DELETE FROM device_tokens
                    WHERE user_id = %s
                    """,
                    (user_id,),
                )
                connection.execute(
                    """
                    INSERT INTO device_tokens (user_id, token, created_at)
                    VALUES (%s, %s, %s)
                    ON CONFLICT (user_id, token) DO UPDATE SET
                        created_at = EXCLUDED.created_at
                    """,
                    (user_id, token, created_at),
                )
                connection.commit()
        logger.info("Device token stored for user %s", user_id)

    def get_user_profile_scores(self, user_id: str) -> dict[str, float]:
        if postgres_available():
            with get_postgres_connection() as connection:
                rows = connection.execute(
                    """
                    SELECT category, score
                    FROM user_profile
                    WHERE user_id = %s
                    """,
                    (user_id,),
                ).fetchall()
            return {str(row["category"]): float(row["score"]) for row in rows}

        with get_db_connection() as connection:
            rows = connection.execute(
                """
                SELECT category, score
                FROM user_profile
                WHERE user_id = ?
                """,
                (user_id,),
            ).fetchall()
        return {str(row["category"]): float(row["score"]) for row in rows}

    def get_user_session(self, user_id: str) -> dict[str, Any] | None:
        if postgres_available():
            with get_postgres_connection() as connection:
                row = connection.execute(
                    """
                    SELECT user_id, last_location_lat, last_location_lng, last_active, current_intent, updated_at
                    FROM user_sessions
                    WHERE user_id = %s
                    """,
                    (user_id,),
                ).fetchone()
            return dict(row) if row else None

        with get_db_connection() as connection:
            row = connection.execute(
                """
                SELECT user_id, last_location_lat, last_location_lng, last_active, current_intent, updated_at
                FROM user_sessions
                WHERE user_id = ?
                """,
                (user_id,),
            ).fetchone()
        return dict(row) if row else None

    def list_notifications(self, user_id: str, limit: int = 20) -> list[dict[str, Any]]:
        if postgres_available():
            with get_postgres_connection() as connection:
                rows = connection.execute(
                    """
                    SELECT id, place_id, type, title, message, sent_at, clicked
                    FROM notifications
                    WHERE user_id = %s
                    ORDER BY sent_at DESC
                    LIMIT %s
                    """,
                    (user_id, limit),
                ).fetchall()
            return [dict(row) for row in rows]

        with get_db_connection() as connection:
            rows = connection.execute(
                """
                SELECT id, place_id, type, title, message, sent_at, clicked
                FROM notifications
                WHERE user_id = ?
                ORDER BY sent_at DESC
                LIMIT ?
                """,
                (user_id, limit),
            ).fetchall()
        return [dict(row) for row in rows]

    def get_notification_settings(self, user_id: str) -> dict[str, Any] | None:
        if postgres_available():
            with get_postgres_connection() as connection:
                row = connection.execute(
                    """
                    SELECT user_id, notifications_enabled, radius_km, quiet_hours_start, quiet_hours_end, max_per_day, updated_at
                    FROM user_notification_settings
                    WHERE user_id = %s
                    """,
                    (user_id,),
                ).fetchone()
            return dict(row) if row else None

        with get_db_connection() as connection:
            row = connection.execute(
                """
                SELECT user_id, notifications_enabled, radius_km, quiet_hours_start, quiet_hours_end, max_per_day, updated_at
                FROM user_notification_settings
                WHERE user_id = ?
                """,
                (user_id,),
            ).fetchone()
        return dict(row) if row else None


user_data_service = UserDataService()
