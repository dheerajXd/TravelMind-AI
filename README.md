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
GOOGLE_OAUTH_REDIRECT_URI=http://127.0.0.1:8000/auth/google/callback
```

OAuth sessions are persisted locally in `data/oauth_sessions.json`, so Gmail and Calendar sessions survive backend reloads and restarts.
Travel context is persisted in `data/travel_assistant.db`.

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

### Start Google OAuth

```bash
curl "http://127.0.0.1:8000/auth/google/login"
```

Open the returned `authorization_url`, sign in with Google, and Google will redirect to your configured callback URL with `code` and `state`.

### Exchange Google callback for a backend session

```bash
curl "http://127.0.0.1:8000/auth/google/callback?code=GOOGLE_CODE&state=STATE_FROM_LOGIN"
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
