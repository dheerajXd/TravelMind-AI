from __future__ import annotations

import asyncio
from typing import Any

from app.models.schemas import NearbyMatchItem, RecommendationItem
from app.services.context_engine import context_engine
from app.services.ranking_engine import ranking_engine
from app.services.tool_layer import tool_layer
from app.utils.helpers import logger


def _friendly_category(types: list[str]) -> str:
    normalized = {str(item).lower() for item in types}
    if {"cafe", "bakery"} & normalized:
        return "Cafe"
    if {"restaurant", "meal_takeaway", "meal_delivery"} & normalized:
        return "Food"
    if {"park", "museum", "tourist_attraction", "attraction"} & normalized:
        return "Explore"
    if {"coworking", "library"} & normalized:
        return "Work"
    return "Nearby"


class DecisionEngine:
    async def generate_recommendations(
        self,
        *,
        user_id: str,
        stored_context,
        requested_type: str,
        radius: int,
        weather: dict[str, Any],
        gmail_context: dict[str, Any] | None = None,
        calendar_context: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        context = context_engine.build_context(
            user_id=user_id,
            stored_context=stored_context,
            weather=weather,
            gmail_context=gmail_context,
            calendar_context=calendar_context,
        )

        places = await self._fetch_candidate_places(context, requested_type, radius)
        prepared_places = ranking_engine.prepare_places(context, places)
        ranked_places = ranking_engine.rank_places(context, prepared_places, radius)

        if not ranked_places:
            logger.info("Decision engine returned no ranked places, broadening search radius and categories.")
            broader_radius = min(radius * 2, 10000)
            places = await self._fetch_candidate_places(context, "popular places", broader_radius)
            prepared_places = ranking_engine.prepare_places(context, places)
            ranked_places = ranking_engine.rank_places(context, prepared_places, broader_radius)

        recommendations = self._to_recommendation_items(ranked_places)
        nearby_matches = self._to_nearby_match_items(places, context)
        return {
            "context": context,
            "raw_places": places,
            "ranked_places": ranked_places,
            "recommendations": recommendations,
            "nearby_matches": nearby_matches,
        }

    async def apply_feedback(
        self,
        *,
        user_id: str,
        stored_context,
        weather: dict[str, Any],
        action: str,
        place: dict[str, Any],
        gmail_context: dict[str, Any] | None = None,
        calendar_context: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        context = context_engine.build_context(
            user_id=user_id,
            stored_context=stored_context,
            weather=weather,
            gmail_context=gmail_context,
            calendar_context=calendar_context,
        )
        updated = ranking_engine.update_learning(context["learning_state"], place, action, context)
        return context_engine.update_preferences(user_id=user_id, place=place, action=action, updated_user_state=updated)

    async def _fetch_candidate_places(self, context: dict[str, Any], requested_type: str, radius: int):
        location = context.get("location") or {}
        coordinates = location.get("coordinates") or {}
        category_plan = self._category_plan(context, requested_type)

        tasks = [
            tool_layer.get_nearby_places(
                lat=coordinates.get("lat"),
                lng=coordinates.get("lng"),
                city=location.get("city"),
                category=category,
                radius=radius,
            )
            for category in category_plan
        ]
        place_groups = await asyncio.gather(*tasks, return_exceptions=True)

        merged = []
        seen = set()
        for group in place_groups:
            if isinstance(group, Exception):
                logger.warning("Candidate place fetch failed: %s", group)
                continue
            for place in group:
                key = (place.id, place.name, place.address)
                if key in seen:
                    continue
                seen.add(key)
                merged.append(place)
        return merged

    def _category_plan(self, context: dict[str, Any], requested_type: str) -> list[str]:
        user_preferences = context.get("preferences") or {}
        time_of_day = str(context.get("time_of_day") or "")
        weather = str((context.get("weather") or {}).get("condition") or "").lower()
        activity = str(context.get("intent") or user_preferences.get("free_time_preference") or "").lower()
        cuisine = str(user_preferences.get("cuisine_preference") or "").lower()

        planned = [requested_type]
        if time_of_day == "evening":
            planned.extend(["restaurant", "cafe"])
        elif time_of_day == "morning":
            planned.extend(["cafe", "bakery"])
        else:
            planned.extend(["restaurant", "cafe", "attraction"])

        if weather in {"rain", "heavy rain", "thunderstorm"}:
            planned.extend(["museum", "cafe", "restaurant"])
        elif weather in {"clear", "mostly clear"}:
            planned.extend(["park", "attraction"])

        if activity in {"food", "quick_meal"}:
            planned.extend(["restaurant", cuisine or "restaurant"])
        elif activity in {"coffee", "cafe"}:
            planned.extend(["cafe", "bakery"])
        elif activity == "work":
            planned.extend(["coworking", "cafe"])
        elif activity == "explore":
            planned.extend(["attraction", "museum", "park"])

        deduped = []
        for item in planned:
            normalized = str(item or "").strip().lower()
            if normalized and normalized not in deduped:
                deduped.append(normalized)
        return deduped[:5]

    def _to_recommendation_items(self, ranked_places: list[dict[str, Any]]) -> list[RecommendationItem]:
        items: list[RecommendationItem] = []
        for index, candidate in enumerate(ranked_places[:4], start=1):
            items.append(
                RecommendationItem(
                    title=str(candidate.get("name") or "Nearby recommendation"),
                    reason=str(candidate.get("reason") or "Strong nearby fit for the current moment."),
                    type=str(candidate.get("type") or "restaurant"),
                    priority=index,
                    google_rating=candidate.get("google_rating"),
                    place_address=candidate.get("place_address") or None,
                )
            )
        return items

    def _to_nearby_match_items(self, places: list[Any], context: dict[str, Any]) -> list[NearbyMatchItem]:
        location = context.get("location") or {}
        coordinates = location.get("coordinates") or {}
        nearby: list[NearbyMatchItem] = []
        for place in places[:6]:
            distance_meters = None
            walk_eta = None
            drive_eta = None
            if coordinates.get("lat") is not None and coordinates.get("lng") is not None and place.lat is not None and place.lng is not None:
                distance_km = ranking_engine.prepare_places(context, [place])[0].get("distance")
                if distance_km is not None:
                    distance_meters = int(distance_km * 1000)
                    walk_eta = max(1, round(distance_meters / 80))
                    drive_eta = max(1, round(distance_meters / 350))
            nearby.append(
                NearbyMatchItem(
                    name=place.name,
                    google_rating=place.rating,
                    address=place.address,
                    category=_friendly_category(place.types),
                    open_now=place.open_now,
                    distance_meters=distance_meters,
                    walk_eta_minutes=walk_eta,
                    drive_eta_minutes=drive_eta,
                )
            )
        return nearby


decision_engine = DecisionEngine()
