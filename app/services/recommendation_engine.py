from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass
from datetime import datetime
from typing import Any


DEFAULT_WEIGHTS = {
    "category": 0.22,
    "distance": 0.18,
    "rating": 0.16,
    "diet": 0.08,
    "subcategory": 0.08,
    "ambience": 0.08,
    "time": 0.08,
    "intent": 0.07,
    "context": 0.03,
    "session": 0.02,
}

ACTION_DELTAS = {
    "like": 0.14,
    "click": 0.06,
    "save": 0.08,
    "plan": 0.1,
    "dislike": -0.18,
}

TIME_OF_DAY_EXCLUSIONS = {
    "late_night": {"museum", "park", "shopping_mall"},
    "morning": {"bar", "nightlife"},
    "afternoon": set(),
    "evening": set(),
}

WEATHER_EXCLUSIONS = {
    "rain": {"park", "outdoor", "sightseeing"},
    "heavy rain": {"park", "outdoor", "sightseeing"},
    "thunderstorm": {"park", "outdoor", "sightseeing"},
    "snow": {"park", "outdoor", "sightseeing"},
}

INTENT_CATEGORY_MAP = {
    "food": {"restaurant", "food", "meal_takeaway"},
    "quick_meal": {"restaurant", "food", "cafe", "bakery"},
    "coffee": {"cafe", "bakery"},
    "work": {"cafe", "coworking", "library"},
    "shopping": {"shopping_mall", "store"},
    "relax": {"park", "spa", "cafe"},
    "explore": {"museum", "park", "attraction", "sightseeing"},
}

PRICE_BUCKETS = {
    0: "cheap",
    1: "cheap",
    2: "moderate",
    3: "expensive",
    4: "expensive",
}


def _clamp(value: float, low: float = 0.0, high: float = 1.0) -> float:
    return max(low, min(high, value))


