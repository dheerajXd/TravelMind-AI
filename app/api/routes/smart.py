from __future__ import annotations

import asyncio
from datetime import datetime
from math import asin, cos, radians, sin, sqrt
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, status

from app.models.schemas import (
    NearbyMatchItem,
    PlacesSearchQuery,
    RecommendationRequest,
    RecommendationResponse,
    SmartSuggestionsQuery,
    WeatherQuery,
)
from app.services.calendar_service import calendar_service
from app.services.context_service import context_service
from app.services.gmail_service import gmail_service
from app.services.gemini_service import gemini_service
from app.services.places_service import places_service
from app.services.weather_service import weather_service
from app.utils.helpers import logger


router = APIRouter()


@router.get("/smart-suggestions", response_model=RecommendationResponse)
async def get_smart_suggestions(query: SmartSuggestionsQuery = Depends()) -> RecommendationResponse:
    stored_context = context_service.get_context(query.user_id)
    if stored_context is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Context not found for user. Submit /context first.",
        )

    user_context = stored_context
    weather_query = _build_weather_query(user_context)
    place_queries = _build_places_queries(user_context, query.type, query.radius)

    weather, places, gmail_context, calendar_context = await _load_dependencies(
        weather_query,
        place_queries,
        query.google_session_id,
    )
    recommendation_request = RecommendationRequest(
        user_context=user_context.model_dump(mode="json"),
        weather=weather.model_dump(mode="json"),
        places=[place.model_dump(mode="json") for place in places],
        gmail_context=gmail_context,
        calendar_context=calendar_context,
    )
    try:
        recommendations = await gemini_service.generate_recommendations(recommendation_request)
    except HTTPException as exc:
        logger.warning("Falling back to non-AI recommendations for /smart-suggestions: %s", exc.detail)
        recommendations = RecommendationResponse(recommendations=_build_fallback_recommendations(user_context, places))

    if not recommendations.recommendations:
        recommendations = RecommendationResponse(
            recommendations=_build_fallback_recommendations(user_context, places)
        )
    nearby_matches = _build_nearby_matches(user_context, places)
    return RecommendationResponse(
        recommendations=recommendations.recommendations,
        nearby_matches=nearby_matches,
        proactive_triggers=_build_proactive_triggers(user_context, weather.model_dump(mode="json"), calendar_context),
    )


async def _load_dependencies(
    weather_query: WeatherQuery,
    places_queries: list[PlacesSearchQuery],
    google_session_id: str | None,
):
    tasks = [
        weather_service.get_weather(weather_query),
        *[places_service.search_places(place_query) for place_query in places_queries],
    ]
    if google_session_id:
        tasks.extend(
            [
                gmail_service.list_messages(
                    session_id=google_session_id,
                    max_results=5,
                    query="newer_than:14d category:primary",
                ),
                calendar_service.list_upcoming_events(
                    session_id=google_session_id,
                    max_results=5,
                ),
            ]
        )

    results = await asyncio.gather(*tasks)
    weather = results[0]
    place_results = results[1 : 1 + len(places_queries)]
    places = _merge_places(place_results)

    gmail_context = None
    calendar_context = None
    if google_session_id:
        gmail_result = results[1 + len(places_queries)]
        calendar_result = results[2 + len(places_queries)]
        gmail_context = {
            "recent_messages": [message.model_dump(mode="json") for message in gmail_result.messages],
            "result_size_estimate": gmail_result.result_size_estimate,
        }
        calendar_context = {
            "upcoming_events": [event.model_dump(mode="json", by_alias=True) for event in calendar_result.events],
        }
    return weather, places, gmail_context, calendar_context


def _build_weather_query(context) -> WeatherQuery:
    coordinates = context.location.coordinates
    if coordinates:
        return WeatherQuery(lat=coordinates.lat, lng=coordinates.lng)
    return WeatherQuery(location=context.location.city)


