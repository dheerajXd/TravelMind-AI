from __future__ import annotations

from datetime import UTC, datetime

import httpx

from app.core.config import get_settings
from app.models.schemas import GmailMessageItem, GmailMessagesResponse
from app.services.google_oauth_service import google_oauth_service
from app.utils.helpers import raise_upstream_error


settings = get_settings()


class GmailService:
    def __init__(self) -> None:
        self.base_url = settings.gmail_base_url
        self.timeout = settings.request_timeout_seconds

    async def list_messages(
        self,
        session_id: str,
        max_results: int = 10,
        query: str | None = None,
        unread_only: bool = False,
    ) -> GmailMessagesResponse:
        session = await google_oauth_service.get_session(session_id)
        q = query or ""
        if unread_only:
            q = f"{q} is:unread".strip()

        headers = {"Authorization": f"Bearer {session['access_token']}"}
        params = {"maxResults": max_results}
        if q:
            params["q"] = q

        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                list_response = await client.get(
                    f"{self.base_url}/users/me/messages",
                    headers=headers,
                    params=params,
                )
                list_response.raise_for_status()
        except httpx.TimeoutException as exc:
            raise_upstream_error("Gmail", "message listing timed out.")
            raise exc
        except httpx.HTTPStatusError as exc:
            raise_upstream_error("Gmail", f"message listing HTTP {exc.response.status_code}")
            raise exc
        except httpx.HTTPError as exc:
            raise_upstream_error("Gmail", "network error while listing messages.")
            raise exc

        data = list_response.json()
        messages = []
        for item in data.get("messages", []):
            details = await self._get_message(item["id"], headers)
            messages.append(details)

        return GmailMessagesResponse(
            messages=messages,
            result_size_estimate=data.get("resultSizeEstimate"),
        )

    async def _get_message(self, message_id: str, headers: dict[str, str]) -> GmailMessageItem:
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.get(
                    f"{self.base_url}/users/me/messages/{message_id}",
                    headers=headers,
                    params={
                        "format": "metadata",
                        "metadataHeaders": ["Subject", "From"],
                    },
                )
                response.raise_for_status()
        except httpx.TimeoutException as exc:
            raise_upstream_error("Gmail", "message detail timed out.")
            raise exc
        except httpx.HTTPStatusError as exc:
            raise_upstream_error("Gmail", f"message detail HTTP {exc.response.status_code}")
            raise exc
        except httpx.HTTPError as exc:
            raise_upstream_error("Gmail", "network error while fetching message detail.")
            raise exc

        payload = response.json()
        headers_map = {
            header["name"].lower(): header["value"]
            for header in payload.get("payload", {}).get("headers", [])
        }
        internal_date = None
        if payload.get("internalDate"):
            internal_date = datetime.fromtimestamp(int(payload["internalDate"]) / 1000, tz=UTC)

        return GmailMessageItem(
            id=payload["id"],
            thread_id=payload["threadId"],
            subject=headers_map.get("subject"),
            from_email=headers_map.get("from"),
            snippet=payload.get("snippet"),
            internal_date=internal_date,
        )


gmail_service = GmailService()
