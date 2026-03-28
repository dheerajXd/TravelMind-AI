from __future__ import annotations

from datetime import datetime
from typing import Any

import httpx

from app.core.config import get_settings


class OpenClawService:
    """Additive OpenClaw integration scaffold.

    This service does not replace any existing recommendation flow. It only
    prepares configuration-aware payloads and integration metadata so a later
    phase can invoke OpenClaw safely.
    """

    def __init__(self) -> None:
        self.settings = get_settings()

    @property
    def enabled(self) -> bool:
        return self.settings.openclaw_enabled

    @property
    def configured(self) -> bool:
        return bool(
            self.settings.openclaw_enabled
            and self.settings.openclaw_base_url
            and self.settings.openclaw_workspace_id
        )

    @property
    def execution_configured(self) -> bool:
        return bool(
            self.configured
            and (self.settings.openclaw_gateway_token or self.settings.openclaw_api_key)
            and self.settings.openclaw_agent_id
        )

    def get_status(self) -> dict[str, Any]:
        note = (
            "OpenClaw execution is configured and ready."
            if self.execution_configured
            else (
                "OpenClaw scaffold is present, but execution configuration is incomplete."
                if self.configured
                else "OpenClaw scaffold is present, but provider configuration is incomplete."
            )
        )
        return {
            "enabled": self.enabled,
            "configured": self.execution_configured,
            "base_url": self.settings.openclaw_base_url,
            "workspace_id": self.settings.openclaw_workspace_id,
            "note": note,
        }

    def build_context_payload(
        self,
        *,
        user_id: str,
        location_label: str | None = None,
        preferences: dict[str, Any] | None = None,
        onboarding_profile: dict[str, Any] | None = None,
        weather: dict[str, Any] | None = None,
        schedule: list[dict[str, Any]] | None = None,
        free_time_summary: str | None = None,
        sources: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        return {
            "user_id": user_id,
            "location": {
                "label": location_label,
            },
            "preferences": preferences or {},
            "onboarding_profile": onboarding_profile or {},
            "live_context": {
                "weather": weather or {},
                "schedule": schedule or [],
                "free_time_summary": free_time_summary,
            },
            "sources": {
                "context": True,
                "weather": bool(weather),
                "schedule": bool(schedule),
                **(sources or {}),
            },
            "openclaw": {
                "workspace_id": self.settings.openclaw_workspace_id,
                "timeout_seconds": self.settings.openclaw_timeout_seconds,
            },
        }

    async def invoke_brief(self, payload: dict[str, Any]) -> dict[str, Any]:
        if not self.execution_configured:
            return {
                "executed": False,
                "assistant_response": None,
                "provider_response": None,
                "note": "OpenClaw execution is not configured yet.",
            }

        base_url = str(self.settings.openclaw_base_url).rstrip("/")
        token = self.settings.openclaw_gateway_token or self.settings.openclaw_api_key
        prompt = (
            "You are a proactive travel assistant. Summarize the user's immediate travel "
            "situation and suggest the single most helpful next action in 2-4 concise sentences."
        )
        request_body = {
            "model": self.settings.openclaw_agent_id,
            "input": [
                {
                    "role": "system",
                    "content": prompt,
                },
                {
                    "role": "user",
                    "content": (
                        "Use this prepared context payload to produce a concise assistant brief:\n"
                        f"{payload}"
                    ),
                },
            ],
        }
        headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        }

        try:
            async with httpx.AsyncClient(timeout=self.settings.openclaw_timeout_seconds) as client:
                response = await client.post(f"{base_url}/v1/responses", headers=headers, json=request_body)
                response.raise_for_status()
        except httpx.HTTPError as exc:
            note = f"OpenClaw execution failed: {exc!s}"
            return {
                "executed": False,
                "assistant_response": None,
                "provider_response": None,
                "note": note,
            }

        provider_response = response.json()
        assistant_response = extract_response_text(provider_response)
        return {
            "executed": bool(assistant_response),
            "assistant_response": assistant_response,
            "provider_response": provider_response,
            "note": "OpenClaw assistant brief generated." if assistant_response else "OpenClaw returned no assistant text.",
        }

    def build_free_time_summary(self, schedule: list[dict[str, Any]]) -> str | None:
        if not schedule:
            return None

        for item in schedule:
            title = str(item.get("title") or "").lower()
            if "free time" in title:
                time_label = item.get("time")
                return f"Free time detected{f' during {time_label}' if time_label else ''}."

        upcoming = schedule[0]
        return f"Next schedule item: {upcoming.get('title', 'Upcoming event')}."

    def build_assistant_brief(self, payload: dict[str, Any]) -> str:
        location_label = payload.get("location", {}).get("label") or "your area"
        free_time_summary = payload.get("live_context", {}).get("free_time_summary")
        weather = payload.get("live_context", {}).get("weather", {})
        condition = weather.get("condition")
        temperature = weather.get("temperature")

        lines = [f"Travel context prepared for {location_label}."]
        if free_time_summary:
            lines.append(free_time_summary)
        if condition and temperature is not None:
            lines.append(f"Current weather: {temperature}°C and {condition}.")

        schedule = payload.get("live_context", {}).get("schedule", [])
        if schedule:
            lines.append(f"{len(schedule)} schedule item(s) included.")

        gmail_messages = payload.get("sources", {}).get("gmail_messages_count")
        if gmail_messages:
            lines.append(f"{gmail_messages} recent Gmail message(s) included.")

        return " ".join(lines)


def serialize_calendar_events(events: list[Any]) -> list[dict[str, Any]]:
    serialized = []
    for event in events:
        start = event.start.get("dateTime") or event.start.get("date")
        end = event.end.get("dateTime") or event.end.get("date")
        serialized.append(
            {
                "id": event.id,
                "title": event.summary or "Untitled event",
                "location": event.location,
                "time": format_time_range(start, end),
                "status": event.status,
            }
        )
    return serialized


def serialize_gmail_messages(messages: list[Any]) -> list[dict[str, Any]]:
    serialized = []
    for message in messages:
        serialized.append(
            {
                "id": message.id,
                "subject": message.subject,
                "from": message.from_email,
                "snippet": message.snippet,
            }
        )
    return serialized


def format_time_range(start: str | None, end: str | None) -> str | None:
    if not start:
        return None
    try:
        start_dt = datetime.fromisoformat(start.replace("Z", "+00:00"))
        if end:
            end_dt = datetime.fromisoformat(end.replace("Z", "+00:00"))
            return f"{start_dt.strftime('%-I:%M %p')} - {end_dt.strftime('%-I:%M %p')}"
        return start_dt.strftime('%-I:%M %p')
    except ValueError:
        return start


def extract_response_text(provider_response: dict[str, Any]) -> str | None:
    output_text = provider_response.get("output_text")
    if isinstance(output_text, str) and output_text.strip():
        return output_text.strip()

    outputs = provider_response.get("output") or []
    collected: list[str] = []
    if isinstance(outputs, list):
        for item in outputs:
            for content in item.get("content", []):
                if content.get("type") in {"output_text", "text"}:
                    text_value = content.get("text")
                    if isinstance(text_value, dict):
                        text_value = text_value.get("value")
                    if text_value:
                        collected.append(str(text_value).strip())

    text = " ".join(part for part in collected if part)
    return text or None


def get_openclaw_service() -> OpenClawService:
    return OpenClawService()
