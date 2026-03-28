from __future__ import annotations

import json
from typing import Any

import httpx
from fastapi import HTTPException, status

from app.core.config import get_settings
from app.models.schemas import RecommendationItem, RecommendationRequest, RecommendationResponse
from app.utils.helpers import raise_upstream_error


settings = get_settings()


class GeminiService:
    def __init__(self) -> None:
        self.api_key = settings.gemini_api_key
        self.base_url = settings.gemini_base_url
        self.timeout = settings.gemini_timeout_seconds
        self.model = settings.gemini_model

    async def generate_recommendations(
        self,
        payload: RecommendationRequest,
    ) -> RecommendationResponse:
        if not self.api_key:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Gemini API key is not configured.",
            )

        body = {
            "contents": [
                {
                    "parts": [
                        {
                            "text": self._build_prompt(payload),
                        }
                    ]
                }
            ],
            "generationConfig": {
                "temperature": 0.2,
                "responseMimeType": "application/json",
            },
        }

        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.post(
                    f"{self.base_url}/{self.model}:generateContent",
                    params={"key": self.api_key},
                    json=body,
                )
                response.raise_for_status()
        except httpx.TimeoutException as exc:
            raise_upstream_error("Gemini", "request timed out.", status.HTTP_504_GATEWAY_TIMEOUT)
            raise exc
        except httpx.HTTPStatusError as exc:
            raise_upstream_error("Gemini", f"HTTP {exc.response.status_code}")
            raise exc
        except httpx.HTTPError as exc:
            raise_upstream_error("Gemini", "network error while generating recommendations.")
            raise exc

        raw_json = self._extract_json_text(response.json())
        try:
            parsed = json.loads(raw_json)
        except json.JSONDecodeError as exc:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="Gemini returned invalid JSON.",
            ) from exc

        validated = RecommendationResponse.model_validate(parsed)
        return self._enrich_with_place_details(validated, payload.places)

    def _build_prompt(self, payload: RecommendationRequest) -> str:
        return (
            "You are an AI travel assistant reasoning engine. Analyze the user's travel context, "
            "live weather, and nearby places together. Prefer options that match the user's vibe, "
            "budget, timing, trip purpose, and current weather. Rank the best options. "
            "Avoid repetitive suggestions that are all the same venue pattern. Prefer a diverse mix "
            "such as one quick meal option, one cafe/work option, one nearby experience, and one wildcard when possible. "
            "Do not fill the list with near-identical restaurants unless there are truly no better alternatives. "
            "Favor concise, useful reasons that mention why the option fits right now. "
            "Prioritize places that appear open now when the current time suggests immediate action, but do not state "
            "that a venue is definitely open unless the place data explicitly confirms it. If hours are uncertain, say that "
            "hours should be verified. Avoid hotel-like properties unless they clearly match the user's intent. "
            "Do not return prose outside JSON.\n\n"
            "Return strictly valid JSON with this schema:\n"
            '{\n  "recommendations": [\n    {\n      "title": "string",\n      "reason": "string",\n'
            '      "type": "cafe | restaurant | activity",\n      "priority": 1\n    }\n  ]\n}\n\n'
            f"User context:\n{json.dumps(payload.user_context, indent=2, default=str)}\n\n"
            f"Weather:\n{json.dumps(payload.weather, indent=2, default=str)}\n\n"
            f"Places:\n{json.dumps(payload.places, indent=2, default=str)}\n\n"
            f"Gmail context:\n{json.dumps(payload.gmail_context or {}, indent=2, default=str)}\n\n"
            f"Calendar context:\n{json.dumps(payload.calendar_context or {}, indent=2, default=str)}\n\n"
            "Create 4 concise recommendations when the place data allows it. Priority 1 is the best option. "
            "Reasons must explain the combined reasoning using preferences, weather, place attributes, and any useful schedule or email signals when present. "
            "At least two recommendations should feel meaningfully different in use-case whenever the place data allows it. "
            "Do not recommend the same place twice. Do not give more than one recommendation from the same hotel/property family. "
            "When appropriate, naturally include signals like 'hours look favorable', 'good for a quick dinner', "
            "'good for a short gap between meetings', 'quiet work-friendly option', or 'good nearby experience' inside the reason "
            "so the UI can surface those as badges. Never invent opening status."
        )

    def _extract_json_text(self, response_data: dict[str, Any]) -> str:
        candidates = response_data.get("candidates") or []
        if not candidates:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="Gemini returned no candidates.",
            )

        parts = candidates[0].get("content", {}).get("parts", [])
        if not parts:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="Gemini returned empty content.",
            )
        text = parts[0].get("text", "").strip()
        if text.startswith("```"):
            text = text.strip("`")
            text = text.replace("json", "", 1).strip()
        return text

    def _enrich_with_place_details(
        self,
        response: RecommendationResponse,
        places: list[dict[str, Any]],
    ) -> RecommendationResponse:
        enriched: list[RecommendationItem] = []
        for recommendation in response.recommendations:
            match = self._match_place(recommendation.title, places)
            if not match:
                enriched.append(recommendation)
                continue
            enriched.append(
                recommendation.model_copy(
                    update={
                        "google_rating": match.get("rating"),
                        "place_address": match.get("address"),
                    }
                )
            )
        return RecommendationResponse(recommendations=enriched)

    def _match_place(self, title: str, places: list[dict[str, Any]]) -> dict[str, Any] | None:
        normalized_title = self._normalize_name(title)
        for place in places:
            if self._normalize_name(str(place.get("name", ""))) == normalized_title:
                return place
        for place in places:
            normalized_place = self._normalize_name(str(place.get("name", "")))
            if normalized_title and (normalized_title in normalized_place or normalized_place in normalized_title):
                return place
        return None

    def _normalize_name(self, value: str) -> str:
        return "".join(char.lower() for char in value if char.isalnum() or char.isspace()).strip()


gemini_service = GeminiService()
