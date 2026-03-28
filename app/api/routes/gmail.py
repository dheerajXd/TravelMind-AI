from __future__ import annotations

from fastapi import APIRouter, Query

from app.models.schemas import GmailMessagesResponse
from app.services.gmail_service import gmail_service


router = APIRouter(prefix="/gmail")


@router.get("/messages", response_model=GmailMessagesResponse)
async def list_gmail_messages(
    session_id: str = Query(..., min_length=10),
    max_results: int = Query(default=10, ge=1, le=25),
    query: str | None = Query(default=None),
    unread_only: bool = Query(default=False),
) -> GmailMessagesResponse:
    return await gmail_service.list_messages(
        session_id=session_id,
        max_results=max_results,
        query=query,
        unread_only=unread_only,
    )
