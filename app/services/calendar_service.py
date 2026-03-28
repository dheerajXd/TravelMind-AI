from __future__ import annotations

from datetime import UTC, datetime

import httpx

from app.core.config import get_settings
from app.models.schemas import CalendarEventItem, CalendarEventsResponse
from app.services.google_oauth_service import google_oauth_service
from app.utils.helpers import raise_upstream_error


settings = get_settings()


class CalendarService:
    def __init__(self) -> None:
        self.base_url = settings.calendar_base_url
        self.timeout = settings.request_timeout_seconds

    async def list_upcoming_events(
        self,
        session_id: str,
        max_results: int = 10,
        calendar_id: str = "primary",
    ) -> CalendarEventsResponse:
        session = await google_oauth_service.get_session(session_id)
        headers = {"Authorization": f"Bearer {session['access_token']}"}

        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.get(
                    f"{self.base_url}/calendars/{calendar_id}/events",
                    headers=headers,
                    params={
                        "maxResults": max_results,
                        "singleEvents": "true",
                        "orderBy": "startTime",
                        "timeMin": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
                    },
                )
                response.raise_for_status()
        except httpx.TimeoutException as exc:
            raise_upstream_error("Google Calendar", "event listing timed out.")
            raise exc
        except httpx.HTTPStatusError as exc:
            raise_upstream_error("Google Calendar", f"event listing HTTP {exc.response.status_code}")
            raise exc
        except httpx.HTTPError as exc:
            raise_upstream_error("Google Calendar", "network error while listing events.")
            raise exc

        events = []
        for item in response.json().get("items", []):
            events.append(
                CalendarEventItem(
                    id=item["id"],
                    status=item.get("status"),
                    summary=item.get("summary"),
                    description=item.get("description"),
                    location=item.get("location"),
                    htmlLink=item.get("htmlLink"),
                    start=item.get("start", {}),
                    end=item.get("end", {}),
                    organizer_email=(item.get("organizer") or {}).get("email"),
                )
            )
        return CalendarEventsResponse(events=events)


calendar_service = CalendarService()
