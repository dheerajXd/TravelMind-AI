from __future__ import annotations

import secrets
from datetime import UTC, datetime, timedelta
from typing import Any
from urllib.parse import urlencode

import httpx
from fastapi import HTTPException, status

from app.core.config import get_settings
from app.models.schemas import GoogleAuthSession, GoogleUserProfile
from app.utils.helpers import JsonFileStore, raise_upstream_error


settings = get_settings()
oauth_session_store = JsonFileStore(settings.oauth_sessions_file)


class GoogleOAuthService:
    SCOPES = [
        "openid",
        "email",
        "profile",
        "https://www.googleapis.com/auth/gmail.readonly",
        "https://www.googleapis.com/auth/calendar.readonly",
    ]

    def __init__(self) -> None:
        self.client_id = settings.google_oauth_client_id
        self.client_secret = settings.google_oauth_client_secret
        self.redirect_uri = settings.google_oauth_redirect_uri
        self.authorize_url = settings.google_oauth_authorize_url
        self.token_url = settings.google_oauth_token_url
        self.userinfo_url = settings.google_userinfo_url
        self.timeout = settings.request_timeout_seconds

    def build_authorization_url(self) -> tuple[str, str]:
        self._ensure_configured()
        state = secrets.token_urlsafe(32)
        query = urlencode(
            {
                "client_id": self.client_id,
                "redirect_uri": self.redirect_uri,
                "response_type": "code",
                "scope": " ".join(self.SCOPES),
                "access_type": "offline",
                "include_granted_scopes": "true",
                "prompt": "consent",
                "state": state,
            }
        )
        return f"{self.authorize_url}?{query}", state

    async def exchange_code_for_session(self, code: str, state: str) -> GoogleAuthSession:
        self._ensure_configured()
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                token_response = await client.post(
                    self.token_url,
                    data={
                        "code": code,
                        "client_id": self.client_id,
                        "client_secret": self.client_secret,
                        "redirect_uri": self.redirect_uri,
                        "grant_type": "authorization_code",
                    },
                )
                token_response.raise_for_status()
        except httpx.TimeoutException as exc:
            raise_upstream_error("Google OAuth", "token exchange timed out.", status.HTTP_504_GATEWAY_TIMEOUT)
            raise exc
        except httpx.HTTPStatusError as exc:
            detail = f"token exchange HTTP {exc.response.status_code}"
            try:
                error_payload = exc.response.json()
                provider_error = error_payload.get("error")
                provider_description = error_payload.get("error_description")
                if provider_error or provider_description:
                    detail = f"{detail}: {provider_error or 'error'}"
                    if provider_description:
                        detail = f"{detail} ({provider_description})"
            except ValueError:
                pass
            raise_upstream_error("Google OAuth", detail, status.HTTP_502_BAD_GATEWAY)
            raise exc
        except httpx.HTTPError as exc:
            raise_upstream_error("Google OAuth", "network error during token exchange.")
            raise exc

        token_payload = token_response.json()
        user = await self._fetch_user_profile(token_payload["access_token"])
        session_id = secrets.token_urlsafe(32)
        expires_at = datetime.now(UTC) + timedelta(seconds=token_payload.get("expires_in", 3600))
        session_payload = {
            "user": user.model_dump(mode="json"),
            "access_token": token_payload["access_token"],
            "refresh_token": token_payload.get("refresh_token"),
            "expires_at": expires_at.isoformat(),
            "scope": token_payload.get("scope", ""),
            "token_type": token_payload.get("token_type", "Bearer"),
            "created_at": datetime.now(UTC).isoformat(),
        }
        oauth_session_store.set(session_id, session_payload)
        return GoogleAuthSession(
            session_id=session_id,
            user=user,
            granted_scopes=token_payload.get("scope", "").split(),
            expires_at=expires_at,
        )

    async def get_session(self, session_id: str) -> dict[str, Any]:
        session = oauth_session_store.get(session_id)
        if session is None:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired session.")

        expires_at = datetime.fromisoformat(session["expires_at"])
        if expires_at <= datetime.now(UTC) + timedelta(seconds=30):
            if not session.get("refresh_token"):
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Google session expired and cannot be refreshed.",
                )
            refreshed = await self._refresh_access_token(session["refresh_token"])
            session["access_token"] = refreshed["access_token"]
            session["expires_at"] = (
                datetime.now(UTC) + timedelta(seconds=refreshed.get("expires_in", 3600))
            ).isoformat()
            session["scope"] = refreshed.get("scope", session.get("scope", ""))
            session["token_type"] = refreshed.get("token_type", session.get("token_type", "Bearer"))
            oauth_session_store.set(session_id, session)
        return session

    async def get_user_profile_from_session(self, session_id: str) -> GoogleUserProfile:
        session = await self.get_session(session_id)
        return GoogleUserProfile.model_validate(session["user"])

    async def _fetch_user_profile(self, access_token: str) -> GoogleUserProfile:
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.get(
                    self.userinfo_url,
                    headers={"Authorization": f"Bearer {access_token}"},
                )
                response.raise_for_status()
        except httpx.TimeoutException as exc:
            raise_upstream_error("Google OAuth", "userinfo request timed out.", status.HTTP_504_GATEWAY_TIMEOUT)
            raise exc
        except httpx.HTTPStatusError as exc:
            raise_upstream_error("Google OAuth", f"userinfo HTTP {exc.response.status_code}")
            raise exc
        except httpx.HTTPError as exc:
            raise_upstream_error("Google OAuth", "network error while fetching user profile.")
            raise exc
        return GoogleUserProfile.model_validate(response.json())

    async def _refresh_access_token(self, refresh_token: str) -> dict[str, Any]:
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.post(
                    self.token_url,
                    data={
                        "client_id": self.client_id,
                        "client_secret": self.client_secret,
                        "refresh_token": refresh_token,
                        "grant_type": "refresh_token",
                    },
                )
                response.raise_for_status()
        except httpx.TimeoutException as exc:
            raise_upstream_error("Google OAuth", "token refresh timed out.", status.HTTP_504_GATEWAY_TIMEOUT)
            raise exc
        except httpx.HTTPStatusError as exc:
            raise_upstream_error("Google OAuth", f"token refresh HTTP {exc.response.status_code}")
            raise exc
        except httpx.HTTPError as exc:
            raise_upstream_error("Google OAuth", "network error during token refresh.")
            raise exc
        return response.json()

    def _ensure_configured(self) -> None:
        if not self.client_id or not self.client_secret or not self.redirect_uri:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Google OAuth client configuration is missing.",
            )


google_oauth_service = GoogleOAuthService()
