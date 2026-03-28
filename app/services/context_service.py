from __future__ import annotations

import json
from datetime import UTC, datetime

from app.core.database import get_db_connection
from app.models.schemas import ContextRequest
from app.services.user_data_service import user_data_service


class ContextService:
    def save_context(self, payload: ContextRequest) -> ContextRequest:
        serialized = json.dumps(payload.model_dump(mode="json"), ensure_ascii=True)
        updated_at = datetime.now(UTC).isoformat()
        coordinates = payload.location.coordinates
        user_data_service.ensure_user(payload.user_id)
        user_data_service.upsert_notification_settings(payload.user_id)
        user_data_service.upsert_user_session(
            payload.user_id,
            latitude=coordinates.lat if coordinates else None,
            longitude=coordinates.lng if coordinates else None,
            current_intent=_derive_current_intent(payload),
        )
        user_data_service.replace_user_profile(payload.user_id, _profile_scores(payload))
        with get_db_connection() as connection:
            connection.execute(
                """
                INSERT INTO user_contexts (user_id, payload, updated_at)
                VALUES (?, ?, ?)
                ON CONFLICT(user_id) DO UPDATE SET
                    payload = excluded.payload,
                    updated_at = excluded.updated_at
                """,
                (payload.user_id, serialized, updated_at),
            )
            connection.commit()
        return payload

    def get_context(self, user_id: str) -> ContextRequest | None:
        with get_db_connection() as connection:
            row = connection.execute(
                "SELECT payload FROM user_contexts WHERE user_id = ?",
                (user_id,),
            ).fetchone()
        if row is None:
            return None
        return ContextRequest.model_validate(json.loads(row["payload"]))


def _derive_current_intent(payload: ContextRequest) -> str | None:
    profile = payload.onboarding_profile or {}
    if profile.get("free_time_preference"):
        return str(profile["free_time_preference"])
    trip_details = payload.trip_details
    if trip_details and trip_details.purpose:
        return str(trip_details.purpose)
    return None


def _profile_scores(payload: ContextRequest) -> dict[str, float]:
    scores: dict[str, float] = {}
    preferences = payload.preferences or {}
    onboarding_profile = payload.onboarding_profile or {}

    vibe = preferences.get("vibe")
    budget = preferences.get("budget")
    cuisine = onboarding_profile.get("cuisine_preference")
    activity = onboarding_profile.get("free_time_preference")
    priority = onboarding_profile.get("decision_priority")

    if vibe:
        scores[f"vibe:{str(vibe).lower()}"] = 0.8
    if budget:
        scores[f"budget:{str(budget).lower()}"] = 0.7
    if cuisine:
        scores[f"cuisine:{str(cuisine).lower()}"] = 0.9
    if activity:
        scores[f"activity:{str(activity).lower()}"] = 0.85
    if priority:
        scores[f"priority:{str(priority).lower()}"] = 0.6

    activity_value = str(activity or "").lower()
    cuisine_value = str(cuisine or "").lower()
    purpose_value = str(payload.trip_details.purpose if payload.trip_details and payload.trip_details.purpose else "").lower()

    if activity_value == "food":
        scores["restaurant"] = 0.95
        scores["cafe"] = 0.75
    elif activity_value == "coffee":
        scores["cafe"] = 0.95
        scores["restaurant"] = 0.55
    elif activity_value == "work spot":
        scores["cafe"] = 0.7
        scores["coworking"] = 0.95
    elif activity_value == "sightseeing":
        scores["attraction"] = 0.95
        scores["museum"] = 0.8
        scores["park"] = 0.7
    elif activity_value == "relax":
        scores["park"] = 0.9
        scores["cafe"] = 0.65

    if cuisine_value:
        scores["restaurant"] = max(scores.get("restaurant", 0.0), 0.85)
        if cuisine_value == "cafe":
            scores["cafe"] = max(scores.get("cafe", 0.0), 0.95)

    if purpose_value == "business":
        scores["coworking"] = max(scores.get("coworking", 0.0), 0.9)
        scores["cafe"] = max(scores.get("cafe", 0.0), 0.65)
    elif purpose_value == "leisure":
        scores["attraction"] = max(scores.get("attraction", 0.0), 0.75)
        scores["park"] = max(scores.get("park", 0.0), 0.7)

    return scores


context_service = ContextService()