@dataclass(slots=True)
class RecommendationEngine:
    weights: dict[str, float]
    decay_factor: float = 0.88
    history_limit: int = 100
    recent_history_limit: int = 20
    context_history_limit: int = 60
    intent_history_limit: int = 40

    def filter_places(
        self,
        places: list[dict[str, Any]],
        context: dict[str, Any],
        max_distance: float,
    ) -> list[dict[str, Any]]:
        if not places:
            return []

        time_of_day = self._normalize_label(context.get("time_of_day"))
        weather = self._normalize_label(context.get("weather"))
        diet_pref = self._normalize_label((context.get("user") or {}).get("diet_pref")) or self._normalize_label(context.get("diet_pref"))
        negative_preferences = self._feature_bucket((context.get("user") or {}).get("negative_preferences") or context.get("negative_preferences") or {})

        filtered: list[dict[str, Any]] = []
        for place in places:
            distance = self._safe_float(place.get("distance"))
            if distance is not None and distance > max_distance:
                continue

            if place.get("open") is False:
                continue

            category = self._normalize_category(place.get("category"))
            if category in TIME_OF_DAY_EXCLUSIONS.get(time_of_day, set()):
                continue
            if category in WEATHER_EXCLUSIONS.get(weather, set()):
                continue
            if negative_preferences.get(category, 0.0) >= 0.65:
                continue

            place_diet = self._normalize_label(place.get("diet"))
            if diet_pref and diet_pref not in {"", "any"} and place_diet not in {"", "any", diet_pref}:
                continue

            if self._should_block_for_temperature(place, context):
                continue

            filtered.append(place)

        return filtered

    def calculate_score(
        self,
        place: dict[str, Any],
        user: dict[str, Any],
        context: dict[str, Any],
    ) -> float:
        features = self._score_features(place, user, context)
        total = 0.0
        for key, value in features.items():
            total += value * self.weights.get(key, 0.0)
        return round(total, 4)

    def update_preferences(
        self,
        user: dict[str, Any],
        place: dict[str, Any],
        action: str,
    ) -> dict[str, Any]:
        updated_user = self._ensure_user_shape(deepcopy(user))
        action = self._normalize_label(action)
        delta = ACTION_DELTAS.get(action, 0.0)
        category = self._normalize_category(place.get("category"))
        subcategory = self._normalize_label(place.get("subcategory"))
        diet = self._normalize_label(place.get("diet"))
        ambience = self._normalize_list(place.get("ambience"))
        price_pref = self._normalize_price(place.get("price"))

        self._adjust_bucket(updated_user["preferences"], category, delta)
        if subcategory:
            self._adjust_bucket(updated_user["sub_pref"], subcategory, delta * 0.8)
        if diet:
            updated_user["diet_pref"] = diet if action in {"like", "save", "plan"} else updated_user["diet_pref"]
        if price_pref:
            self._adjust_bucket(updated_user["price_pref"], price_pref, delta * 0.6, low=0.0, high=1.0)
        for item in ambience:
            self._adjust_bucket(updated_user["amb_pref"], item, delta * 0.6)

        if action == "dislike":
            self._adjust_bucket(updated_user["negative_preferences"], category, abs(delta), low=0.0, high=1.0)
        elif action in {"click", "like", "save", "plan"}:
            self._adjust_bucket(updated_user["negative_preferences"], category, -0.05, low=0.0, high=1.0)

        time_bucket = self._normalize_label(place.get("time_bucket") or updated_user["current_session"].get("last_time") or "evening")
        bucket = updated_user["time_preferences"].setdefault(time_bucket, {})
        self._adjust_bucket(bucket, category, delta * 0.7, low=0.0, high=1.0)

        interaction = {
            "occurred_at": datetime.utcnow().isoformat(),
            "place_id": str(place.get("place_id") or place.get("name") or "unknown"),
            "name": str(place.get("name") or "Unknown"),
            "category": category,
            "subcategory": subcategory or None,
            "diet": diet or None,
            "price": price_pref or None,
            "ambience": ambience,
            "action": action,
            "distance": self._safe_float(place.get("distance")),
            "rating": self._safe_float(place.get("rating")),
            "intent": self._normalize_label(place.get("intent")) or updated_user["current_session"].get("last_intent"),
            "time_bucket": time_bucket,
            "weather": self._normalize_label(place.get("weather")),
        }
        updated_user["history"].insert(0, interaction)
        updated_user["history"] = updated_user["history"][: self.history_limit]
        updated_user["recent_history"].insert(0, interaction)
        updated_user["recent_history"] = updated_user["recent_history"][: self.recent_history_limit]
        updated_user["context_history"].insert(
            0,
            {
                "time": time_bucket,
                "weather": interaction["weather"],
                "intent": interaction["intent"],
                "category": category,
                "action": action,
            },
        )
        updated_user["context_history"] = updated_user["context_history"][: self.context_history_limit]
        updated_user["intent_history"].insert(
            0,
            {"intent": interaction["intent"], "category": category, "action": action},
        )
        updated_user["intent_history"] = updated_user["intent_history"][: self.intent_history_limit]
        updated_user["current_session"] = {
            "last_intent": interaction["intent"],
            "last_time": time_bucket,
            "last_action": action,
        }

        self._update_weights(updated_user, interaction)
        return updated_user

    def recommend(
        self,
        user: dict[str, Any],
        places: list[dict[str, Any]],
        context: dict[str, Any],
        max_distance: float = 5000.0,
    ) -> list[dict[str, Any]]:
        safe_user = self._ensure_user_shape(deepcopy(user))
        rich_context = deepcopy(context)
        rich_context["user"] = safe_user
        rich_context.setdefault("intent", self._predict_intent(safe_user, rich_context))

        filtered_places = self.filter_places(places, rich_context, max_distance=max_distance)
        if not filtered_places:
            filtered_places = self._relax_filters(places, safe_user, rich_context, max_distance=max_distance * 2)
        if not filtered_places:
            return []

        ranked = []
        for place in filtered_places:
            score = self.calculate_score(place, safe_user, rich_context)
            ranked.append(
                {
                    "place_id": str(place.get("place_id") or place.get("name") or "unknown"),
                    "name": str(place.get("name", "Unknown")),
                    "category": self._normalize_category(place.get("category")),
                    "type": str(place.get("type") or ""),
                    "score": score,
                    "reason": self._build_reason(place, safe_user, rich_context),
                    "google_rating": self._safe_float(place.get("rating")),
                    "place_address": str(place.get("place_address") or place.get("address") or ""),
                    "distance": self._safe_float(place.get("distance")),
                }
            )

        ranked.sort(key=lambda item: item["score"], reverse=True)
        return ranked

    def _relax_filters(
        self,
        places: list[dict[str, Any]],
        user: dict[str, Any],
        context: dict[str, Any],
        max_distance: float,
    ) -> list[dict[str, Any]]:
        relaxed = []
        for place in places:
            distance = self._safe_float(place.get("distance"))
            if distance is not None and distance > max_distance:
                continue
            if self._normalize_category(place.get("category")) in self._feature_bucket(user.get("negative_preferences", {})):
                if user["negative_preferences"].get(self._normalize_category(place.get("category")), 0.0) >= 0.9:
                    continue
            relaxed.append(place)
        return relaxed

    def _score_features(self, place: dict[str, Any], user: dict[str, Any], context: dict[str, Any]) -> dict[str, float]:
        metadata_category = self._normalize_category(place.get("category"))
        metadata_subcategory = self._normalize_label(place.get("subcategory"))
        metadata_diet = self._normalize_label(place.get("diet")) or "any"
        metadata_ambience = self._normalize_list(place.get("ambience"))
        time_bucket = self._normalize_label(context.get("time_of_day")) or "evening"
        intent = self._normalize_label(context.get("intent")) or self._predict_intent(user, context)

        category_score = self._bucket_score(user.get("preferences", {}), metadata_category)
        subcategory_score = self._bucket_score(user.get("sub_pref", {}), metadata_subcategory)
        ambience_score = self._list_bucket_score(user.get("amb_pref", {}), metadata_ambience)
        diet_score = 1.0 if user.get("diet_pref", "any") in {"any", metadata_diet} else 0.1
        rating_score = _clamp((self._safe_float(place.get("rating")) or 0.0) / 5.0)
        distance_score = self._distance_score(self._safe_float(place.get("distance")))
        time_score = self._bucket_score(user.get("time_preferences", {}).get(time_bucket, {}), metadata_category, fallback=0.5)
        intent_score = self._intent_score(intent, metadata_category, metadata_subcategory)
        context_score = self._context_score(place, context, metadata_category)
        session_score = self._session_score(user, intent)
        recency_score = self._recency_score(user, metadata_category)

        return {
            "category": category_score,
            "distance": distance_score,
            "rating": rating_score,
            "diet": diet_score,
            "subcategory": subcategory_score,
            "ambience": ambience_score,
            "time": time_score,
            "intent": intent_score,
            "context": context_score,
            "session": (session_score + recency_score) / 2.0,
        }

    def _predict_intent(self, user: dict[str, Any], context: dict[str, Any]) -> str:
        time_of_day = self._normalize_label(context.get("time_of_day"))
        free_time = context.get("free_time_minutes")
        if isinstance(free_time, (int, float)) and free_time < 45:
            return "quick_meal"
        recent_intents = [self._normalize_label(item.get("intent")) for item in user.get("recent_history", []) if item.get("intent")]
        if recent_intents:
            winner = max(set(recent_intents), key=recent_intents.count)
            if winner:
                return winner
        if time_of_day == "morning":
            return "coffee"
        if time_of_day == "afternoon":
            return "food"
        if time_of_day == "night":
            return "quick_meal"
        return "explore"

    def _build_reason(self, place: dict[str, Any], user: dict[str, Any], context: dict[str, Any]) -> str:
        fragments = []
        category = self._normalize_category(place.get("category"))
        if user.get("preferences", {}).get(category, 0.0) > 0:
            fragments.append(f"matches your {category} preference")
        ambience = self._normalize_list(place.get("ambience"))
        matched_ambience = [item for item in ambience if user.get("amb_pref", {}).get(item, 0.0) > 0]
        if matched_ambience:
            fragments.append(f"fits your {' + '.join(matched_ambience[:2])} vibe")
        if place.get("open") is True:
            fragments.append("open now")
        if place.get("distance") is not None:
            fragments.append(f"{self._safe_float(place.get('distance')) or 0:.1f} km away")
        return ". ".join(fragments[:3]).capitalize() or "A balanced nearby match for the current moment."

    def _update_weights(self, user: dict[str, Any], interaction: dict[str, Any]) -> None:
        action = interaction.get("action")
        category = interaction.get("category")
        rating = self._safe_float(interaction.get("rating")) or 0.0
        distance = self._safe_float(interaction.get("distance")) or 0.0
        bounds = (0.05, 0.35)

        if action in {"like", "save", "plan"}:
            user["weights"]["category"] = _clamp(user["weights"]["category"] + 0.01, *bounds)
            if distance and distance <= 2.0:
                user["weights"]["distance"] = _clamp(user["weights"]["distance"] + 0.008, *bounds)
            if rating >= 4.2:
                user["weights"]["rating"] = _clamp(user["weights"]["rating"] + 0.006, *bounds)
        elif action == "dislike":
            user["weights"]["category"] = _clamp(user["weights"]["category"] - 0.006, *bounds)
            user["weights"]["distance"] = _clamp(user["weights"]["distance"] - 0.003, *bounds)
        elif action == "click":
            user["weights"]["intent"] = _clamp(user["weights"]["intent"] + 0.004, *bounds)

        if category and user["negative_preferences"].get(category, 0.0) >= 0.6:
            user["weights"]["context"] = _clamp(user["weights"]["context"] + 0.002, *bounds)

    def _distance_score(self, distance: float | None) -> float:
        if distance is None:
            return 0.0
        # Input distances in current app are typically km
        max_distance = 10.0
        return _clamp(1.0 - min(distance, max_distance) / max_distance)

    def _context_score(self, place: dict[str, Any], context: dict[str, Any], category: str) -> float:
        score = 0.5
        weather = self._normalize_label(context.get("weather"))
        time_of_day = self._normalize_label(context.get("time_of_day"))
        if weather in {"clear", "mostly clear", "partly cloudy"} and category in {"park", "sightseeing", "attraction"}:
            score += 0.25
        if weather in {"rain", "heavy rain", "thunderstorm"} and category in {"cafe", "restaurant", "museum"}:
            score += 0.25
        if time_of_day == "night" and category in {"cafe", "restaurant", "food"}:
            score += 0.15
        if time_of_day == "morning" and category in {"cafe", "bakery"}:
            score += 0.15
        return _clamp(score)

    def _session_score(self, user: dict[str, Any], intent: str) -> float:
        if self._normalize_label(user.get("current_session", {}).get("last_intent")) == intent:
            return 1.0
        if self._normalize_label(user.get("current_session", {}).get("last_action")) == "dislike":
            return 0.3
        return 0.55

    def _recency_score(self, user: dict[str, Any], category: str) -> float:
        total = 0.0
        for index, item in enumerate(user.get("recent_history", [])[: self.recent_history_limit]):
            if self._normalize_category(item.get("category")) != category:
                continue
            action = self._normalize_label(item.get("action"))
            total += ACTION_DELTAS.get(action, 0.0) * (self.decay_factor ** index)
        return _clamp((total + 0.4) / 0.8)

    def _intent_score(self, intent: str, category: str, subcategory: str) -> float:
        allowed = INTENT_CATEGORY_MAP.get(intent, set())
        if category in allowed or subcategory in allowed:
            return 1.0
        return 0.35

    def _bucket_score(self, bucket: dict[str, Any], key: str, fallback: float = 0.0) -> float:
        if not key:
            return fallback
        if key not in bucket:
            return fallback
        value = self._safe_float(bucket.get(key)) or 0.0
        return _clamp((value + 1.0) / 2.0)

    def _list_bucket_score(self, bucket: dict[str, Any], values: list[str]) -> float:
        if not values:
            return 0.4
        matches = [self._bucket_score(bucket, value, fallback=0.0) for value in values]
        if not matches:
            return 0.4
        return sum(matches) / len(matches)

    def _normalize_category(self, value: Any) -> str:
        return self._normalize_label(value) or "unknown"

    def _normalize_label(self, value: Any) -> str:
        return str(value or "").strip().lower().replace("-", "_").replace(" ", "_")

    def _normalize_list(self, value: Any) -> list[str]:
        if isinstance(value, list):
            return [self._normalize_label(item) for item in value if str(item or "").strip()]
        if isinstance(value, str) and value.strip():
            return [self._normalize_label(part) for part in value.split(",") if part.strip()]
        return []

    def _normalize_price(self, value: Any) -> str:
        if isinstance(value, str):
            label = self._normalize_label(value)
            return label if label in {"cheap", "moderate", "expensive"} else ""
        if isinstance(value, (int, float)):
            return PRICE_BUCKETS.get(int(value), "")
        return ""

    def _safe_float(self, value: Any) -> float | None:
        try:
            return float(value)
        except (TypeError, ValueError):
            return None

    def _adjust_bucket(
        self,
        bucket: dict[str, float],
        key: str,
        delta: float,
        low: float = -1.0,
        high: float = 1.0,
    ) -> None:
        if not key:
            return
        bucket[key] = max(low, min(high, float(bucket.get(key, 0.0)) + delta))

    def _feature_bucket(self, data: dict[str, Any]) -> dict[str, float]:
        return {self._normalize_label(key): float(value) for key, value in data.items()}

    def _ensure_user_shape(self, user: dict[str, Any]) -> dict[str, Any]:
        user.setdefault("preferences", {})
        user.setdefault("diet_pref", "any")
        user.setdefault("sub_pref", {})
        user.setdefault("price_pref", {"cheap": 0.2, "moderate": 0.6, "expensive": 0.2})
        user.setdefault("amb_pref", {})
        user.setdefault("negative_preferences", {})
        user.setdefault("weights", deepcopy(self.weights))
        user.setdefault("history", [])
        user.setdefault("recent_history", [])
        user.setdefault("context_history", [])
        user.setdefault("time_preferences", {})
        user.setdefault("intent_history", [])
        user.setdefault("current_session", {})
        return user

    def _should_block_for_temperature(self, place: dict[str, Any], context: dict[str, Any]) -> bool:
        temperature = context.get("temperature")
        category = self._normalize_category(place.get("category"))
        if not isinstance(temperature, (int, float)):
            return False
        if temperature >= 34 and category in {"park", "outdoor", "sightseeing"}:
            return True
        if temperature <= 10 and category in {"ice_cream", "outdoor"}:
            return True
        return False


