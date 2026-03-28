from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

from app.models.schemas import ContextRequest
from app.services.user_data_service import user_data_service
from app.utils.helpers import JsonFileStore


INTERACTION_STORE = JsonFileStore(str(Path("data") / "recommendation_memory.json"))
IST = ZoneInfo("Asia/Kolkata")


def _normalize_label(value: Any) -> str:
    return str(value or "").strip().lower().replace("-", "_").replace(" ", "_")


def _time_bucket(current_time: datetime | None) -> str:
    value = current_time.astimezone(IST) if current_time else datetime.now(IST)
    hour = value.hour
    if 5 <= hour < 12:
        return "morning"
    if 12 <= hour < 17:
        return "afternoon"
    if 17 <= hour < 22:
        return "evening"
    return "late_night"


def _next_event_gap_minutes(calendar_context: dict[str, Any] | None, current_time: datetime) -> int | None:
    if not calendar_context:
        return None
    events = calendar_context.get("upcoming_events") or []
    candidate_minutes: list[int] = []
    for event in events:
        start = event.get("start") or {}
        start_value = start.get("dateTime") or start.get("date")
        if not start_value:
            continue
        try:
            parsed = datetime.fromisoformat(str(start_value).replace("Z", "+00:00"))
        except ValueError:
            continue
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=current_time.tzinfo)
        delta_minutes = int((parsed - current_time).total_seconds() // 60)
        if delta_minutes > 0:
            candidate_minutes.append(delta_minutes)
    return min(candidate_minutes) if candidate_minutes else None


class ContextEngine:
    def get_learning_state(self, user_id: str) -> dict[str, Any]:
        raw = INTERACTION_STORE.get(user_id) or {}
        return self._ensure_learning_shape(raw)

    def save_learning_state(self, user_id: str, state: dict[str, Any]) -> dict[str, Any]:
        normalized = self._ensure_learning_shape(state)
        INTERACTION_STORE.set(user_id, normalized)
        return normalized

    def build_context(
        self,
        *,
        user_id: str,
        stored_context: ContextRequest,
        weather: dict[str, Any],
        gmail_context: dict[str, Any] | None = None,
        calendar_context: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        learning_state = self.get_learning_state(user_id)
        profile_scores = user_data_service.get_user_profile_scores(user_id)
        session = user_data_service.get_user_session(user_id) or {}

        current_time = stored_context.time or datetime.now(IST)
        if current_time.tzinfo is None:
            current_time = current_time.replace(tzinfo=IST)

        onboarding_profile = getattr(stored_context, "onboarding_profile", {}) or {}
        preferences = getattr(stored_context, "preferences", {}) or {}
        coordinates = stored_context.location.coordinates
        time_of_day = _time_bucket(current_time)
        free_time_minutes = _next_event_gap_minutes(calendar_context, current_time) or 90
        recent_history = learning_state.get("recent_history", [])

        context = {
            "user_id": user_id,
            "location": {
                "city": stored_context.location.city,
                "coordinates": {
                    "lat": coordinates.lat if coordinates else None,
                    "lng": coordinates.lng if coordinates else None,
                },
            },
            "time": current_time.isoformat(),
            "time_of_day": time_of_day,
            "weather": weather,
            "preferences": {
                **preferences,
                **onboarding_profile,
            },
            "history": {
                "recent_interactions": recent_history[:20],
                "interaction_count": len(learning_state.get("history", [])),
                "context_history": learning_state.get("context_history", [])[:20],
                "intent_history": learning_state.get("intent_history", [])[:20],
            },
            "profile_scores": profile_scores,
            "learning_state": learning_state,
            "session": {
                "last_intent": session.get("current_intent") or learning_state.get("current_session", {}).get("last_intent"),
                "last_active": session.get("last_active"),
                "last_time": learning_state.get("current_session", {}).get("last_time") or time_of_day,
            },
            "gmail_context": gmail_context or {},
            "calendar_context": calendar_context or {},
            "free_time_minutes": free_time_minutes,
            "intent": self._derive_intent(onboarding_profile, stored_context.trip_details, learning_state, time_of_day, free_time_minutes),
        }
        return context

    def update_preferences(
        self,
        *,
        user_id: str,
        place: dict[str, Any],
        action: str,
        updated_user_state: dict[str, Any],
    ) -> dict[str, Any]:
        normalized = self._ensure_learning_shape(updated_user_state)
        normalized["updated_at"] = datetime.now(UTC).isoformat()
        self.save_learning_state(user_id, normalized)
        return normalized

    def _derive_intent(
        self,
        onboarding_profile: dict[str, Any],
        trip_details: Any,
        learning_state: dict[str, Any],
        time_of_day: str,
        free_time_minutes: int,
    ) -> str:
        recent_history = learning_state.get("recent_history", [])
        recent_intents = [_normalize_label(item.get("intent")) for item in recent_history if item.get("intent")]
        if recent_intents:
            return max(set(recent_intents), key=recent_intents.count)

        activity = _normalize_label(onboarding_profile.get("free_time_preference"))
        if activity:
            return activity

        purpose = _normalize_label(getattr(trip_details, "purpose", None))
        if purpose == "business":
            return "work"

        if free_time_minutes <= 40:
            return "quick_meal"
        if time_of_day == "morning":
            return "coffee"
        if time_of_day in {"afternoon", "evening"}:
            return "food"
        return "explore"

    def _ensure_learning_shape(self, state: dict[str, Any]) -> dict[str, Any]:
        normalized = dict(state or {})
        normalized.setdefault("preferences", {})
        normalized.setdefault("diet_pref", "any")
        normalized.setdefault("sub_pref", {})
        normalized.setdefault("price_pref", {"cheap": 0.3, "moderate": 0.8, "expensive": 0.3})
        normalized.setdefault("amb_pref", {})
        normalized.setdefault("negative_preferences", {})
        normalized.setdefault("weights", {})
        normalized.setdefault("history", [])
        normalized.setdefault("recent_history", [])
        normalized.setdefault("context_history", [])
        normalized.setdefault("time_preferences", {})
        normalized.setdefault("intent_history", [])
        normalized.setdefault("current_session", {})
        return normalized


context_engine = ContextEngine()
