from __future__ import annotations

from math import asin, cos, radians, sin, sqrt
from typing import Any

from app.services.recommendation_engine import calculate_score, filter_places, update_preferences


def _normalize_label(value: Any) -> str:
    return str(value or "").strip().lower().replace("-", "_").replace(" ", "_")


def _haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    earth_radius_km = 6371
    d_lat = radians(lat2 - lat1)
    d_lng = radians(lng2 - lng1)
    lat1_r = radians(lat1)
    lat2_r = radians(lat2)
    a = sin(d_lat / 2) ** 2 + cos(lat1_r) * cos(lat2_r) * sin(d_lng / 2) ** 2
    return 2 * earth_radius_km * asin(sqrt(a))


def _friendly_type(category: str) -> str:
    if category == "cafe":
        return "cafe"
    if category in {"park", "museum", "attraction", "shopping_mall"}:
        return "activity"
    return "restaurant"


def _engine_category(types: list[str], name: str) -> str:
    normalized = {item.lower() for item in types}
    lowered_name = (name or "").lower()
    if {"cafe", "bakery"} & normalized or any(term in lowered_name for term in {"cafe", "coffee"}):
        return "cafe"
    if {"coworking", "library"} & normalized or any(term in lowered_name for term in {"workspace", "cowork", "lounge"}):
        return "coworking"
    if {"park"} & normalized:
        return "park"
    if {"museum"} & normalized:
        return "museum"
    if {"tourist_attraction", "attraction"} & normalized:
        return "attraction"
    if {"shopping_mall", "store"} & normalized:
        return "shopping_mall"
    if {"restaurant", "meal_takeaway", "meal_delivery", "food"} & normalized:
        return "restaurant"
    return "restaurant"


def _engine_subcategory(types: list[str], name: str) -> str:
    normalized = {item.lower().replace(" ", "_") for item in types}
    lowered_name = (name or "").lower()
    for token in ("south indian", "italian", "chinese", "vegetarian", "veg", "street food", "coffee"):
        if token in lowered_name:
            return token.replace(" ", "_")
    return next(iter(normalized), "")


def _infer_diet(name: str, types: list[str], preferred_cuisine: str) -> str:
    lowered_name = (name or "").lower()
    normalized_types = {item.lower() for item in types}
    if preferred_cuisine in {"veg", "vegetarian", "south indian"} or any(token in lowered_name for token in {"veg", "vegetarian", "tiffin"}):
        return "veg"
    if "vegetarian_restaurant" in normalized_types:
        return "veg"
    return "any"


def _infer_ambience(types: list[str], name: str, activity: str) -> list[str]:
    normalized = {item.lower() for item in types}
    lowered_name = (name or "").lower()
    ambience: list[str] = []
    if activity == "work":
        ambience.extend(["productive", "quiet"])
    elif activity in {"coffee", "cafe"}:
        ambience.extend(["calm", "social"])
    elif activity == "explore":
        ambience.extend(["outdoor", "explore"])
    else:
        ambience.append("calm")
    if {"park", "tourist_attraction", "attraction"} & normalized:
        ambience.append("outdoor")
    if any(token in lowered_name for token in {"lounge", "rooftop"}):
        ambience.append("social")
    return list(dict.fromkeys(ambience))


