from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import RedirectResponse

from app.models.schemas import GoogleAuthCallbackQuery, GoogleAuthSession, GoogleAuthUrlResponse, GoogleUserProfile
from app.services.google_oauth_service import google_oauth_service


router = APIRouter(prefix="/auth/google")


@router.get("/login")
async def google_login() -> RedirectResponse:
    authorization_url, state = google_oauth_service.build_authorization_url()
    response = RedirectResponse(url=authorization_url, status_code=status.HTTP_307_TEMPORARY_REDIRECT)
    response.set_cookie(
        key="google_oauth_state",
        value=state,
        httponly=True,
        samesite="lax",
        secure=False,
        max_age=1800,
    )
    return response


@router.get("/callback", response_model=GoogleAuthSession)
async def google_callback(request: Request, query: GoogleAuthCallbackQuery = Depends()) -> GoogleAuthSession:
    cookie_state = request.cookies.get("google_oauth_state")
    if not cookie_state or cookie_state != query.state:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid or expired OAuth state.")
    return await google_oauth_service.exchange_code_for_session(query.code, query.state)


@router.get("/me", response_model=GoogleUserProfile)
async def google_me(session_id: str = Query(..., min_length=10)) -> GoogleUserProfile:
    return await google_oauth_service.get_user_profile_from_session(session_id)
