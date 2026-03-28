from __future__ import annotations

import asyncio
from datetime import datetime
from math import asin, cos, radians, sin, sqrt
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, status

from app.models.schemas import (
    NearbyMatchItem,
    RecommendationItem,
    RecommendationResponse,
    SmartFeedbackRequest,
    SmartFeedbackResponse,
    SmartSuggestionsQuery,
)
from app.services.calendar_service import calendar_service
from app.services.context_service import context_service
from app.services.decision_engine import decision_engine
from app.services.gmail_service import gmail_service
from app.services.tool_layer import tool_layer
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

    weather, gmail_context, calendar_context = await _load_dependencies(
        stored_context,
        query.google_session_id,
    )
    decision = await decision_engine.generate_recommendations(
        user_id=query.user_id,
        stored_context=stored_context,
        requested_type=query.type,
        radius=query.radius,
        weather=weather,
        gmail_context=gmail_context,
        calendar_context=calendar_context,
    )
    return RecommendationResponse(
        recommendations=decision["recommendations"],
        nearby_matches=decision["nearby_matches"],
        proactive_triggers=_build_proactive_triggers(stored_context, weather, calendar_context),
    )


@router.post("/smart-feedback", response_model=SmartFeedbackResponse)
async def submit_smart_feedback(payload: SmartFeedbackRequest) -> SmartFeedbackResponse:
    stored_context = context_service.get_context(payload.user_id)
    if stored_context is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Context not found for user. Submit /context first.",
        )

    coordinates = stored_context.location.coordinates
    weather = await tool_layer.get_weather(
        lat=coordinates.lat if coordinates else None,
        lng=coordinates.lng if coordinates else None,
        city=stored_context.location.city,
    )
    await decision_engine.apply_feedback(
        user_id=payload.user_id,
        stored_context=stored_context,
        weather=weather,
        action=payload.action,
        place=payload.place,
    )
    return SmartFeedbackResponse(message="Feedback stored successfully.", learning_state_updated=True)


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


def _build_engine_recommendations(context, places, weather: dict, calendar_context: dict | None, gmail_context: dict | None, radius: int) -> list[RecommendationItem]:
    engine_user = _build_engine_user(context, calendar_context, gmail_context)
    engine_context = _build_engine_context(context, weather, calendar_context, engine_user)
    engine_places = _build_engine_places(context, places, engine_context)
    max_distance_km = max(1.5, radius / 1000)

    ranked = engine_recommend(engine_user, engine_places, engine_context, max_distance=max_distance_km)
    if not ranked:
        logger.info("Recommendation engine returned no ranked places, using fallback recommendations.")
        ranked_items = _build_fallback_recommendations(context, places)
        return [RecommendationItem(**item) for item in ranked_items]

    items: list[RecommendationItem] = []
    for index, candidate in enumerate(ranked[:4], start=1):
        items.append(
            RecommendationItem(
                title=str(candidate.get("name") or "Nearby recommendation"),
                reason=str(candidate.get("reason") or "Strong nearby fit for the current moment."),
                type=_engine_result_type(candidate.get("type") or candidate.get("category")),
                priority=index,
                google_rating=candidate.get("google_rating"),
                place_address=candidate.get("place_address") or None,
            )
        )
    return items


