from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field, field_validator, model_validator


class TravelAssistantBaseModel(BaseModel):
    model_config = {
        "populate_by_name": True,
        "extra": "forbid",
    }


class Coordinates(TravelAssistantBaseModel):
    lat: float = Field(..., ge=-90, le=90)
    lng: float = Field(..., ge=-180, le=180)


class TripDetails(TravelAssistantBaseModel):
    destination: str | None = None
    start_date: datetime | None = None
    end_date: datetime | None = None
    travelers: int | None = Field(default=None, ge=1)
    purpose: str | None = None
    notes: str | None = None


class ContextLocation(TravelAssistantBaseModel):
    city: str | None = None
    coordinates: Coordinates | None = None

    @model_validator(mode="after")
    def validate_location(self) -> "ContextLocation":
        if not self.city and not self.coordinates:
            raise ValueError("Either city or coordinates must be provided.")
        return self


class ContextRequest(TravelAssistantBaseModel):
    user_id: str = Field(..., min_length=1, max_length=128)
    location: ContextLocation
    time: datetime | None = None
    preferences: dict[str, Any] = Field(default_factory=dict)
    onboarding_profile: dict[str, Any] = Field(default_factory=dict)
    trip_details: TripDetails | None = None


class ContextResponse(TravelAssistantBaseModel):
    message: str
    context: ContextRequest


class PlaceType(str, Enum):
    cafe = "cafe"
    restaurant = "restaurant"
    coworking = "coworking"
    bar = "bar"
    museum = "museum"
    park = "park"
    hotel = "hotel"
    attraction = "attraction"
    generic = "generic"


class PlacesSearchQuery(TravelAssistantBaseModel):
    location: str | None = None
    lat: float | None = Field(default=None, ge=-90, le=90)
    lng: float | None = Field(default=None, ge=-180, le=180)
    type: str = Field(..., min_length=2, max_length=64)
    radius: int = Field(default=2500, ge=100, le=50000)

    @model_validator(mode="after")
    def validate_input(self) -> "PlacesSearchQuery":
        has_coordinates = self.lat is not None and self.lng is not None
        if not self.location and not has_coordinates:
            raise ValueError("Provide either location or both lat and lng.")
        return self


class ReverseGeocodeQuery(TravelAssistantBaseModel):
    lat: float = Field(..., ge=-90, le=90)
    lng: float = Field(..., ge=-180, le=180)


class ReverseGeocodeResponse(TravelAssistantBaseModel):
    label: str
    city: str | None = None
    region: str | None = None
    country: str | None = None


class PlaceItem(TravelAssistantBaseModel):
    id: str | None = None
    name: str
    rating: float | None = None
    address: str
    open_now: bool | None = None
    types: list[str] = Field(default_factory=list)
    photo_url: str | None = None
    lat: float | None = None
    lng: float | None = None


class PlacesResponse(TravelAssistantBaseModel):
    places: list[PlaceItem]


class WeatherQuery(TravelAssistantBaseModel):
    location: str | None = None
    lat: float | None = Field(default=None, ge=-90, le=90)
    lng: float | None = Field(default=None, ge=-180, le=180)

    @model_validator(mode="after")
    def validate_input(self) -> "WeatherQuery":
        has_coordinates = self.lat is not None and self.lng is not None
        if not self.location and not has_coordinates:
            raise ValueError("Provide either location or both lat and lng.")
        return self


class WeatherResponse(TravelAssistantBaseModel):
    temperature: float
    condition: str
    humidity: int
    wind_speed: float
    city: str | None = None


class RecommendationType(str, Enum):
    cafe = "cafe"
    restaurant = "restaurant"
    activity = "activity"


class RecommendationItem(TravelAssistantBaseModel):
    title: str
    reason: str
    type: RecommendationType
    priority: int = Field(..., ge=1)
    google_rating: float | None = None
    place_address: str | None = None


class RecommendationRequest(TravelAssistantBaseModel):
    user_context: dict[str, Any]
    weather: dict[str, Any]
    places: list[dict[str, Any]]
    gmail_context: dict[str, Any] | None = None
    calendar_context: dict[str, Any] | None = None


class RecommendationResponse(TravelAssistantBaseModel):
    recommendations: list[RecommendationItem]
    nearby_matches: list["NearbyMatchItem"] = Field(default_factory=list)
    proactive_triggers: list[str] = Field(default_factory=list)

    @field_validator("recommendations")
    @classmethod
    def sort_recommendations(cls, value: list[RecommendationItem]) -> list[RecommendationItem]:
        return sorted(value, key=lambda item: item.priority)


class NearbyMatchItem(TravelAssistantBaseModel):
    name: str
    google_rating: float | None = None
    address: str
    category: str
    open_now: bool | None = None
    distance_meters: int | None = None
    walk_eta_minutes: int | None = None
    drive_eta_minutes: int | None = None


class SmartSuggestionsQuery(TravelAssistantBaseModel):
    user_id: str = Field(..., min_length=1, max_length=128)
    type: str = Field(default="restaurant", min_length=2, max_length=64)
    radius: int = Field(default=2500, ge=100, le=50000)
    google_session_id: str | None = Field(default=None, min_length=10)


class SmartFeedbackRequest(TravelAssistantBaseModel):
    user_id: str = Field(..., min_length=1, max_length=128)
    action: str = Field(..., min_length=1, max_length=32)
    place: dict[str, Any] = Field(default_factory=dict)


