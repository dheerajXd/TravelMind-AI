from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from fastapi.responses import Response

from app.models.schemas import PlacesResponse, PlacesSearchQuery
from app.services.places_service import places_service


router = APIRouter()


@router.get("/search", response_model=PlacesResponse)
async def search_places(query: PlacesSearchQuery = Depends()) -> PlacesResponse:
    places = await places_service.search_places(query)
    return PlacesResponse(places=places)


@router.get("/photo")
async def get_place_photo(
    photo_reference: str = Query(..., min_length=8),
    max_width: int = Query(default=400, ge=100, le=1600),
) -> Response:
    content, content_type = await places_service.get_photo_bytes(photo_reference, max_width=max_width)
    return Response(content=content, media_type=content_type)
