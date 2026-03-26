from __future__ import annotations

from fastapi import APIRouter, HTTPException, status

from app.models.schemas import ContextRequest, ContextResponse
from app.services.context_service import context_service


router = APIRouter()


@router.post("", response_model=ContextResponse, status_code=status.HTTP_201_CREATED)
async def store_context(payload: ContextRequest) -> ContextResponse:
    stored = context_service.save_context(payload)
    return ContextResponse(message="Context stored successfully.", context=stored)


@router.get("/{user_id}", response_model=ContextRequest)
async def get_context(user_id: str) -> ContextRequest:
    stored = context_service.get_context(user_id)
    if stored is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Context not found for user.")
    return stored
