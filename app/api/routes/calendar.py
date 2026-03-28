from __future__ import annotations

from fastapi import APIRouter, Query

from app.models.schemas import CalendarEventsResponse
from app.services.calendar_service import calendar_service


router = APIRouter(prefix="/calendar")


@router.get("/events", response_model=CalendarEventsResponse)
async def list_calendar_events(
    session_id: str = Query(..., min_length=10),
    max_results: int = Query(default=10, ge=1, le=25),
    calendar_id: str = Query(default="primary", min_length=1),
) -> CalendarEventsResponse:
    return await calendar_service.list_upcoming_events(
        session_id=session_id,
        max_results=max_results,
        calendar_id=calendar_id,
    )
