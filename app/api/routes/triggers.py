from __future__ import annotations

from fastapi import APIRouter

from app.models.schemas import LocationUpdateRequest, TriggerManualRequest, TriggerResponse
from app.services.notification_service import notification_service


router = APIRouter(prefix="/trigger")


@router.post("/location-update", response_model=TriggerResponse)
async def trigger_location_update(payload: LocationUpdateRequest) -> TriggerResponse:
    result = await notification_service.trigger_location_update(payload.user_id, payload.lat, payload.lng)
    return TriggerResponse(**result)


@router.post("/manual", response_model=TriggerResponse)
async def trigger_manual(payload: TriggerManualRequest) -> TriggerResponse:
    result = await notification_service.trigger_manual(payload.user_id)
    return TriggerResponse(**result)
