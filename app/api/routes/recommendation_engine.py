from __future__ import annotations

from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel, Field

from app.services.recommendation_engine import recommend, update_preferences


router = APIRouter(prefix="/recommendation-engine")


class EngineRecommendRequest(BaseModel):
    user: dict[str, Any]
    places: list[dict[str, Any]]
    context: dict[str, Any]
    max_distance: float = Field(default=5000.0, ge=0)


class EnginePreferenceUpdateRequest(BaseModel):
    user: dict[str, Any]
    place: dict[str, Any]
    action: str = Field(..., min_length=1)


@router.post("/recommend")
async def recommend_with_engine(payload: EngineRecommendRequest) -> list[dict[str, Any]]:
    return recommend(
        user=payload.user,
        places=payload.places,
        context=payload.context,
        max_distance=payload.max_distance,
    )


@router.post("/update-preferences")
async def update_engine_preferences(payload: EnginePreferenceUpdateRequest) -> dict[str, Any]:
    return update_preferences(
        user=payload.user,
        place=payload.place,
        action=payload.action,
    )
