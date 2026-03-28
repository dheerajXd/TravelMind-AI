from __future__ import annotations

from fastapi import APIRouter, Depends

from app.models.schemas import WeatherQuery, WeatherResponse
from app.services.weather_service import weather_service


router = APIRouter()


@router.get("/weather", response_model=WeatherResponse)
async def get_weather(query: WeatherQuery = Depends()) -> WeatherResponse:
    return await weather_service.get_weather(query)
