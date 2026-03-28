from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query, status

from app.models.schemas import (
    DeviceTokenRequest,
    NotificationItemResponse,
    NotificationListResponse,
    UserNotificationSettingsResponse,
    UserNotificationSettingsUpdate,
)
from app.services.notification_service import notification_service
from app.services.user_data_service import user_data_service
from app.utils.helpers import logger


router = APIRouter(prefix="/notifications")


@router.get("/settings/{user_id}", response_model=UserNotificationSettingsResponse)
async def get_notification_settings(user_id: str) -> UserNotificationSettingsResponse:
    settings = user_data_service.get_notification_settings(user_id)
    if settings is None:
        user_data_service.ensure_user(user_id)
        user_data_service.upsert_notification_settings(user_id)
        settings = user_data_service.get_notification_settings(user_id)
    if settings is None:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Notification settings unavailable.")
    return UserNotificationSettingsResponse(
        user_id=user_id,
        notifications_enabled=bool(settings["notifications_enabled"]),
        radius_km=float(settings["radius_km"]),
        quiet_hours_start=settings["quiet_hours_start"],
        quiet_hours_end=settings["quiet_hours_end"],
        max_per_day=int(settings["max_per_day"]),
        updated_at=settings["updated_at"],
    )


@router.put("/settings/{user_id}", response_model=UserNotificationSettingsResponse)
async def update_notification_settings(user_id: str, payload: UserNotificationSettingsUpdate) -> UserNotificationSettingsResponse:
    user_data_service.ensure_user(user_id)
    user_data_service.upsert_notification_settings(
        user_id,
        notifications_enabled=payload.notifications_enabled,
        radius_km=payload.radius_km,
        quiet_hours_start=payload.quiet_hours_start,
        quiet_hours_end=payload.quiet_hours_end,
        max_per_day=payload.max_per_day,
    )
    settings = user_data_service.get_notification_settings(user_id)
    return UserNotificationSettingsResponse(
        user_id=user_id,
        notifications_enabled=bool(settings["notifications_enabled"]),
        radius_km=float(settings["radius_km"]),
        quiet_hours_start=settings["quiet_hours_start"],
        quiet_hours_end=settings["quiet_hours_end"],
        max_per_day=int(settings["max_per_day"]),
        updated_at=settings["updated_at"],
    )


@router.post("/device-token", status_code=status.HTTP_204_NO_CONTENT)
async def register_device_token(payload: DeviceTokenRequest) -> None:
    token = (payload.token or "").strip()
    if not token:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid token")

    logger.info(
        "Received device token registration for user %s (length=%s)",
        payload.user_id,
        len(token),
    )
    user_data_service.ensure_user(payload.user_id)
    user_data_service.register_device_token(payload.user_id, token)
    logger.info("Stored device token for user %s", payload.user_id)


def _build_notification_list(user_id: str) -> NotificationListResponse:
    notifications = user_data_service.list_notifications(user_id)
    return NotificationListResponse(
        notifications=[
            NotificationItemResponse(
                id=int(item["id"]),
                place_id=item["place_id"],
                type=item["type"],
                title=item["title"],
                message=item["message"],
                sent_at=item["sent_at"],
                clicked=bool(item["clicked"]),
            )
            for item in notifications
        ]
    )


@router.get("", response_model=NotificationListResponse)
async def list_notifications_query(user_id: str = Query(..., min_length=1, max_length=128)) -> NotificationListResponse:
    return _build_notification_list(user_id)


@router.get("/{user_id}", response_model=NotificationListResponse)
async def list_notifications(user_id: str) -> NotificationListResponse:
    return _build_notification_list(user_id)


@router.post("/process-queue")
async def process_notification_queue(limit: int = Query(default=20, ge=1, le=100)) -> dict[str, int]:
    return notification_service.process_pending_notifications(limit=limit)
