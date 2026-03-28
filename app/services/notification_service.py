from __future__ import annotations

import hashlib
import math
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from pathlib import Path
from typing import Any

from app.core.config import get_settings
from app.core.postgres import get_postgres_connection, postgres_available
from app.core.redis_client import get_redis_client
from app.models.schemas import PlaceItem, PlacesSearchQuery
from app.services.places_service import places_service
from app.utils.helpers import logger


try:
    import firebase_admin
    from firebase_admin import credentials, messaging
except Exception:  # pragma: no cover
    firebase_admin = None
    credentials = None
    messaging = None


DEFAULT_RADIUS_KM = 2.0
MAX_DAILY_NOTIFICATIONS = 3
QUEUE_RETRY_LIMIT = 3
DEFAULT_PROFILE_SCORE = 0.25
NOTIFICATION_TYPE = "proximity"


@dataclass
class CandidatePlace:
    id: str
    name: str
    type: str | None
    latitude: float | None
    longitude: float | None
    rating: float | None
    price_level: int | None
    open_now: bool | None
    distance_km: float
    profile_score: float
    score: float


class NotificationService:
    def __init__(self) -> None:
        self.redis = get_redis_client()
        self.settings = get_settings()
        self._firebase_ready = False
        self._initialize_firebase()

    async def trigger_location_update(self, user_id: str, lat: float, lng: float) -> dict[str, Any]:
        if not postgres_available():
            return self._disabled_response(user_id, "PostgreSQL notification backend is not configured.")

        now = datetime.now(UTC)
        with get_postgres_connection() as connection:
            previous = connection.execute(
                """
                SELECT last_location_lat, last_location_lng, last_active, current_intent
                FROM user_sessions
                WHERE user_id = %s
                """,
                (user_id,),
            ).fetchone()

            previous_active = _parse_datetime(previous["last_active"]) if previous else None
            moved_km = (
                _haversine_km(float(previous["last_location_lat"]), float(previous["last_location_lng"]), lat, lng)
                if previous and previous["last_location_lat"] is not None and previous["last_location_lng"] is not None
                else None
            )

            activity_state = self._detect_activity_state(
                previous_lat=previous["last_location_lat"] if previous else None,
                previous_lng=previous["last_location_lng"] if previous else None,
                previous_active=previous_active,
                lat=lat,
                lng=lng,
                now=now,
            )
            stored_active = now if moved_km is None or moved_km >= 0.15 or previous_active is None else previous_active

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
                (
                    user_id,
                    lat,
                    lng,
                    stored_active,
                    previous["current_intent"] if previous else None,
                    now,
                ),
            )
            connection.commit()

        if activity_state != "idle":
            return {
                "user_id": user_id,
                "activity_state": activity_state,
                "triggered": False,
                "queued": 0,
                "reason": "User is not idle yet.",
                "sources": {"mode": "location-update"},
            }

        queued = await self.enqueue_notifications(user_id)
        return {
            "user_id": user_id,
            "activity_state": activity_state,
            "triggered": True,
            "queued": queued,
            "reason": "Notification engine evaluated nearby places.",
            "sources": {"mode": "location-update"},
        }

    async def trigger_manual(self, user_id: str) -> dict[str, Any]:
        if not postgres_available():
            return self._disabled_response(user_id, "PostgreSQL notification backend is not configured.")
        queued = await self.enqueue_notifications(user_id, force=True)
        return {
            "user_id": user_id,
            "activity_state": "manual",
            "triggered": True,
            "queued": queued,
            "reason": "Manual notification evaluation completed.",
            "sources": {"mode": "manual"},
        }

    async def enqueue_notifications(self, user_id: str, *, force: bool = False) -> int:
        if not postgres_available():
            return 0

        with get_postgres_connection() as connection:
            settings_row = connection.execute(
                """
                SELECT notifications_enabled, radius_km, quiet_hours_start, quiet_hours_end, max_per_day
                FROM user_notification_settings
                WHERE user_id = %s
                """,
                (user_id,),
            ).fetchone()
            if not settings_row:
                return 0
            if not settings_row["notifications_enabled"]:
                return 0
            if not force and self._is_quiet_hours(settings_row["quiet_hours_start"], settings_row["quiet_hours_end"]):
                return 0

            session_row = connection.execute(
                """
                SELECT last_location_lat, last_location_lng, last_active, current_intent
                FROM user_sessions
                WHERE user_id = %s
                """,
                (user_id,),
            ).fetchone()
            if not session_row or session_row["last_location_lat"] is None or session_row["last_location_lng"] is None:
                return 0

            lat = float(session_row["last_location_lat"])
            lng = float(session_row["last_location_lng"])
            radius_km = float(settings_row["radius_km"] or DEFAULT_RADIUS_KM)
            current_intent = session_row["current_intent"]
            profile_scores = self._load_profile_scores(connection, user_id)

        await self._sync_places(lat=lat, lng=lng, radius_km=radius_km, profile_scores=profile_scores, current_intent=current_intent)

        with get_postgres_connection() as connection:
            candidates = self._fetch_nearby_places(
                connection,
                user_id=user_id,
                lat=lat,
                lng=lng,
                radius_km=radius_km,
                profile_scores=profile_scores,
            )
            if not candidates:
                return 0

            queued = 0
            for candidate in candidates:
                if candidate.score < self.settings.notification_score_threshold:
                    continue
                if self._already_notified(connection, user_id, candidate.id):
                    continue
                if self._already_pending(connection, user_id, candidate.id):
                    continue
                connection.execute(
                    """
                    INSERT INTO notification_queue (user_id, place_id, type, score, status, created_at)
                    VALUES (%s, %s, %s, %s, 'pending', %s)
                    """,
                    (user_id, candidate.id, NOTIFICATION_TYPE, candidate.score, datetime.now(UTC)),
                )
                queued += 1
            connection.commit()
            return queued

    def process_pending_notifications(self, limit: int = 20) -> dict[str, int]:
        if not postgres_available():
            return {"sent": 0, "failed": 0, "skipped": 0}

        sent = failed = skipped = 0
        with get_postgres_connection() as connection:
            queue_rows = connection.execute(
                """
                SELECT id, user_id, place_id, type, score, status, created_at
                FROM notification_queue
                WHERE status = 'pending'
                ORDER BY created_at ASC
                LIMIT %s
                """,
                (limit,),
            ).fetchall()

            for row in queue_rows:
                user_id = row["user_id"]
                place_id = row["place_id"]

                settings_row = connection.execute(
                    """
                    SELECT notifications_enabled, quiet_hours_start, quiet_hours_end, max_per_day
                    FROM user_notification_settings
                    WHERE user_id = %s
                    """,
                    (user_id,),
                ).fetchone()
                if not settings_row or not settings_row["notifications_enabled"]:
                    self._update_queue_status(connection, row["id"], "failed")
                    failed += 1
                    continue
                if self._is_quiet_hours(settings_row["quiet_hours_start"], settings_row["quiet_hours_end"]):
                    skipped += 1
                    continue

                daily_limit = int(settings_row["max_per_day"] or MAX_DAILY_NOTIFICATIONS)
                if self._daily_count(connection, user_id) >= daily_limit:
                    skipped += 1
                    continue

                place_row = connection.execute(
                    """
                    SELECT id, name, latitude, longitude, rating
                    FROM places
                    WHERE id = %s
                    """,
                    (place_id,),
                ).fetchone()
                if not place_row:
                    self._mark_retry(connection, row["id"])
                    failed += 1
                    continue

                payload = self._build_fcm_payload(place_row)
                if self._send_fcm(user_id, payload):
                    connection.execute(
                        """
                        INSERT INTO notifications (user_id, place_id, type, title, message, sent_at, clicked)
                        VALUES (%s, %s, %s, %s, %s, %s, FALSE)
                        """,
                        (
                            user_id,
                            place_id,
                            row["type"],
                            payload["title"],
                            payload["body"],
                            datetime.now(UTC),
                        ),
                    )
                    connection.execute(
                        """
                        INSERT INTO notification_history (user_id, place_id, last_sent)
                        VALUES (%s, %s, %s)
                        ON CONFLICT (user_id, place_id) DO UPDATE SET
                            last_sent = EXCLUDED.last_sent
                        """,
                        (user_id, place_id, datetime.now(UTC)),
                    )
                    self._update_queue_status(connection, row["id"], "sent")
                    self._mark_cooldown(user_id, place_id)
                    self._increment_daily_count(user_id)
                    sent += 1
                else:
                    if self._mark_retry(connection, row["id"]):
                        failed += 1
                    else:
                        skipped += 1

            connection.commit()
        return {"sent": sent, "failed": failed, "skipped": skipped}

    def list_notifications(self, user_id: str) -> list[dict[str, Any]]:
        if not postgres_available():
            return []
        with get_postgres_connection() as connection:
            rows = connection.execute(
                """
                SELECT id, place_id, type, title, message, sent_at, clicked
                FROM notifications
                WHERE user_id = %s
                ORDER BY sent_at DESC
                """,
                (user_id,),
            ).fetchall()
        return [dict(row) for row in rows]

    async def _sync_places(
        self,
        *,
        lat: float,
        lng: float,
        radius_km: float,
        profile_scores: dict[str, float],
        current_intent: str | None,
    ) -> None:
        keywords = self._build_place_keywords(profile_scores, current_intent)
        if not keywords:
            keywords = ["restaurant", "cafe", "park"]

        all_places: list[PlaceItem] = []
        for keyword in keywords[:5]:
            try:
                places = await places_service.search_places(
                    PlacesSearchQuery(lat=lat, lng=lng, type=keyword, radius=int(radius_km * 1000))
                )
            except Exception as exc:  # pragma: no cover
                logger.warning("Notification place sync failed for keyword %s: %s", keyword, exc)
                continue
            all_places.extend(places)

        deduped: dict[str, PlaceItem] = {}
        for place in all_places:
            place_id = self._stable_place_id(place)
            if place_id not in deduped:
                deduped[place_id] = place

        if not deduped or not postgres_available():
            return

        with get_postgres_connection() as connection:
            now = datetime.now(UTC)
            for place in deduped.values():
                place_id = self._stable_place_id(place)
                primary_type = self._primary_place_type(place)
                connection.execute(
                    """
                    INSERT INTO places (id, name, type, latitude, longitude, rating, price_level, open_now, updated_at)
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
                        place.name,
                        primary_type,
                        place.lat,
                        place.lng,
                        place.rating,
                        None,
                        place.open_now,
                        now,
                    ),
                )
            connection.commit()

    def _fetch_nearby_places(
        self,
        connection,
        *,
        user_id: str,
        lat: float,
        lng: float,
        radius_km: float,
        profile_scores: dict[str, float],
    ) -> list[CandidatePlace]:
        rows = connection.execute(
            """
            SELECT
                p.id,
                p.name,
                p.type,
                p.latitude,
                p.longitude,
                p.rating,
                p.price_level,
                p.open_now,
                COALESCE(up.score, %s) AS profile_score,
                ST_Distance(
                    geography(ST_MakePoint(p.longitude, p.latitude)),
                    geography(ST_MakePoint(%s, %s))
                ) / 1000.0 AS distance_km
            FROM places p
            LEFT JOIN user_profile up
              ON up.user_id = %s
             AND up.category = p.type
            WHERE p.open_now = TRUE
              AND p.latitude IS NOT NULL
              AND p.longitude IS NOT NULL
              AND ST_DWithin(
                    geography(ST_MakePoint(p.longitude, p.latitude)),
                    geography(ST_MakePoint(%s, %s)),
                    %s * 1000
              )
            ORDER BY distance_km ASC, p.rating DESC NULLS LAST
            LIMIT 40
            """,
            (
                DEFAULT_PROFILE_SCORE,
                lng,
                lat,
                user_id,
                lng,
                lat,
                radius_km,
            ),
        ).fetchall()

        candidates: list[CandidatePlace] = []
        for row in rows:
            profile_score = float(row["profile_score"] or DEFAULT_PROFILE_SCORE)
            if profile_scores and profile_score < 0.25:
                continue
            distance_km = float(row["distance_km"] or 0.0)
            distance_score = max(0.0, 1.0 - min(distance_km / max(radius_km, 0.1), 1.0))
            rating_score = float(row["rating"] or 0.0) / 5.0
            score = (profile_score * 0.5) + (distance_score * 0.3) + (rating_score * 0.2)
            candidates.append(
                CandidatePlace(
                    id=row["id"],
                    name=row["name"],
                    type=row["type"],
                    latitude=row["latitude"],
                    longitude=row["longitude"],
                    rating=row["rating"],
                    price_level=row["price_level"],
                    open_now=row["open_now"],
                    distance_km=distance_km,
                    profile_score=profile_score,
                    score=score,
                )
            )
        candidates.sort(key=lambda item: item.score, reverse=True)
        return candidates

    def _detect_activity_state(
        self,
        *,
        previous_lat: float | None,
        previous_lng: float | None,
        previous_active: datetime | None,
        lat: float,
        lng: float,
        now: datetime,
    ) -> str:
        if previous_lat is None or previous_lng is None or previous_active is None:
            return "moving"
        minutes_since_last = (now - previous_active).total_seconds() / 60.0
        moved_km = _haversine_km(previous_lat, previous_lng, lat, lng)
        if minutes_since_last >= self.settings.idle_minutes_threshold and moved_km < 0.15:
            return "idle"
        return "moving"

    def _already_notified(self, connection, user_id: str, place_id: str) -> bool:
        if self.redis.get(f"notified:{user_id}:{place_id}"):
            return True
        row = connection.execute(
            """
            SELECT last_sent
            FROM notification_history
            WHERE user_id = %s AND place_id = %s
            """,
            (user_id, place_id),
        ).fetchone()
        if not row:
            return False
        last_sent = _parse_datetime(row["last_sent"])
        return bool(last_sent and datetime.now(UTC) - last_sent < timedelta(hours=24))

    def _already_pending(self, connection, user_id: str, place_id: str) -> bool:
        row = connection.execute(
            """
            SELECT 1
            FROM notification_queue
            WHERE user_id = %s AND place_id = %s AND status = 'pending'
            LIMIT 1
            """,
            (user_id, place_id),
        ).fetchone()
        return row is not None

    def _mark_retry(self, connection, queue_id: int) -> bool:
        retry_key = f"notify_retry:{queue_id}"
        attempt_count = int(self.redis.incr(retry_key))
        self.redis.expire(retry_key, 86400)
        if attempt_count >= QUEUE_RETRY_LIMIT:
            self._update_queue_status(connection, queue_id, "failed")
            return True
        self._update_queue_status(connection, queue_id, "pending")
        return False

    def _update_queue_status(self, connection, queue_id: int, status_value: str) -> None:
        connection.execute(
            """
            UPDATE notification_queue
            SET status = %s
            WHERE id = %s
            """,
            (status_value, queue_id),
        )

    def _build_fcm_payload(self, place_row: dict[str, Any]) -> dict[str, Any]:
        title = "Nearby place for you"
        distance_text = "nearby"
        if place_row.get("latitude") is not None and place_row.get("longitude") is not None:
            distance_text = "a short walk away"
        rating = place_row.get("rating")
        if rating:
            body = f"{place_row['name']} is highly rated and {distance_text}."
        else:
            body = f"{place_row['name']} looks like a strong nearby fit right now."
        return {
            "title": title,
            "body": body,
            "data": {
                "place_id": str(place_row["id"]),
                "action": "open_place",
            },
        }

    def _send_fcm(self, user_id: str, payload: dict[str, Any]) -> bool:
        with get_postgres_connection() as connection:
            token_rows = connection.execute(
                """
                SELECT token
                FROM device_tokens
                WHERE user_id = %s
                """,
                (user_id,),
            ).fetchall()

        tokens = [row["token"] for row in token_rows]
        if not tokens:
            logger.info("Skipping notification send for user %s because no device token is registered", user_id)
            return False
        if not self._firebase_ready or not messaging:
            logger.info("FCM not configured; treating notification as unsent for user %s", user_id)
            return False

        success = False
        for token in tokens:
            try:
                masked_token = f"{token[:10]}...{token[-6:]}" if len(token) > 20 else "***"
                logger.info("Sending FCM notification to user %s using token %s", user_id, masked_token)
                message = messaging.Message(
                    token=token,
                    notification=messaging.Notification(title=payload["title"], body=payload["body"]),
                    data={key: str(value) for key, value in payload.get("data", {}).items()},
                )
                response = messaging.send(message)
                logger.info("FCM send succeeded for user %s with response %s", user_id, response)
                success = True
            except Exception as exc:  # pragma: no cover
                logger.warning("FCM send failed for user %s: %s", user_id, exc)
        return success

    def _initialize_firebase(self) -> None:
        if not firebase_admin or not self.settings.fcm_service_account_path:
            return
        service_account = Path(self.settings.fcm_service_account_path)
        if not service_account.exists():
            logger.warning("FCM service account file not found: %s", service_account)
            return
        if firebase_admin._apps:  # type: ignore[attr-defined]
            self._firebase_ready = True
            return
        try:
            firebase_admin.initialize_app(credentials.Certificate(str(service_account)))
            self._firebase_ready = True
        except Exception as exc:  # pragma: no cover
            logger.warning("FCM initialization failed: %s", exc)

    def _is_quiet_hours(self, start_value: str | time | None, end_value: str | time | None) -> bool:
        if not start_value or not end_value:
            return False
        start_time = _parse_time(start_value)
        end_time = _parse_time(end_value)
        current = datetime.now().time()
        if start_time <= end_time:
            return start_time <= current <= end_time
        return current >= start_time or current <= end_time

    def _mark_cooldown(self, user_id: str, place_id: str) -> None:
        self.redis.setex(f"notified:{user_id}:{place_id}", 86400, "1")

    def _daily_count(self, connection, user_id: str) -> int:
        value = self.redis.get(f"notify_count:{user_id}")
        if value is not None:
            return int(value)
        start_of_day = datetime.combine(date.today(), time.min, tzinfo=UTC)
        row = connection.execute(
            """
            SELECT COUNT(*) AS sent_count
            FROM notifications
            WHERE user_id = %s AND sent_at >= %s
            """,
            (user_id, start_of_day),
        ).fetchone()
        return int(row["sent_count"] or 0)

    def _increment_daily_count(self, user_id: str) -> int:
        key = f"notify_count:{user_id}"
        count = self.redis.incr(key)
        self.redis.expire(key, 86400)
        return int(count)

    def _load_profile_scores(self, connection, user_id: str) -> dict[str, float]:
        rows = connection.execute(
            """
            SELECT category, score
            FROM user_profile
            WHERE user_id = %s
            """,
            (user_id,),
        ).fetchall()
        return {str(row["category"]): float(row["score"]) for row in rows}

    def _build_place_keywords(self, profile_scores: dict[str, float], current_intent: str | None) -> list[str]:
        keywords: list[str] = []
        prioritized = sorted(profile_scores.items(), key=lambda item: item[1], reverse=True)
        for category, _score in prioritized:
            base = category.split(":", 1)[-1].strip().lower()
            mapped = _keyword_from_profile(base)
            if mapped and mapped not in keywords:
                keywords.append(mapped)

        if current_intent:
            mapped = _keyword_from_profile(str(current_intent).strip().lower())
            if mapped and mapped not in keywords:
                keywords.append(mapped)

        for fallback in ["restaurant", "cafe", "park", "museum", "shopping mall"]:
            if fallback not in keywords:
                keywords.append(fallback)
        return keywords

    def _primary_place_type(self, place: PlaceItem) -> str:
        normalized_types = [item.lower() for item in place.types]
        for candidate in normalized_types:
            mapped = _keyword_from_profile(candidate)
            if mapped in {"cafe", "restaurant", "park", "museum", "shopping", "coworking", "attraction", "bar", "hotel"}:
                return mapped
        return "generic"

    def _stable_place_id(self, place: PlaceItem) -> str:
        if place.id:
            return place.id
        raw = f"{place.name}|{place.address}|{place.lat}|{place.lng}"
        digest = hashlib.sha1(raw.encode("utf-8")).hexdigest()[:24]
        return f"derived_{digest}"

    def _disabled_response(self, user_id: str, reason: str) -> dict[str, Any]:
        return {
            "user_id": user_id,
            "activity_state": "unknown",
            "triggered": False,
            "queued": 0,
            "reason": reason,
            "sources": {},
        }


def _parse_datetime(value: Any) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=UTC)
    try:
        parsed = datetime.fromisoformat(str(value))
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)
    except ValueError:
        return None


def _parse_time(value: str | time) -> time:
    if isinstance(value, time):
        return value
    return time.fromisoformat(str(value))


def _haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    radius = 6371.0
    lat1_rad = math.radians(lat1)
    lat2_rad = math.radians(lat2)
    delta_lat = math.radians(lat2 - lat1)
    delta_lng = math.radians(lng2 - lng1)
    a = (
        math.sin(delta_lat / 2) ** 2
        + math.cos(lat1_rad) * math.cos(lat2_rad) * math.sin(delta_lng / 2) ** 2
    )
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return radius * c


def _keyword_from_profile(value: str) -> str:
    mapping = {
        "food": "restaurant",
        "restaurant": "restaurant",
        "south indian": "restaurant",
        "north indian": "restaurant",
        "street food": "restaurant",
        "italian": "restaurant",
        "chinese": "restaurant",
        "coffee": "cafe",
        "cafe": "cafe",
        "bakery": "cafe",
        "work spot": "coworking",
        "coworking": "coworking",
        "sightseeing": "attraction",
        "attraction": "attraction",
        "museum": "museum",
        "relax": "park",
        "park": "park",
        "shopping": "shopping mall",
        "shopping mall": "shopping mall",
        "bar": "bar",
        "hotel": "hotel",
    }
    return mapping.get(value, value)


notification_service = NotificationService()