class RankingEngine:
    def prepare_places(self, context: dict[str, Any], places: list[Any]) -> list[dict[str, Any]]:
        coordinates = (((context.get("location") or {}).get("coordinates")) or {})
        user_preferences = context.get("preferences") or {}
        cuisine = _normalize_label(user_preferences.get("cuisine_preference"))
        activity = _normalize_label(context.get("intent") or user_preferences.get("free_time_preference"))

        enriched_places: list[dict[str, Any]] = []
        for place in places:
            place_lat = getattr(place, "lat", None)
            place_lng = getattr(place, "lng", None)
            distance_km = None
            if coordinates.get("lat") is not None and coordinates.get("lng") is not None and place_lat is not None and place_lng is not None:
                distance_km = round(_haversine_km(float(coordinates["lat"]), float(coordinates["lng"]), float(place_lat), float(place_lng)), 2)

            category = _engine_category(getattr(place, "types", []), getattr(place, "name", ""))
            enriched_places.append(
                {
                    "place_id": getattr(place, "id", None) or f"{place.name}:{place.address}",
                    "name": place.name,
                    "category": category,
                    "subcategory": _engine_subcategory(getattr(place, "types", []), getattr(place, "name", "")),
                    "distance": distance_km,
                    "rating": getattr(place, "rating", None),
                    "open": getattr(place, "open_now", None),
                    "diet": _infer_diet(getattr(place, "name", ""), getattr(place, "types", []), cuisine),
                    "ambience": _infer_ambience(getattr(place, "types", []), getattr(place, "name", ""), activity),
                    "price": "moderate" if (getattr(place, "rating", 0) or 0) >= 4.2 else "cheap",
                    "type": _friendly_type(category),
                    "place_address": getattr(place, "address", ""),
                    "weather": (context.get("weather") or {}).get("condition"),
                    "raw_types": getattr(place, "types", []),
                }
            )
        return enriched_places

    def rank_places(self, context: dict[str, Any], places: list[dict[str, Any]], radius_meters: int) -> list[dict[str, Any]]:
        user_state = self._build_user_state(context)
        engine_context = {
            "time_of_day": context.get("time_of_day"),
            "weather": (context.get("weather") or {}).get("condition"),
            "temperature": (context.get("weather") or {}).get("temperature"),
            "free_time_minutes": context.get("free_time_minutes"),
            "intent": context.get("intent"),
            "diet_pref": user_state.get("diet_pref"),
        }

        filtered = filter_places(places, {"user": user_state, **engine_context}, max_distance=max(1.5, radius_meters / 1000))
        if not filtered:
            filtered = places

        scored: list[dict[str, Any]] = []
        for place in filtered:
            base_score = calculate_score(place, user_state, engine_context)
            recency_bias = self._recency_bias(user_state, place.get("category"))
            context_boost = self._context_boost(context, place)
            preliminary_score = max(0.0, min(1.0, (base_score * 0.72) + (recency_bias * 0.18) + (context_boost * 0.10)))
            scored.append(
                {
                    **place,
                    "score": preliminary_score,
                    "reason": self._build_reason(context, place),
                    "google_rating": place.get("rating"),
                }
            )

        scored.sort(
            key=lambda item: (
                -item["score"],
                -(item.get("google_rating") or 0.0),
                item.get("distance") if item.get("distance") is not None else 999,
            )
        )
        return self._apply_diversity(scored)

    def update_learning(self, learning_state: dict[str, Any], place: dict[str, Any], action: str, context: dict[str, Any]) -> dict[str, Any]:
        payload = {
            **place,
            "intent": context.get("intent"),
            "weather": _normalize_label((context.get("weather") or {}).get("condition")),
            "time_bucket": context.get("time_of_day"),
        }
        return update_preferences(learning_state, payload, action)

    def _build_user_state(self, context: dict[str, Any]) -> dict[str, Any]:
        learning_state = dict(context.get("learning_state") or {})
        profile_scores = context.get("profile_scores") or {}
        base_preferences = learning_state.get("preferences", {})
        merged_preferences = {**{_normalize_label(k): float(v) for k, v in profile_scores.items()}, **base_preferences}
        learning_state["preferences"] = merged_preferences
        learning_state.setdefault("current_session", {})
        learning_state["current_session"]["last_intent"] = context.get("intent")
        learning_state["current_session"]["last_time"] = context.get("time_of_day")
        return learning_state

    def _recency_bias(self, user_state: dict[str, Any], category: str | None) -> float:
        if not category:
            return 0.35
        recent_history = user_state.get("recent_history", [])[:10]
        bias = 0.35
        for index, item in enumerate(recent_history):
            if _normalize_label(item.get("category")) != _normalize_label(category):
                continue
            action = _normalize_label(item.get("action"))
            if action in {"plan", "save"}:
                bias += 0.18 / (index + 1)
            elif action == "click":
                bias += 0.10 / (index + 1)
            elif action == "ignore":
                bias -= 0.08 / (index + 1)
        return max(0.0, min(1.0, bias))

    def _context_boost(self, context: dict[str, Any], place: dict[str, Any]) -> float:
        category = _normalize_label(place.get("category"))
        time_of_day = _normalize_label(context.get("time_of_day"))
        weather = _normalize_label((context.get("weather") or {}).get("condition"))
        boost = 0.45
        if time_of_day == "evening" and category in {"restaurant", "cafe"}:
            boost += 0.3
        if time_of_day == "morning" and category in {"cafe", "bakery"}:
            boost += 0.25
        if weather in {"rain", "heavy_rain", "thunderstorm"} and category in {"cafe", "restaurant", "museum"}:
            boost += 0.25
        if weather in {"clear", "mostly_clear"} and category in {"park", "attraction"}:
            boost += 0.18
        return max(0.0, min(1.0, boost))

    def _apply_diversity(self, scored: list[dict[str, Any]]) -> list[dict[str, Any]]:
        category_counts: dict[str, int] = {}
        diversified: list[dict[str, Any]] = []
        remaining = scored[:]
        while remaining and len(diversified) < len(scored):
            adjusted = []
            for item in remaining:
                category = _normalize_label(item.get("category"))
                diversity_penalty = 0.12 * category_counts.get(category, 0)
                adjusted.append((item["score"] - diversity_penalty, item))
            adjusted.sort(key=lambda entry: (-entry[0], -(entry[1].get("google_rating") or 0.0)))
            _, winner = adjusted[0]
            diversified.append(winner)
            category = _normalize_label(winner.get("category"))
            category_counts[category] = category_counts.get(category, 0) + 1
            remaining = [item for item in remaining if item.get("place_id") != winner.get("place_id")]
        return diversified

    def _build_reason(self, context: dict[str, Any], place: dict[str, Any]) -> str:
        fragments = []
        category = _normalize_label(place.get("category"))
        user_preferences = context.get("preferences") or {}
        vibe = user_preferences.get("vibe")
        cuisine = user_preferences.get("cuisine_preference")
        if vibe:
            fragments.append(f"fits your {str(vibe).lower()} preference")
        if cuisine and category in {"restaurant", "cafe"}:
            fragments.append(f"aligns with your {str(cuisine).lower()} taste")
        if place.get("distance") is not None:
            fragments.append(f"{float(place['distance']):.1f} km away")
        if place.get("google_rating"):
            fragments.append(f"rated {float(place['google_rating']):.1f}")
        if context.get("time_of_day") == "evening" and category in {"restaurant", "cafe"}:
            fragments.append("well suited to the current evening window")
        if _normalize_label((context.get("weather") or {}).get("condition")) in {"rain", "heavy_rain", "thunderstorm"} and category in {"restaurant", "cafe", "museum"}:
            fragments.append("works well in the current weather")
        return "Recommended because it " + ", ".join(fragments[:3]) + "."


ranking_engine = RankingEngine()