def _build_places_queries(context, place_type: str, radius: int) -> list[PlacesSearchQuery]:
    place_types = _determine_place_types(context, place_type)
    coordinates = context.location.coordinates
    queries = []
    for current_type in place_types:
        if coordinates:
            queries.append(
                PlacesSearchQuery(lat=coordinates.lat, lng=coordinates.lng, type=current_type, radius=radius)
            )
        else:
            queries.append(PlacesSearchQuery(location=context.location.city, type=current_type, radius=radius))
    return queries


def _determine_place_types(context, requested_type: str) -> list[str]:
    purpose = ((context.trip_details.purpose if context.trip_details else None) or "").lower()
    onboarding_profile = getattr(context, "onboarding_profile", {}) or {}
    activity_preference = str(onboarding_profile.get("free_time_preference", "")).lower()
    cuisine_preference = str(onboarding_profile.get("cuisine_preference", "")).lower()

    preferred = [requested_type]
    if purpose == "business":
        preferred.extend(["coworking", "cafe", "restaurant", "meeting lounge"])
    else:
        preferred.extend(["restaurant", "cafe", "attraction", "park"])

    if activity_preference == "food":
        preferred.extend(["restaurant", "quick bites", cuisine_preference or "local food"])
    elif activity_preference == "coffee":
        preferred.extend(["cafe", "coffee shop", "bakery"])
    elif activity_preference == "work spot":
        preferred.extend(["coworking", "business lounge", "cafe"])
    elif activity_preference == "sightseeing":
        preferred.extend(["attraction", "park", "museum"])

    if cuisine_preference and cuisine_preference not in {"local", "cafe"}:
        preferred.append(cuisine_preference)

    deduped = []
    for item in preferred:
        normalized = item.strip().lower()
        if normalized and normalized not in deduped:
            deduped.append(normalized)
    return deduped[:5]


def _merge_places(place_results) -> list:
    merged = []
    seen = set()
    lodging_name_keywords = {
        "hotel",
        "rooms",
        "room",
        "residency",
        "residencies",
        "inn",
        "lodge",
        "suites",
        "suite",
        "stay",
    }
    venue_positive_keywords = {
        "cafe",
        "coffee",
        "restaurant",
        "kitchen",
        "bakery",
        "bistro",
        "diner",
        "tiffin",
        "eatery",
        "lounge",
        "cowork",
        "workspace",
    }
    for places in place_results:
        for place in places:
            key = (place.name, place.address)
            if key in seen:
                continue
            types = {item.lower() for item in place.types}
            if "lodging" in types and "restaurant" not in types and "cafe" not in types:
                continue
            normalized_name = place.name.lower()
            if any(keyword in normalized_name for keyword in lodging_name_keywords) and not (
                {"cafe", "restaurant", "meal_takeaway", "bakery"} & types
                or any(keyword in normalized_name for keyword in venue_positive_keywords)
            ):
                continue
            seen.add(key)
            merged.append(place)
    open_now_first = sorted(
        merged,
        key=lambda place: (
            place.open_now is not True,
            -(place.rating or 0),
        ),
    )
    return _diversify_places(open_now_first)


