from __future__ import annotations

import logging
import time

from fastapi import FastAPI, HTTPException, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.routes.auth import router as auth_router
from app.api.routes.calendar import router as calendar_router
from app.api.routes.context import router as context_router
from app.api.routes.gmail import router as gmail_router
from app.api.routes.places import router as places_router
from app.api.routes.recommendation_engine import router as recommendation_engine_router
from app.api.routes.recommendations import router as recommendations_router
from app.api.routes.smart import router as smart_router
from app.api.routes.weather import router as weather_router
from app.core.config import get_settings
from app.core.database import init_db
from app.utils.helpers import InMemoryRateLimiter


settings = get_settings()

logging.basicConfig(
    level=logging.DEBUG if settings.debug else logging.INFO,
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
)
logger = logging.getLogger("ai_travel_assistant")
rate_limiter = InMemoryRateLimiter(
    max_requests=settings.rate_limit_requests,
    window_seconds=settings.rate_limit_window_seconds,
)

app = FastAPI(
    title=settings.app_name,
    version=settings.app_version,
    debug=settings.debug,
)

init_db()

app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"https?://(localhost|127\.0\.0\.1)(:\d+)?",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def logging_middleware(request: Request, call_next):
    started_at = time.perf_counter()
    client_host = request.client.host if request.client else "unknown"
    try:
        rate_limiter.check(client_host)
    except HTTPException as exc:
        return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})
    response = await call_next(request)
    duration_ms = (time.perf_counter() - started_at) * 1000
    logger.info(
        "%s %s -> %s in %.2fms",
        request.method,
        request.url.path,
        response.status_code,
        duration_ms,
    )
    response.headers["X-Process-Time-Ms"] = f"{duration_ms:.2f}"
    return response


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(_: Request, exc: RequestValidationError) -> JSONResponse:
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content={"detail": exc.errors()},
    )


@app.exception_handler(Exception)
async def global_exception_handler(_: Request, exc: Exception) -> JSONResponse:
    logger.exception("Unhandled exception: %s", exc)
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={"detail": "Internal server error."},
    )


@app.get("/health", tags=["health"])
async def healthcheck() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/", tags=["root"])
async def root() -> dict[str, str]:
    return {
        "message": "AI Travel Assistant Backend is running",
        "docs": "/docs",
        "health": "/health",
    }


app.include_router(context_router, prefix="/context", tags=["context"])
app.include_router(auth_router, tags=["google-auth"])
app.include_router(gmail_router, tags=["gmail"])
app.include_router(calendar_router, tags=["calendar"])
app.include_router(places_router, prefix="/places", tags=["places"])
app.include_router(weather_router, tags=["weather"])
app.include_router(recommendations_router, tags=["recommendations"])
app.include_router(recommendation_engine_router, tags=["recommendation-engine"])
app.include_router(smart_router, tags=["smart"])