def _build_engine_user(context, calendar_context: dict | None, gmail_context: dict | None) -> dict:
    onboarding_profile = getattr(context, "onboarding_profile", {}) or {}
    preferences = getattr(context, "preferences", {}) or {}
    vibe = str(preferences.get("vibe") or "").strip().lower()
    budget = _budget_bucket(preferences.get("budget"))
    cuisine = str(onboarding_profile.get("cuisine_preference") or "").strip().lower()
    activity = str(onboarding_profile.get("free_time_preference") or "").strip().lower()
    intent = _derive_intent_from_profile(onboarding_profile, getattr(context, "trip_details", None))
    synced_sources = {
        "gmail": bool((gmail_context or {}).get("recent_messages")),
        "calendar": bool((calendar_context or {}).get("upcoming_events")),
    }

    user = {
        "preferences": _seed_category_preferences(activity, cuisine, intent),
        "diet_pref": "veg" if cuisine in {"veg", "vegetarian", "south indian"} else "any",
        "sub_pref": {value: 0.7 for value in {cuisine.replace(" ", "_"), activity.replace(" ", "_")} if value},
        "price_pref": budget,
        "amb_pref": _seed_ambience_preferences(vibe, activity),
        "negative_preferences": {},
        "weights": {},
        "history": [],
        "recent_history": [],
        "context_history": [],
        "time_preferences": {},
        "intent_history": [{"intent": intent, "category": intent, "action": "session_start"}] if intent else [],
        "current_session": {
            "last_intent": intent,
            "last_time": _time_bucket(context.time),
            "last_action": "sync" if any(synced_sources.values()) else "view",
        },
        "sources": synced_sources,
    }
    return user


def _build_engine_context(context, weather: dict, calendar_context: dict | None, engine_user: dict) -> dict:
    current_time = context.time or datetime.now(ZoneInfo("Asia/Kolkata"))
    return {
        "time_of_day": _time_bucket(current_time),
        "weather": weather.get("condition"),
        "temperature": weather.get("temperature"),
        "free_time_minutes": _next_event_gap_minutes(calendar_context, current_time) or 90,
        "intent": engine_user.get("current_session", {}).get("last_intent") or "explore",
        "diet_pref": engine_user.get("diet_pref", "any"),
    }


def _build_engine_places(context, places, engine_context: dict) -> list[dict]:
    coordinates = context.location.coordinates
    onboarding_profile = getattr(context, "onboarding_profile", {}) or {}
    cuisine = str(onboarding_profile.get("cuisine_preference") or "").strip().lower()
    activity = str(onboarding_profile.get("free_time_preference") or "").strip().lower()

    enriched_places: list[dict] = []
    for place in places:
        category = _engine_category(place.types, place.name)
        subcategory = _engine_subcategory(place.types, place.name)
        distance_km = None
        if coordinates and place.lat is not None and place.lng is not None:
            distance_km = round(_haversine_meters(coordinates.lat, coordinates.lng, place.lat, place.lng) / 1000, 2)

        enriched_places.append(
            {
                "place_id": f"{place.name}:{place.address}",
                "name": place.name,
                "category": category,
                "subcategory": subcategory,
                "distance": distance_km,
                "rating": place.rating,
                "open": place.open_now,
                "diet": _infer_diet(place.name, place.types, cuisine),
                "ambience": _infer_ambience(place.types, place.name, activity),
                "price": _infer_price_bucket(place.rating, category),
                "type": _fallback_type(place.types),
                "place_address": place.address,
                "weather": engine_context.get("weather"),
            }
        )
    return enriched_places


def _seed_category_preferences(activity: str, cuisine: str, intent: str) -> dict[str, float]:
    preferences: dict[str, float] = {}

    def boost(key: str, value: float) -> None:
        if key:
            preferences[key] = max(preferences.get(key, 0.0), value)

    if activity == "coffee":
        boost("cafe", 0.85)
        boost("bakery", 0.55)
    elif activity == "work spot":
        boost("cafe", 0.7)
        boost("coworking", 0.85)
    elif activity == "food":
        boost("restaurant", 0.9)
        boost("food", 0.75)
    elif activity == "sightseeing":
        boost("museum", 0.65)
        boost("park", 0.6)
        boost("attraction", 0.8)

    if cuisine in {"cafe", "coffee"}:
        boost("cafe", 0.9)
    elif cuisine in {"quick bites", "street food"}:
        boost("restaurant", 0.75)
        boost("food", 0.85)
    elif cuisine in {"veg", "vegetarian", "south indian", "italian", "chinese"}:
        boost("restaurant", 0.85)

    if intent in {"explore", "food", "coffee", "quick_meal"}:
        boost(intent.replace("quick_meal", "restaurant"), 0.7 if intent == "quick_meal" else 0.6)
    return preferences


