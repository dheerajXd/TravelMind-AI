# AI Travel Assistant Backend

Production-ready FastAPI backend for an AI-powered travel assistant with context storage, Google Places integration, Open-Meteo weather integration, Gemini-powered recommendations, logging, caching, and basic rate limiting.

## Structure

```text
app/
  main.py
  api/
    routes/
      context.py
      places.py
      weather.py
      recommendations.py
      smart.py
  services/
    places_service.py
    weather_service.py
    gemini_service.py
  models/
    schemas.py
  core/
    config.py
  utils/
    helpers.py
.env
.env.example
requirements.txt
```

## Setup

```bash
python3.11 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
uvicorn app.main:app --reload
```

`.env` should contain `GOOGLE_PLACES_API_KEY`, `GEMINI_API_KEY`, and optionally `GEMINI_MODEL=gemini-2.5-flash`. If you want stricter control, you can also set `GEMINI_TIMEOUT_SECONDS=30`.

For Google OAuth, Gmail, and Calendar you also need:

```env
GOOGLE_OAUTH_CLIENT_ID=your_google_oauth_client_id
GOOGLE_OAUTH_CLIENT_SECRET=your_google_oauth_client_secret
GOOGLE_OAUTH_REDIRECT_URI=http://127.0.0.1:8001/auth/google/callback
```

OAuth sessions are persisted locally in `data/oauth_sessions.json`, so Gmail and Calendar sessions survive backend reloads and restarts.
Travel context is persisted in `data/travel_assistant.db`.

## OpenClaw Phase 1 Scaffold

The project now includes an additive OpenClaw integration scaffold. This does not replace the current recommendation flow or backend decision logic. It only adds a configuration-aware preview surface for a future OpenClaw action/orchestration layer.

Optional environment variables:

```env
OPENCLAW_ENABLED=false
OPENCLAW_BASE_URL=
OPENCLAW_API_KEY=
OPENCLAW_WORKSPACE_ID=
OPENCLAW_TIMEOUT_SECONDS=15
```

Available scaffold routes:

```bash
curl "http://127.0.0.1:8000/openclaw/status"
```

```bash
curl -X POST http://127.0.0.1:8000/openclaw/context-preview \
  -H "Content-Type: application/json" \
  -d '{
    "user_id": "demo-user",
    "location_label": "Tada, Andhra Pradesh",
    "preferences": {
      "budget": "medium",
      "vibe": "calm"
    },
    "onboarding_profile": {
      "cuisine_preference": "South Indian",
      "free_time_preference": "food"
    },
    "weather": {
      "temperature": 31,
      "condition": "Mostly Clear"
    },
    "schedule": [
      {
        "time": "5:30 PM - 8:00 PM",
        "title": "Free Time"
      }
    ],
    "free_time_summary": "Free this evening near hotel."
  }'
```

This returns the normalized payload that a later OpenClaw execution phase can use, without invoking or replacing the current recommendation pipeline.

Phase 2 adds a user-aware preview route that can assemble the payload from existing stored context plus optional Google Calendar and Gmail data:

```bash
curl -X POST http://127.0.0.1:8000/openclaw/user-preview \
  -H "Content-Type: application/json" \
  -d '{
    "user_id": "demo-user",
    "google_session_id": "your_google_session_id"
  }'
```

This returns:

- a normalized OpenClaw-ready payload
- a lightweight assistant brief summary
- context built from your existing storage and integrations only

## Example Requests

### Store user context

```bash
curl -X POST http://127.0.0.1:8000/context \
  -H "Content-Type: application/json" \
  -d '{
    "user_id": "demo-user",
    "location": {
      "city": "Bengaluru"
    },
    "time": "2026-03-26T18:00:00Z",
    "preferences": {
      "food": ["south indian", "coffee"],
      "vibe": "calm",
      "budget": "medium"
    },
    "trip_details": {
      "purpose": "leisure",
      "travelers": 2,
      "notes": "Looking for good food and evening walks"
    }
  }'
```

### Search nearby places by coordinates

```bash
curl "http://127.0.0.1:8000/places/search?lat=12.9716&lng=77.5946&type=cafe&radius=2000"
```

### Get weather by city

```bash
curl "http://127.0.0.1:8000/weather?location=Bengaluru"
```

### Generate recommendations directly