class SmartFeedbackResponse(TravelAssistantBaseModel):
    message: str
    learning_state_updated: bool = True


class ErrorResponse(TravelAssistantBaseModel):
    detail: str


class GoogleAuthUrlResponse(TravelAssistantBaseModel):
    authorization_url: str
    state: str


class GoogleAuthCallbackQuery(TravelAssistantBaseModel):
    code: str = Field(..., min_length=1)
    state: str = Field(..., min_length=1)


class GoogleUserProfile(TravelAssistantBaseModel):
    sub: str
    email: str
    email_verified: bool | None = None
    name: str | None = None
    given_name: str | None = None
    family_name: str | None = None
    picture: str | None = None
    locale: str | None = None


class GoogleAuthSession(TravelAssistantBaseModel):
    session_id: str
    user: GoogleUserProfile
    granted_scopes: list[str]
    expires_at: datetime


class GmailMessageItem(TravelAssistantBaseModel):
    id: str
    thread_id: str
    subject: str | None = None
    from_email: str | None = None
    snippet: str | None = None
    internal_date: datetime | None = None


class GmailMessagesResponse(TravelAssistantBaseModel):
    messages: list[GmailMessageItem]
    result_size_estimate: int | None = None


class CalendarEventItem(TravelAssistantBaseModel):
    id: str
    status: str | None = None
    summary: str | None = None
    description: str | None = None
    location: str | None = None
    html_link: str | None = Field(default=None, alias="htmlLink")
    start: dict[str, Any] = Field(default_factory=dict)
    end: dict[str, Any] = Field(default_factory=dict)
    organizer_email: str | None = None


class CalendarEventsResponse(TravelAssistantBaseModel):
    events: list[CalendarEventItem]


class OpenClawStatusResponse(TravelAssistantBaseModel):
    enabled: bool
    configured: bool
    base_url: str | None = None
    workspace_id: str | None = None
    note: str


class OpenClawContextPreviewRequest(TravelAssistantBaseModel):
    user_id: str = Field(..., min_length=1, max_length=128)
    location_label: str | None = None
    preferences: dict[str, Any] = Field(default_factory=dict)
    onboarding_profile: dict[str, Any] = Field(default_factory=dict)
    weather: dict[str, Any] = Field(default_factory=dict)
    schedule: list[dict[str, Any]] = Field(default_factory=list)
    free_time_summary: str | None = None


class UserNotificationSettingsResponse(TravelAssistantBaseModel):
    user_id: str
    notifications_enabled: bool = True
    radius_km: float = 2
    quiet_hours_start: str | None = None
    quiet_hours_end: str | None = None
    max_per_day: int = 3
    updated_at: str | None = None


class UserNotificationSettingsUpdate(TravelAssistantBaseModel):
    notifications_enabled: bool = True
    radius_km: float = Field(default=2, ge=0.1, le=100)
    quiet_hours_start: str | None = None
    quiet_hours_end: str | None = None
    max_per_day: int = Field(default=3, ge=1, le=50)


class DeviceTokenRequest(TravelAssistantBaseModel):
    user_id: str = Field(..., min_length=1, max_length=128)
    token: str = Field(..., alias="device_token", min_length=8, max_length=2048)


class NotificationItemResponse(TravelAssistantBaseModel):
    id: int
    place_id: str | None = None
    type: str | None = None
    title: str | None = None
    message: str | None = None
    sent_at: str
    clicked: bool = False


class NotificationListResponse(TravelAssistantBaseModel):
    notifications: list[NotificationItemResponse] = Field(default_factory=list)


class LocationUpdateRequest(TravelAssistantBaseModel):
    user_id: str = Field(..., min_length=1, max_length=128)
    lat: float = Field(..., ge=-90, le=90)
    lng: float = Field(..., ge=-180, le=180)


class TriggerManualRequest(TravelAssistantBaseModel):
    user_id: str = Field(..., min_length=1, max_length=128)


class TriggerResponse(TravelAssistantBaseModel):
    user_id: str
    activity_state: str
    triggered: bool
    queued: int = 0
    reason: str
    sources: dict[str, Any] = Field(default_factory=dict)


class OpenClawContextPreviewResponse(TravelAssistantBaseModel):
    enabled: bool
    configured: bool
    payload: dict[str, Any]
    note: str


class OpenClawUserPreviewRequest(TravelAssistantBaseModel):
    user_id: str = Field(..., min_length=1, max_length=128)
    google_session_id: str | None = Field(default=None, min_length=10)
    gmail_max_results: int = Field(default=5, ge=1, le=20)
    calendar_max_results: int = Field(default=10, ge=1, le=20)


class OpenClawUserPreviewResponse(TravelAssistantBaseModel):
    enabled: bool
    configured: bool
    payload: dict[str, Any]
    note: str


class OpenClawUserBriefRequest(TravelAssistantBaseModel):
    user_id: str = Field(..., min_length=1, max_length=128)
    google_session_id: str | None = Field(default=None, min_length=10)
    gmail_max_results: int = Field(default=5, ge=1, le=20)
    calendar_max_results: int = Field(default=10, ge=1, le=20)


class OpenClawUserBriefResponse(TravelAssistantBaseModel):
    enabled: bool
    configured: bool
    executed: bool
    payload: dict[str, Any]
    note: str
    assistant_response: str | None = None