def _build_nearby_matches(context, places) -> list[NearbyMatchItem]:
    coordinates = context.location.coordinates
    filtered_places = _filter_close_fit_places(context, places)
    source_places = filtered_places or places
    matches: list[NearbyMatchItem] = []
    for place in source_places[:6]:
        distance_meters = None
        walk_eta = None
        drive_eta = None
        if coordinates and place.lat is not None and place.lng is not None:
            distance_meters = int(_haversine_meters(coordinates.lat, coordinates.lng, place.lat, place.lng))
            walk_eta = max(1, round(distance_meters / 80)) if distance_meters else None
            drive_eta = max(1, round(distance_meters / 350)) if distance_meters else None

        matches.append(
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
    return matches


def _build_fallback_recommendations(context, places):
    filtered_places = _filter_close_fit_places(context, places)
    source_places = filtered_places or places[:4]
    recommendations = []
    for index, place in enumerate(source_places[:4], start=1):
        recommendations.append(
            {
                "title": place.name,
                "reason": _fallback_reason(context, place),
                "type": _fallback_type(place.types),
                "priority": index,
                "google_rating": place.rating,
                "place_address": place.address,
            }
        )
    return recommendations


def _filter_close_fit_places(context, places):
    onboarding_profile = getattr(context, "onboarding_profile", {}) or {}
    activity_preference = str(onboarding_profile.get("free_time_preference", "")).lower()
    cuisine_preference = str(onboarding_profile.get("cuisine_preference", "")).lower()
    scored = []
    for place in places:
        score = _place_fit_score(place, activity_preference, cuisine_preference)
        if score > 0:
            scored.append((score, place))
    scored.sort(key=lambda item: (-item[0], -(item[1].rating or 0), item[1].open_now is not True))
    return [place for _, place in scored]


def _place_fit_score(place, activity_preference: str, cuisine_preference: str) -> int:
    types = {item.lower() for item in place.types}
    name = place.name.lower()
    score = 0

    if activity_preference == "coffee":
        if {"cafe", "bakery"} & types or any(term in name for term in {"cafe", "coffee"}):
            score += 5
    elif activity_preference == "work spot":
        if {"cafe", "bakery", "restaurant"} & types or any(term in name for term in {"cafe", "coffee", "lounge"}):
            score += 4
    elif activity_preference == "food":
        if {"restaurant", "meal_takeaway", "meal_delivery", "cafe"} & types:
            score += 4
    elif activity_preference == "sightseeing":
        if {"park", "museum", "tourist_attraction", "attraction"} & types:
            score += 5

    if cuisine_preference == "cafe" and ({"cafe", "bakery"} & types or any(term in name for term in {"cafe", "coffee"})):
        score += 4
    elif cuisine_preference == "quick bites" and {"meal_takeaway", "restaurant", "cafe"} & types:
        score += 3
    elif cuisine_preference == "veg" and any(term in name for term in {"veg", "vegetarian", "tiffin"}):
        score += 3
    elif cuisine_preference == "local" and any(term in name for term in {"mess", "tiffin", "bhavan", "cafe", "diner"}):
        score += 2

    if place.open_now is True:
        score += 2
    if place.rating and place.rating >= 4.2:
        score += 1

    return score


def _fallback_reason(context, place) -> str:
    onboarding_profile = getattr(context, "onboarding_profile", {}) or {}
    activity_preference = str(onboarding_profile.get("free_time_preference", "")).lower()
    cuisine_preference = str(onboarding_profile.get("cuisine_preference", "")).lower()
    fit_bits = []
    if place.open_now is True:
        fit_bits.append("hours look favorable right now")
    if cuisine_preference == "cafe" and any(term in place.name.lower() for term in {"cafe", "coffee"}):
        fit_bits.append("it is close to your cafe preference")
    elif cuisine_preference == "veg" and any(term in place.name.lower() for term in {"veg", "vegetarian", "tiffin"}):
        fit_bits.append("it looks closer to your veg preference")
    elif cuisine_preference == "quick bites":
        fit_bits.append("it suits a quick bite")

    if activity_preference == "coffee":
        fit_bits.append("it fits a coffee break well")
    elif activity_preference == "work spot":
        fit_bits.append("it is a reasonable nearby work-friendly stop")
    elif activity_preference == "sightseeing":
        fit_bits.append("it fits a short explore break")
    else:
        fit_bits.append("it is one of the closer nearby fits available")

    if place.rating:
        fit_bits.append(f"Google rating is {place.rating:.1f}")

    return "Closest fit available: " + ", ".join(fit_bits) + "."


def _fallback_type(types: list[str]) -> str:
    normalized = {item.lower() for item in types}
    if {"cafe", "bakery"} & normalized:
        return "cafe"
    if {"park", "museum", "tourist_attraction", "attraction"} & normalized:
        return "activity"
    return "restaurant"


def _build_proactive_triggers(context, weather: dict, calendar_context: dict | None) -> list[str]:
    triggers: list[str] = []
    current_time = context.time or datetime.now(ZoneInfo("Asia/Kolkata"))
    hour = current_time.hour
    if 7 <= hour < 11:
        triggers.append("Morning window detected: good time for coffee or a quick breakfast stop.")
    elif 12 <= hour < 15:
        triggers.append("Lunch window detected: nearby food picks are especially relevant right now.")
    elif 18 <= hour < 22:
        triggers.append("Evening free time detected: good moment for dinner, coffee, or a short outing nearby.")
    elif hour >= 22 or hour < 6:
        triggers.append("Late-hour context detected: open-now places should be prioritized before longer outings.")

    condition = str(weather.get("condition", "")).lower()
    temperature = weather.get("temperature")
    if condition in {"clear", "mostly clear"} and isinstance(temperature, (int, float)) and 20 <= temperature <= 30:
        triggers.append("Weather looks comfortable for a short walk or nearby stop.")

    next_event_minutes = _next_event_gap_minutes(calendar_context, current_time)
    if next_event_minutes is None:
        triggers.append("No near-term calendar block found, so broader nearby options can be suggested.")
    elif next_event_minutes >= 45:
        triggers.append(f"You appear to have about {next_event_minutes} free minutes before the next calendar event.")
    elif next_event_minutes <= 20:
        triggers.append("Your next calendar event is close, so quick nearby options matter more than long detours.")

    return triggers[:3]


def _next_event_gap_minutes(calendar_context: dict | None, current_time: datetime) -> int | None:
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
            parsed = datetime.fromisoformat(start_value.replace("Z", "+00:00"))
        except ValueError:
            continue
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=current_time.tzinfo)
        delta_minutes = int((parsed - current_time).total_seconds() // 60)
        if delta_minutes > 0:
            candidate_minutes.append(delta_minutes)
    return min(candidate_minutes) if candidate_minutes else None


def _friendly_category(types: list[str]) -> str:
    normalized = {item.lower() for item in types}
    if {"cafe", "bakery"} & normalized:
        return "Cafe"
    if {"restaurant", "meal_takeaway", "meal_delivery"} & normalized:
        return "Food"
    if {"park", "museum", "tourist_attraction", "attraction"} & normalized:
        return "Explore"
    if {"coworking", "library"} & normalized:
        return "Work"
    return "Nearby"


def _haversine_meters(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    earth_radius_m = 6371000
    d_lat = radians(lat2 - lat1)
    d_lng = radians(lng2 - lng1)
    lat1_r = radians(lat1)
    lat2_r = radians(lat2)
    a = sin(d_lat / 2) ** 2 + cos(lat1_r) * cos(lat2_r) * sin(d_lng / 2) ** 2
    return 2 * earth_radius_m * asin(sqrt(a))


def _diversify_places(places) -> list:
    bucket_limits = {
        "work": 2,
        "cafe": 2,
        "food": 3,
        "activity": 2,
        "other": 2,
    }
    counts = {key: 0 for key in bucket_limits}
    diversified = []
    for place in places:
        bucket = _place_bucket(place)
        if counts[bucket] >= bucket_limits[bucket]:
            continue
        diversified.append(place)
        counts[bucket] += 1
        if len(diversified) >= 12:
            break
    return diversified


def _place_bucket(place) -> str:
    types = {item.lower() for item in place.types}
    name = place.name.lower()
    if {"coworking", "library"} & types or any(term in name for term in {"cowork", "workspace", "business lounge"}):
        return "work"
    if {"cafe", "bakery"} & types or any(term in name for term in {"cafe", "coffee", "bakery"}):
        return "cafe"
    if {"restaurant", "meal_takeaway", "meal_delivery"} & types:
        return "food"
    if {"park", "museum", "tourist_attraction", "attraction"} & types:
        return "activity"
    return "other"
