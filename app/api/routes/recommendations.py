from __future__ import annotations

from fastapi import APIRouter

from app.models.schemas import RecommendationRequest, RecommendationResponse
from app.services.gemini_service import gemini_service


router = APIRouter()


@router.post("/recommendations", response_model=RecommendationResponse)
async def generate_recommendations(payload: RecommendationRequest) -> RecommendationResponse:
    return await gemini_service.generate_recommendations(payload)
