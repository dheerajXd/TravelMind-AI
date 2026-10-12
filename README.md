# TravelMind AI

TravelMind AI is a context-aware, highly personalized travel assistant that intelligently suggests nearby places to eat, work, and explore. It combines real-time signals — like location, time, live weather, and your Google Calendar/Gmail context — to figure out exactly what you need at the present moment.

## Features

- **Context-Aware Recommendations**: Recommends the best spots (e.g., a quiet cafe, a quick bite, or a nearby attraction) based on weather, time, and your schedule.
- **Smart Decision Engine**: Uses an advanced heuristic engine and Google's Gemini AI to rank places and provide human-readable reasoning for its suggestions.
- **Proactive Triggers**: Sends intelligent push notifications (via Firebase Cloud Messaging) for top-rated spots when you are idle in a new area.
- **Seamless Integrations**: Natively connects with Google Places, Open-Meteo for weather, and Google APIs (OAuth, Gmail, Calendar) to provide zero-effort personalization.

## Tech Stack

### Backend (Node.js / Express)
- **Server**: Node.js, Express.js
- **Database**: MongoDB (via Mongoose)
- **Caching**: Redis (optional — falls back to in-memory store)
- **APIs & AI**: Google Places, Open-Meteo, Gemini AI API
- **Push Notifications**: Firebase Admin SDK

### Frontend (React Native / Expo)
- **Framework**: React Native via Expo
- **Navigation**: React Navigation (stack + bottom tabs)
- **State**: React Context (LiveContext, PlanContext)

## Project Structure

```
TravelMind-AI/
├── server/                   # Express.js backend
│   ├── config/               # Environment variables and config management
│   ├── middleware/            # Error handling and request middleware
│   ├── models/               # Mongoose schemas (User, Place, Notification, etc.)
│   ├── routes/               # Express route handlers for all endpoints
│   ├── services/             # Core business logic (weather, context, Gemini, decision engine)
│   ├── utils/                # Helper functions
│   └── server.js             # App entry point
└── AITravelAssistant/        # React Native / Expo mobile app
    ├── components/
    ├── context/
    ├── navigation/
    ├── screens/
    └── services/
```

## Setup & Execution

### Prerequisites

1. **Node.js** (v18+)
2. **MongoDB** — local (`mongodb://localhost:27017`) or a MongoDB Atlas URI
3. **Redis** (optional) — local on port 6379, or set `REDIS_URL`. Falls back to in-memory cache if unavailable.
4. API keys (see `server/.env.example`)

### Backend

```bash
cd server
npm install
cp .env.example .env   # fill in your API keys
npm start              # or: npm run dev (requires nodemon)
```

The API will be available at `http://localhost:8000`.

### Frontend

```bash
cd AITravelAssistant
npm install
npx expo start -c
```

Make sure `EXPO_PUBLIC_API_BASE_URL` in `AITravelAssistant/.env` points to your running backend (default: `http://127.0.0.1:8000`).

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | ✅ | MongoDB connection string |
| `GOOGLE_PLACES_API_KEY` | ✅ | Google Places API key |
| `GOOGLE_OAUTH_CLIENT_ID` | ✅ | Google OAuth client ID |
| `GOOGLE_OAUTH_CLIENT_SECRET` | ✅ | Google OAuth client secret |
| `GEMINI_API_KEY` | ✅ | Gemini AI API key |
| `REDIS_URL` | ❌ | Redis URL (falls back to in-memory) |
| `FCM_SERVICE_ACCOUNT_PATH` | ❌ | Path to Firebase service account JSON |

See [`server/.env.example`](server/.env.example) for the full list.

## License

This project is licensed under the MIT License.
