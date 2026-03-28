from __future__ import annotations

from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import RedirectResponse

from app.core.config import get_settings
from app.models.schemas import GoogleAuthCallbackQuery, GoogleAuthSession, GoogleAuthUrlResponse, GoogleUserProfile
from app.services.google_oauth_service import google_oauth_service
from app.utils.helpers import JsonFileStore


router = APIRouter(prefix="/auth/google")
settings = get_settings()
oauth_state_store = JsonFileStore(settings.oauth_states_file)


@router.get("/login")
async def google_login(redirect_to: str | None = Query(default=None)) -> RedirectResponse:
    authorization_url, state = google_oauth_service.build_authorization_url()
    resolved_redirect_to = _resolve_redirect_target(redirect_to)
    oauth_state_store.set(
        state,
        {
            "redirect_to": resolved_redirect_to,
        },
    )
    response = RedirectResponse(url=authorization_url, status_code=status.HTTP_307_TEMPORARY_REDIRECT)
    response.set_cookie(
        key="google_oauth_state",
        value=state,
        httponly=True,
        samesite="lax",
        secure=False,
        max_age=1800,
    )
    if resolved_redirect_to:
        response.set_cookie(
            key="google_oauth_redirect_to",
            value=resolved_redirect_to,
            httponly=True,
            samesite="lax",
            secure=False,
            max_age=1800,
        )
    return response


@router.get("/callback", response_model=None)
async def google_callback(request: Request, query: GoogleAuthCallbackQuery = Depends()):
    cookie_state = request.cookies.get("google_oauth_state")
    if not cookie_state or cookie_state != query.state:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid or expired OAuth state.")
    session = await google_oauth_service.exchange_code_for_session(query.code, query.state)
    state_payload = oauth_state_store.get(query.state) or {}
    redirect_to = state_payload.get("redirect_to") or request.cookies.get("google_oauth_redirect_to")
    oauth_state_store.delete(query.state)
    if not redirect_to:
        return session

    redirect_url = _append_redirect_query(
        redirect_to,
        {
            "google_session_id": session.session_id,
            "google_connected": "1",
        },
    )
    response = RedirectResponse(url=redirect_url, status_code=status.HTTP_303_SEE_OTHER)
    response.delete_cookie("google_oauth_state")
    response.delete_cookie("google_oauth_redirect_to")
    return response


@router.get("/me", response_model=GoogleUserProfile)
async def google_me(session_id: str = Query(..., min_length=10)) -> GoogleUserProfile:
    return await google_oauth_service.get_user_profile_from_session(session_id)


def _append_redirect_query(base_url: str, params: dict[str, str]) -> str:
    parts = urlsplit(base_url)
    query = dict(parse_qsl(parts.query, keep_blank_values=True))
    query.update(params)
    return urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(query), parts.fragment))


def _resolve_redirect_target(redirect_to: str | None) -> str:
    fallback = settings.frontend_web_url
    if not redirect_to:
        return fallback

    parts = urlsplit(redirect_to)
    if parts.scheme not in {"http", "https"} or not parts.netloc:
        return fallback

    if parts.hostname in {"127.0.0.1", "localhost"} and parts.port is None:
        fallback_parts = urlsplit(fallback)
        netloc = fallback_parts.netloc or parts.netloc
        path = parts.path or fallback_parts.path or "/"
        return urlunsplit((parts.scheme, netloc, path, parts.query, parts.fragment))

    return redirect_to
