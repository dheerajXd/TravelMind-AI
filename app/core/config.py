from functools import lru_cache
from pathlib import Path

from dotenv import load_dotenv
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


load_dotenv()


class Settings(BaseSettings):
    app_name: str = "AI Travel Assistant Backend"
    app_version: str = "1.0.0"
    debug: bool = False

    google_places_api_key: str | None = Field(default=None, alias="GOOGLE_PLACES_API_KEY")
    google_oauth_client_id: str | None = Field(default=None, alias="GOOGLE_OAUTH_CLIENT_ID")
    google_oauth_client_secret: str | None = Field(default=None, alias="GOOGLE_OAUTH_CLIENT_SECRET")
    google_oauth_redirect_uri: str | None = Field(default=None, alias="GOOGLE_OAUTH_REDIRECT_URI")
    openweather_api_key: str | None = Field(default=None, alias="OPENWEATHER_API_KEY")
    gemini_api_key: str | None = Field(default=None, alias="GEMINI_API_KEY")
    gemini_model: str = Field(default="gemini-2.5-flash", alias="GEMINI_MODEL")

    google_places_base_url: str = "https://maps.googleapis.com/maps/api/place"
    openweather_base_url: str = "https://api.open-meteo.com/v1"
    openmeteo_geocoding_base_url: str = "https://geocoding-api.open-meteo.com/v1"
    gemini_base_url: str = "https://generativelanguage.googleapis.com/v1beta/models"
    google_oauth_authorize_url: str = "https://accounts.google.com/o/oauth2/v2/auth"
    google_oauth_token_url: str = "https://oauth2.googleapis.com/token"
    google_userinfo_url: str = "https://openidconnect.googleapis.com/v1/userinfo"
    gmail_base_url: str = "https://gmail.googleapis.com/gmail/v1"
    calendar_base_url: str = "https://www.googleapis.com/calendar/v3"
    oauth_sessions_file: str = str(Path("data") / "oauth_sessions.json")

    request_timeout_seconds: float = 10.0
    gemini_timeout_seconds: float = 30.0
    cache_ttl_seconds: int = 300
    context_ttl_seconds: int = 3600
    rate_limit_requests: int = 60
    rate_limit_window_seconds: int = 60

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
        populate_by_name=True,
    )


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
