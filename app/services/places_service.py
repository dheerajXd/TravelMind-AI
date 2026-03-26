from __future__ import annotations

from typing import Any

import httpx
from fastapi import HTTPException, status

from app.core.config import get_settings
from app.models.schemas import PlaceItem, PlacesSearchQuery
from app.utils.helpers import (
    TTLCache,
    build_location_string,
    make_cache_key,
    raise_upstream_error,
)


settings = get_settings()
places_cache = TTLCache(ttl_seconds=settings.cache_ttl_seconds)


class PlacesService:
    def __init__(self) -> None:
        self.api_key = settings.google_places_api_key
        self.base_url = settings.google_places_base_url
        self.timeout = settings.request_timeout_seconds

    async def search_places(self, query: PlacesSearchQuery) -> list[PlaceItem]:
        if not self.api_key:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Google Places API key is not configured.",
            )

        cache_key = make_cache_key(
            "places",
            location=query.location,
            lat=query.lat,
            lng=query.lng,
            type=query.type,
            radius=query.radius,
        )
        cached = places_cache.get(cache_key)
        if cached is not None:
            return cached

        endpoint, params = self._build_request(query)
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.get(endpoint, params=params)
                response.raise_for_status()
        except httpx.TimeoutException as exc:
            raise_upstream_error("Google Places", "request timed out.", status.HTTP_504_GATEWAY_TIMEOUT)
            raise exc
        except httpx.HTTPStatusError as exc:
            raise_upstream_error("Google Places", f"HTTP {exc.response.status_code}")
            raise exc
        except httpx.HTTPError as exc:
            raise_upstream_error("Google Places", "network error while fetching places.")
            raise exc

        payload = response.json()
        api_status = payload.get("status")
        if api_status not in {"OK", "ZERO_RESULTS"}:
            raise_upstream_error("Google Places", payload.get("error_message") or api_status or "unknown error")

        results = [self._serialize_place(item) for item in payload.get("results", [])]
        places_cache.set(cache_key, results)
        return results

    def _build_request(self, query: PlacesSearchQuery) -> tuple[str, dict[str, Any]]:
        coordinates = build_location_string(query.lat, query.lng)
        if coordinates:
            return (
                f"{self.base_url}/nearbysearch/json",
                {
                    "location": coordinates,
                    "radius": query.radius,
                    "keyword": query.type,
                    "key": self.api_key,
                },
            )
        return (
            f"{self.base_url}/textsearch/json",
            {
                "query": f"{query.type} in {query.location}",
                "key": self.api_key,
            },
        )

    def _serialize_place(self, place: dict[str, Any]) -> PlaceItem:
        photo_reference = None
        photos = place.get("photos") or []
        if photos:
            photo_reference = photos[0].get("photo_reference")

        return PlaceItem(
            name=place.get("name", "Unknown"),
            rating=place.get("rating"),
            address=place.get("vicinity") or place.get("formatted_address") or "Address unavailable",
            open_now=(place.get("opening_hours") or {}).get("open_now"),
            types=place.get("types", []),
            photo_url=f"/places/photo?photo_reference={photo_reference}" if photo_reference else None,
            lat=((place.get("geometry") or {}).get("location") or {}).get("lat"),
            lng=((place.get("geometry") or {}).get("location") or {}).get("lng"),
        )

    async def get_photo_bytes(self, photo_reference: str, max_width: int = 400) -> tuple[bytes, str]:
        if not self.api_key:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Google Places API key is not configured.",
            )

        try:
            async with httpx.AsyncClient(timeout=self.timeout, follow_redirects=True) as client:
                response = await client.get(
                    "https://maps.googleapis.com/maps/api/place/photo",
                    params={
                        "maxwidth": max_width,
                        "photo_reference": photo_reference,
                        "key": self.api_key,
                    },
                )
                response.raise_for_status()
        except httpx.TimeoutException as exc:
            raise_upstream_error("Google Places", "photo request timed out.", status.HTTP_504_GATEWAY_TIMEOUT)
            raise exc
        except httpx.HTTPStatusError as exc:
            raise_upstream_error("Google Places", f"photo HTTP {exc.response.status_code}")
            raise exc
        except httpx.HTTPError as exc:
            raise_upstream_error("Google Places", "network error while fetching photo.")
            raise exc

        return response.content, response.headers.get("content-type", "image/jpeg")


places_service = PlacesService()
