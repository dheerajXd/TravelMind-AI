from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass
from typing import Any


DEFAULT_WEIGHTS = {
    "preference": 0.45,
    "distance": 0.25,
    "rating": 0.20,
    "open_bonus": 0.10,
}

ACTION_DELTAS = {
    "like": 3.0,
    "click": 1.0,
    "dislike": -2.0,
}

WEATHER_EXCLUSIONS = {
    "rain": {"park", "outdoor", "sightseeing"},
    "heavy rain": {"park", "outdoor", "sightseeing"},
    "thunderstorm": {"park", "outdoor", "sightseeing"},
    "snow": {"park", "outdoor", "sightseeing"},
}

TIME_OF_DAY_EXCLUSIONS = {
    "late_night": {"museum", "park", "shopping"},
    "morning": {"bar", "nightlife"},
    "afternoon": set(),
    "evening": set(),
}


@dataclass(slots=True)
class RecommendationEngine:
    weights: dict[str, float]
    decay_factor: float = 0.85

    def filter_places(
        self,
        places: list[dict[str, Any]],
        context: dict[str, Any],
        max_distance: float,
    ) -> list[dict[str, Any]]:
        if not places:
            return []

        time_of_day = str(context.get("time_of_day", "")).strip().lower()
        weather = str(context.get("weather", "")).strip().lower()
        temperature = context.get("temperature")

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

            excluded_for_weather = WEATHER_EXCLUSIONS.get(weather, set())
            if category in excluded_for_weather:
                continue

            if isinstance(temperature, (int, float)):
                if temperature >= 34 and category in {"park", "outdoor", "sightseeing"}:
                    continue
                if temperature <= 10 and category in {"ice cream", "outdoor"}:
                    continue

            filtered.append(place)

        return filtered

    def calculate_score(
        self,
        place: dict[str, Any],
        user: dict[str, Any],
        context: dict[str, Any],
    ) -> float:
        category = self._normalize_category(place.get("category"))
        distance = self._safe_float(place.get("distance")) or 999999.0
        rating = self._safe_float(place.get("rating")) or 0.0
        open_bonus = 1.0 if place.get("open") is True else 0.0

        preference_weight = self._category_preference_score(category, user.get("preferences") or {})
        preference_weight += self._history_affinity_score(category, user.get("history") or [])
        preference_weight += self._context_alignment_score(category, context)

        distance_score = 1.0 / max(distance, 1.0)

        score = (
            (preference_weight * self.weights["preference"])
            + (distance_score * self.weights["distance"])
            + (rating * self.weights["rating"])
            + (open_bonus * self.weights["open_bonus"])
        )
        return round(score, 4)

    def update_preferences(
        self,
        user: dict[str, Any],
        place: dict[str, Any],
        action: str,
    ) -> dict[str, Any]:
        updated_user = deepcopy(user)
        preferences = updated_user.setdefault("preferences", {})
        history = updated_user.setdefault("history", [])

        category = self._normalize_category(place.get("category"))
        delta = ACTION_DELTAS.get(action, 0.0)

        category_scores = preferences.setdefault("categories", {})
        category_scores[category] = round(category_scores.get(category, 0.0) + delta, 2)

        history.insert(
            0,
            {
                "category": category,
                "action": action,
            },
        )
        return updated_user

    def recommend(
        self,
        user: dict[str, Any],
        places: list[dict[str, Any]],
        context: dict[str, Any],
        max_distance: float = 5000.0,
    ) -> list[dict[str, Any]]:
        filtered_places = self.filter_places(places, context, max_distance=max_distance)
        if not filtered_places:
            return []

        ranked = []
        for place in filtered_places:
            ranked.append(
                {
                    "name": str(place.get("name", "Unknown")),
                    "category": self._normalize_category(place.get("category")),
                    "score": self.calculate_score(place, user, context),
                }
            )

        ranked.sort(key=lambda item: item["score"], reverse=True)
        return ranked

    def _category_preference_score(self, category: str, preferences: dict[str, Any]) -> float:
        category_scores = preferences.get("categories") or {}
        if category in category_scores:
            return self._safe_float(category_scores.get(category)) or 0.0

        preferred_categories = preferences.get("preferred_categories") or []
        if category in {self._normalize_category(item) for item in preferred_categories}:
            return 2.0
        return 0.0

    def _history_affinity_score(self, category: str, history: list[dict[str, Any]]) -> float:
        if not history:
            return 0.0

        total = 0.0
        for index, item in enumerate(history):
            if self._normalize_category(item.get("category")) != category:
                continue
            action = str(item.get("action", "")).lower()
            delta = ACTION_DELTAS.get(action, 0.0)
            total += delta * (self.decay_factor ** index)
        return total

    def _context_alignment_score(self, category: str, context: dict[str, Any]) -> float:
        time_of_day = str(context.get("time_of_day", "")).strip().lower()
        weather = str(context.get("weather", "")).strip().lower()

        score = 0.0
        if time_of_day == "morning" and category in {"cafe", "breakfast", "bakery"}:
            score += 1.0
        if time_of_day == "evening" and category in {"restaurant", "food", "sightseeing"}:
            score += 1.0
        if time_of_day == "late_night" and category in {"cafe", "restaurant", "food"}:
            score += 1.2

        if weather in {"clear", "mostly clear", "partly cloudy"} and category in {"park", "outdoor", "sightseeing"}:
            score += 0.8
        if weather in {"rain", "heavy rain", "thunderstorm"} and category in {"cafe", "restaurant", "museum", "indoor"}:
            score += 0.8
        return score

    def _normalize_category(self, value: Any) -> str:
        return str(value or "unknown").strip().lower()

    def _safe_float(self, value: Any) -> float | None:
        try:
            return float(value)
        except (TypeError, ValueError):
            return None


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
        {"name": "Cafe Nova", "category": "cafe", "distance": 350, "rating": 4.6, "open": True},
        {"name": "City Museum", "category": "museum", "distance": 1400, "rating": 4.4, "open": True},
        {"name": "Night Bites", "category": "restaurant", "distance": 500, "rating": 4.2, "open": True},
    ],
    "context": {
        "time_of_day": "evening",
        "weather": "Clear",
        "temperature": 26.0,
    },
    "user": {
        "preferences": {
            "preferred_categories": ["cafe", "restaurant"],
            "categories": {"cafe": 3.0, "restaurant": 1.0},
        },
        "history": [
            {"category": "cafe", "action": "like"},
            {"category": "restaurant", "action": "click"},
        ],
    },
}

EXAMPLE_OUTPUT = [
    {"name": "Cafe Nova", "category": "cafe", "score": 3.3443},
    {"name": "Night Bites", "category": "restaurant", "score": 1.2461},
]

EXAMPLE_USAGE = """
from app.services.recommendation_engine import recommend, update_preferences

ranked = recommend(
    user=EXAMPLE_INPUT["user"],
    places=EXAMPLE_INPUT["places"],
    context=EXAMPLE_INPUT["context"],
    max_distance=1500,
)

updated_user = update_preferences(
    user=EXAMPLE_INPUT["user"],
    place=EXAMPLE_INPUT["places"][0],
    action="like",
)
"""
