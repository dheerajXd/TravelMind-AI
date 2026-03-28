from __future__ import annotations

from typing import Any

import httpx

from app.core.config import get_settings
from app.models.schemas import PlaceItem, PlacesSearchQuery, WeatherQuery
from app.services.places_service import places_service
from app.services.user_data_service import user_data_service
from app.services.weather_service import weather_service
from app.utils.helpers import TTLCache, make_cache_key, raise_upstream_error


settings = get_settings()
tool_cache = TTLCache(ttl_seconds=settings.cache_ttl_seconds)


class ToolExecutionLayer:
    async def get_nearby_places(
        self,
        *,
        lat: float | None,
        lng: float | None,
        category: str,
        radius: int,
        city: str | None = None,
    ) -> list[PlaceItem]:
        query = PlacesSearchQuery(lat=lat, lng=lng, location=city, type=category, radius=radius)
        places = await places_service.search_places(query)
        for place in places:
            user_data_service.upsert_place(
                place.id or f"{place.name}:{place.address}",
                name=place.name,
                place_type=(place.types or ["generic"])[0] if place.types else "generic",
                latitude=place.lat,
                longitude=place.lng,
                rating=place.rating,
                open_now=place.open_now,
            )
        return places

    async def get_weather(
        self,
        *,
        lat: float | None,
        lng: float | None,
        city: str | None = None,
    ) -> dict[str, Any]:
        weather = await weather_service.get_weather(WeatherQuery(lat=lat, lng=lng, location=city))
        return weather.model_dump(mode="json")

    async def get_place_details(self, place_id: str) -> dict[str, Any]:
        cache_key = make_cache_key("place_details", place_id=place_id)
        cached = tool_cache.get(cache_key)
        if cached is not None:
            return cached

        if not settings.google_places_api_key:
            return {}

        try:
            async with httpx.AsyncClient(timeout=settings.request_timeout_seconds) as client:
                response = await client.get(
                    f"{settings.google_places_base_url}/details/json",
                    params={
                        "place_id": place_id,
                        "fields": "place_id,name,rating,formatted_address,opening_hours,price_level,types,geometry",
                        "key": settings.google_places_api_key,
                    },
                )
                response.raise_for_status()
        except httpx.TimeoutException as exc:
            raise_upstream_error("Google Places", "place details request timed out.")
            raise exc
        except httpx.HTTPStatusError as exc:
            raise_upstream_error("Google Places", f"place details HTTP {exc.response.status_code}")
            raise exc
        except httpx.HTTPError as exc:
            raise_upstream_error("Google Places", "network error while fetching place details.")
            raise exc

        payload = response.json()
        if payload.get("status") not in {"OK", "ZERO_RESULTS"}:
            raise_upstream_error("Google Places", payload.get("error_message") or payload.get("status") or "details error")

        result = payload.get("result") or {}
        tool_cache.set(cache_key, result)
        return result


tool_layer = ToolExecutionLayer()
