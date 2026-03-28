from __future__ import annotations

import httpx
from fastapi import HTTPException, status

from app.core.config import get_settings
from app.models.schemas import WeatherQuery, WeatherResponse
from app.utils.helpers import TTLCache, make_cache_key, raise_upstream_error


settings = get_settings()
weather_cache = TTLCache(ttl_seconds=settings.cache_ttl_seconds)


class WeatherService:
    def __init__(self) -> None:
        self.base_url = settings.openweather_base_url
        self.geocoding_base_url = settings.openmeteo_geocoding_base_url
        self.timeout = settings.request_timeout_seconds

    async def get_weather(self, query: WeatherQuery) -> WeatherResponse:
        cache_key = make_cache_key("weather", location=query.location, lat=query.lat, lng=query.lng)
        cached = weather_cache.get(cache_key)
        if cached is not None:
            return cached

        latitude = query.lat
        longitude = query.lng
        city = query.location

        if query.location and (query.lat is None or query.lng is None):
            latitude, longitude, city = await self._geocode_location(query.location)

        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.get(
                    f"{self.base_url}/forecast",
                    params={
                        "latitude": latitude,
                        "longitude": longitude,
                        "current": "temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code",
                        "timezone": "auto",
                    },
                )
                response.raise_for_status()
        except httpx.TimeoutException as exc:
            raise_upstream_error("Open-Meteo", "request timed out.", status.HTTP_504_GATEWAY_TIMEOUT)
            raise exc
        except httpx.HTTPStatusError as exc:
            detail = "location not found." if exc.response.status_code == 404 else f"HTTP {exc.response.status_code}"
            raise_upstream_error("Open-Meteo", detail, exc.response.status_code)
            raise exc
        except httpx.HTTPError as exc:
            raise_upstream_error("Open-Meteo", "network error while fetching weather.")
            raise exc

        data = response.json()
        current = data["current"]
        result = WeatherResponse(
            temperature=round(current["temperature_2m"], 1),
            condition=self._map_weather_code(current["weather_code"]),
            humidity=current["relative_humidity_2m"],
            wind_speed=round(current["wind_speed_10m"], 1),
            city=city,
        )
        weather_cache.set(cache_key, result)
        return result

    async def _geocode_location(self, location: str) -> tuple[float, float, str]:
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.get(
                    f"{self.geocoding_base_url}/search",
                    params={"name": location, "count": 1, "language": "en", "format": "json"},
                )
                response.raise_for_status()
        except httpx.TimeoutException as exc:
            raise_upstream_error("Open-Meteo", "geocoding request timed out.", status.HTTP_504_GATEWAY_TIMEOUT)
            raise exc
        except httpx.HTTPStatusError as exc:
            raise_upstream_error("Open-Meteo", f"geocoding HTTP {exc.response.status_code}", exc.response.status_code)
            raise exc
        except httpx.HTTPError as exc:
            raise_upstream_error("Open-Meteo", "network error while geocoding location.")
            raise exc

        results = response.json().get("results") or []
        if not results:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Open-Meteo error: location not found.")

        first = results[0]
        return first["latitude"], first["longitude"], first["name"]

    def _map_weather_code(self, code: int) -> str:
        weather_codes = {
            0: "Clear",
            1: "Mostly Clear",
            2: "Partly Cloudy",
            3: "Cloudy",
            45: "Fog",
            48: "Rime Fog",
            51: "Light Drizzle",
            53: "Drizzle",
            55: "Heavy Drizzle",
            61: "Light Rain",
            63: "Rain",
            65: "Heavy Rain",
            71: "Light Snow",
            73: "Snow",
            75: "Heavy Snow",
            80: "Rain Showers",
            81: "Rain Showers",
            82: "Heavy Showers",
            95: "Thunderstorm",
            96: "Thunderstorm",
            99: "Thunderstorm",
        }
        return weather_codes.get(code, "Unknown")


weather_service = WeatherService()
