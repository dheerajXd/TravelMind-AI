from __future__ import annotations

from fastapi import HTTPException, status
from fastapi import APIRouter

from app.models.schemas import (
    OpenClawContextPreviewRequest,
    OpenClawContextPreviewResponse,
    OpenClawStatusResponse,
    OpenClawUserBriefRequest,
    OpenClawUserBriefResponse,
    OpenClawUserPreviewRequest,
    OpenClawUserPreviewResponse,
)
from app.services.calendar_service import calendar_service
from app.services.context_service import context_service
from app.services.gmail_service import gmail_service
from app.services.openclaw_service import (
    get_openclaw_service,
    serialize_calendar_events,
    serialize_gmail_messages,
)


router = APIRouter(prefix="/openclaw")


async def _build_user_payload(
    *,
    user_id: str,
    google_session_id: str | None,
    gmail_max_results: int,
    calendar_max_results: int,
) -> tuple[dict, dict, object]:
    service = get_openclaw_service()
    stored_context = context_service.get_context(user_id)
    if stored_context is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Context not found for user.",
        )

    schedule_items = []
    gmail_messages = []
    sources = {
        "context": True,
        "weather": False,
        "schedule": False,
        "gmail": False,
    }

    if google_session_id:
        try:
            calendar_data = await calendar_service.list_upcoming_events(
                google_session_id,
                max_results=calendar_max_results,
            )
            schedule_items = serialize_calendar_events(calendar_data.events)
            sources["schedule"] = bool(schedule_items)
        except Exception as exc:  # noqa: BLE001
            sources["schedule_error"] = str(exc)

        try:
            gmail_data = await gmail_service.list_messages(
                google_session_id,
                max_results=gmail_max_results,
            )
            gmail_messages = serialize_gmail_messages(gmail_data.messages)
            sources["gmail"] = bool(gmail_messages)
            sources["gmail_messages_count"] = len(gmail_messages)
        except Exception as exc:  # noqa: BLE001
            sources["gmail_error"] = str(exc)

    weather_payload = {}
    if stored_context.location.city:
        weather_payload["location_hint"] = stored_context.location.city
    if stored_context.time:
        weather_payload["context_time"] = stored_context.time.isoformat()

    built_payload = service.build_context_payload(
        user_id=stored_context.user_id,
        location_label=stored_context.location.city,
        preferences=stored_context.preferences,
        onboarding_profile=stored_context.onboarding_profile,
        weather=weather_payload,
        schedule=schedule_items,
        free_time_summary=service.build_free_time_summary(schedule_items),
        sources=sources,
    )
    built_payload["gmail"] = gmail_messages
    if stored_context.trip_details:
        built_payload["trip_details"] = stored_context.trip_details.model_dump(mode="json")

    return built_payload, sources, stored_context


@router.get("/status", response_model=OpenClawStatusResponse)
async def openclaw_status() -> OpenClawStatusResponse:
    service = get_openclaw_service()
    return OpenClawStatusResponse(**service.get_status())


@router.post("/context-preview", response_model=OpenClawContextPreviewResponse)
async def openclaw_context_preview(
    payload: OpenClawContextPreviewRequest,
) -> OpenClawContextPreviewResponse:
    service = get_openclaw_service()
    context_payload = service.build_context_payload(
        user_id=payload.user_id,
        location_label=payload.location_label,
        preferences=payload.preferences,
        onboarding_profile=payload.onboarding_profile,
        weather=payload.weather,
        schedule=payload.schedule,
        free_time_summary=payload.free_time_summary,
        sources=payload.sources,
    )
    return OpenClawContextPreviewResponse(
        enabled=service.enabled,
        configured=service.configured,
        payload=context_payload,
        note=(
            "Preview only. This does not trigger OpenClaw yet."
            if service.configured
            else "Preview scaffold only. Add OpenClaw configuration before enabling action calls."
        ),
    )


@router.post("/user-preview", response_model=OpenClawUserPreviewResponse)
async def openclaw_user_preview(
    payload: OpenClawUserPreviewRequest,
) -> OpenClawUserPreviewResponse:
    service = get_openclaw_service()
    built_payload, _, _ = await _build_user_payload(
        user_id=payload.user_id,
        google_session_id=payload.google_session_id,
        gmail_max_results=payload.gmail_max_results,
        calendar_max_results=payload.calendar_max_results,
    )

    return OpenClawUserPreviewResponse(
        enabled=service.enabled,
        configured=service.configured,
        payload=built_payload,
        note=service.build_assistant_brief(built_payload),
    )


@router.post("/user-brief", response_model=OpenClawUserBriefResponse)
async def openclaw_user_brief(
    payload: OpenClawUserBriefRequest,
) -> OpenClawUserBriefResponse:
    service = get_openclaw_service()
    built_payload, _, _ = await _build_user_payload(
        user_id=payload.user_id,
        google_session_id=payload.google_session_id,
        gmail_max_results=payload.gmail_max_results,
        calendar_max_results=payload.calendar_max_results,
    )
    preview_note = service.build_assistant_brief(built_payload)
    invocation = await service.invoke_brief(built_payload)
    assistant_response = invocation.get("assistant_response") or preview_note

    return OpenClawUserBriefResponse(
        enabled=service.enabled,
        configured=service.execution_configured,
        executed=bool(invocation.get("executed")),
        payload=built_payload,
        note=str(invocation.get("note") or preview_note),
        assistant_response=assistant_response,
    )