def filter_places(
    places: list[dict[str, Any]],
    context: dict[str, Any],
    max_distance: float,
) -> list[dict[str, Any]]:
    return recommendation_engine.filter_places(places, context, max_distance=max_distance)


def calculate_score(
    place: dict[str, Any],
    user: dict[str, Any],
    context: dict[str, Any],
) -> float:
    return recommendation_engine.calculate_score(place, user, context)


def update_preferences(
    user: dict[str, Any],
    place: dict[str, Any],
    action: str,
) -> dict[str, Any]:
    return recommendation_engine.update_preferences(user, place, action)


def recommend(
    user: dict[str, Any],
    places: list[dict[str, Any]],
    context: dict[str, Any],
    max_distance: float = 5000.0,
) -> list[dict[str, Any]]:
    return recommendation_engine.recommend(user, places, context, max_distance=max_distance)


recommendation_engine = RecommendationEngine(weights=DEFAULT_WEIGHTS)


EXAMPLE_INPUT = {
    "places": [
        {
            "name": "Cafe Nova",
            "category": "cafe",
            "subcategory": "bakery",
            "distance": 0.35,
            "rating": 4.6,
            "open": True,
            "diet": "veg",
            "ambience": ["calm", "productive"],
        },
        {
            "name": "City Museum",
            "category": "museum",
            "distance": 1.4,
            "rating": 4.4,
            "open": True,
            "ambience": ["quiet"],
        },
        {
            "name": "Night Bites",
            "category": "restaurant",
            "distance": 0.5,
            "rating": 4.2,
            "open": True,
            "diet": "any",
            "ambience": ["social"],
        },
    ],
    "context": {
        "time_of_day": "evening",
        "weather": "Clear",
        "temperature": 26.0,
        "free_time_minutes": 60,
    },
    "user": {
        "preferences": {"cafe": 0.8, "restaurant": 0.4},
        "diet_pref": "veg",
        "sub_pref": {"bakery": 0.5},
        "amb_pref": {"calm": 0.8, "productive": 0.4},
        "negative_preferences": {"bar": 0.7},
        "history": [],
        "recent_history": [{"category": "cafe", "action": "like", "intent": "coffee"}],
        "context_history": [],
        "time_preferences": {"evening": {"restaurant": 0.6, "cafe": 0.7}},
        "intent_history": [],
        "current_session": {"last_intent": "coffee", "last_action": "click"},
    },
}