```bash
curl -X POST http://127.0.0.1:8000/recommendations \
  -H "Content-Type: application/json" \
  -d '{
    "user_context": {
      "preferences": {"food": ["local cuisine"], "vibe": "romantic"}
    },
    "weather": {
      "temperature": 24,
      "condition": "Clouds",
      "humidity": 68,
      "wind_speed": 3.5
    },
    "places": [
      {
        "name": "Cafe Terra",
        "rating": 4.5,
        "address": "MG Road",
        "open_now": true,
        "types": ["cafe", "food"]
      }
    ]
  }'
```

### Get smart suggestions from stored context

```bash
curl "http://127.0.0.1:8000/smart-suggestions?user_id=demo-user&type=restaurant&radius=2500"
```

## Additive Recommendation Engine Module

The project now includes a separate plug-and-play engine at [app/services/recommendation_engine.py](/Users/dheerajd/Documents/New%20project/app/services/recommendation_engine.py). It does not replace the existing app flow. It is an additive module you can call from the current system whenever you want deterministic filtering and scoring on top of already-fetched place data.

Available functions:

- `filter_places(places, context, max_distance)`
- `calculate_score(place, user, context)`
- `update_preferences(user, place, action)`
- `recommend(user, places, context, max_distance=5000.0)`

Sample input:

```python
places = [
    {"name": "Cafe Nova", "category": "cafe", "distance": 350, "rating": 4.6, "open": True},
    {"name": "City Museum", "category": "museum", "distance": 1400, "rating": 4.4, "open": True},
    {"name": "Night Bites", "category": "restaurant", "distance": 500, "rating": 4.2, "open": True},
]

context = {
    "time_of_day": "evening",
    "weather": "Clear",
    "temperature": 26.0,
}

user = {
    "preferences": {
        "preferred_categories": ["cafe", "restaurant"],
        "categories": {"cafe": 3.0, "restaurant": 1.0},
    },
    "history": [
        {"category": "cafe", "action": "like"},
        {"category": "restaurant", "action": "click"},
    ],
}
```

Sample output:

```python
[
    {"name": "Cafe Nova", "category": "cafe", "score": 3.3443},
    {"name": "Night Bites", "category": "restaurant", "score": 1.2461},
]
```

Example usage:

```python
from app.services.recommendation_engine import recommend, update_preferences

ranked = recommend(user=user, places=places, context=context, max_distance=1500)

updated_user = update_preferences(user=user, place=places[0], action="like")
```

Optional additive API routes:

```bash
curl -X POST http://127.0.0.1:8000/recommendation-engine/recommend \
  -H "Content-Type: application/json" \
  -d '{
    "user": {
      "preferences": {
        "preferred_categories": ["cafe", "restaurant"],
        "categories": {"cafe": 3, "restaurant": 1}
      },
      "history": [{"category": "cafe", "action": "like"}]
    },
    "places": [
      {"name": "Cafe Nova", "category": "cafe", "distance": 350, "rating": 4.6, "open": true},
      {"name": "Night Bites", "category": "restaurant", "distance": 500, "rating": 4.2, "open": true}
    ],
    "context": {
      "time_of_day": "evening",
      "weather": "Clear",
      "temperature": 26
    },
    "max_distance": 1500
  }'
```

```bash
curl -X POST http://127.0.0.1:8000/recommendation-engine/update-preferences \
  -H "Content-Type: application/json" \
  -d '{
    "user": {
      "preferences": {"categories": {"cafe": 3}},
      "history": []
    },
    "place": {"name": "Cafe Nova", "category": "cafe"},
    "action": "like"
  }'
```

### Start Google OAuth

```bash
curl "http://127.0.0.1:8000/auth/google/login"
```

Open the returned `authorization_url`, sign in with Google, and Google will redirect to your configured callback URL with `code` and `state`.

### Exchange Google callback for a backend session

```bash
curl "http://127.0.0.1:8001/auth/google/callback?code=GOOGLE_CODE&state=STATE_FROM_LOGIN"
```

This returns a `session_id` that you can use with Gmail and Calendar routes.

### Get current Google user

```bash
curl "http://127.0.0.1:8000/auth/google/me?session_id=YOUR_SESSION_ID"
```

### List Gmail messages

```bash
curl "http://127.0.0.1:8000/gmail/messages?session_id=YOUR_SESSION_ID&max_results=5&unread_only=true"
```

### List upcoming calendar events

```bash
curl "http://127.0.0.1:8000/calendar/events?session_id=YOUR_SESSION_ID&max_results=5"
```