def _seed_ambience_preferences(vibe: str, activity: str) -> dict[str, float]:
    ambience: dict[str, float] = {}
    if vibe == "calm":
        ambience["calm"] = 0.85
        ambience["quiet"] = 0.75
    elif vibe == "social":
        ambience["social"] = 0.85
        ambience["lively"] = 0.7
    elif vibe == "productive":
        ambience["productive"] = 0.9
        ambience["quiet"] = 0.7

    if activity == "work spot":
        ambience["productive"] = max(ambience.get("productive", 0.0), 0.9)
    elif activity == "sightseeing":
        ambience["outdoor"] = max(ambience.get("outdoor", 0.0), 0.75)
    return ambience


def _derive_intent_from_profile(onboarding_profile: dict, trip_details) -> str:
    activity = str(onboarding_profile.get("free_time_preference") or "").strip().lower()
    trip_purpose = ((trip_details.purpose if trip_details else None) or "").strip().lower()
    if activity == "coffee":
        return "coffee"
    if activity == "work spot" or trip_purpose == "business":
        return "work"
    if activity == "food":
        return "food"
    if activity == "sightseeing":
        return "explore"
    return "quick_meal" if trip_purpose == "business" else "explore"


def _budget_bucket(value) -> dict[str, float]:
    normalized = str(value or "").strip().lower()
    if normalized == "low":
        return {"cheap": 0.9, "moderate": 0.3, "expensive": 0.05}
    if normalized == "high":
        return {"cheap": 0.2, "moderate": 0.5, "expensive": 0.9}
    return {"cheap": 0.35, "moderate": 0.85, "expensive": 0.35}


def _time_bucket(current_time: datetime | None) -> str:
    value = current_time or datetime.now(ZoneInfo("Asia/Kolkata"))
    hour = value.hour
    if 5 <= hour < 12:
        return "morning"
    if 12 <= hour < 17:
        return "afternoon"
    if 17 <= hour < 22:
        return "evening"
    return "late_night"


def _engine_category(types: list[str], name: str) -> str:
    normalized = {item.lower() for item in types}
    lowered_name = name.lower()
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
    if "bakery" in normalized:
        return "bakery"
    if "meal_takeaway" in normalized:
        return "quick_bites"
    lowered_name = name.lower()
    for token in ("south indian", "italian", "chinese", "vegetarian", "veg", "street food", "coffee"):
        if token in lowered_name:
            return token.replace(" ", "_")
    return next(iter(normalized), "")


def _infer_diet(name: str, types: list[str], cuisine: str) -> str:
    lowered_name = name.lower()
    normalized_types = {item.lower() for item in types}
    if cuisine in {"veg", "vegetarian", "south indian"} or any(token in lowered_name for token in {"veg", "vegetarian", "tiffin"}):
        return "veg"
    if "vegetarian_restaurant" in normalized_types:
        return "veg"
    return "any"


def _infer_ambience(types: list[str], name: str, activity: str) -> list[str]:
    normalized = {item.lower() for item in types}
    lowered_name = name.lower()
    ambience: list[str] = []
    if activity == "work spot":
        ambience.extend(["productive", "quiet"])
    elif activity == "coffee":
        ambience.extend(["calm", "social"])
    elif activity == "sightseeing":
        ambience.extend(["outdoor", "explore"])
    else:
        ambience.append("calm")

    if {"park", "tourist_attraction", "attraction"} & normalized:
        ambience.append("outdoor")
    if any(token in lowered_name for token in {"lounge", "rooftop"}):
        ambience.append("social")
    return list(dict.fromkeys(ambience))


def _infer_price_bucket(rating: float | None, category: str) -> str:
    if category == "shopping_mall":
        return "expensive"
    if rating and rating >= 4.4:
        return "moderate"
    return "cheap"


def _engine_result_type(value: str):
    normalized = str(value or "").strip().lower()
    if normalized == "cafe":
        return "cafe"
    if normalized in {"activity", "park", "museum", "attraction", "shopping_mall"}:
        return "activity"
    return "restaurant"


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
