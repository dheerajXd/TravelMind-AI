# TravelMind AI

**An AI-powered travel assistant for real-time, context-aware, and personalized recommendations.**

## Overview

TravelMind AI helps users make smarter travel decisions by combining live location, time of day, weather, schedule context, and personal preferences. It is designed to surface useful nearby suggestions, detect free-time opportunities, and keep travel planning adaptive and personalized.

## Features

### Context-Aware Recommendations
- Personalized suggestions based on location, time, weather, and user preferences
- Intelligent recommendation flow with explainable results
- Real-time nearby discovery using Google Places

### Smart Schedule Awareness
- Free-time detection from synced calendar events
- Contextual suggestions during idle or open time windows
- Dashboard assistant for quick decision support

### Personalized Experience
- Onboarding-driven preference collection
- Adaptive recommendation behavior based on saved context
- Support for plan management across screens

### Explore and Discovery
- Nearby and global place search
- Category-based discovery and filtering
- Dynamic recommendation and suggestion views

### Planning and Notifications
- Add places to plan and keep them synced across screens
- Backend notification system for context-aware triggers
- Location and session-aware notification support

### Live Travel Context
- Real-time location integration
- Weather-aware recommendation logic
- Gmail and Google Calendar integration for richer travel context

## Architecture

```text
[React Native (Expo) Frontend]
        |
        v
[FastAPI Backend]
        |
        +--> Context Engine
        +--> Recommendation Engine
        +--> OpenClaw Assistant Layer
        +--> Notification Service
        |
        +--> Google Places API
        +--> Weather API
        +--> Google Calendar / Gmail
        |
        v
[SQLite / Extended Backend Persistence]
```

## Tech Stack

### Frontend
- React Native
- Expo

### Backend
- FastAPI
- Python

### Integrations
- Google Places API
- Weather API
- Google Calendar API
- Gmail API

### Supporting Systems
- Context-aware recommendation engine
- Shared state plan management
- Notification backend services

## Setup Instructions

### Backend

```bash
cd app
pip install -r ../requirements.txt
uvicorn app.main:app --host 127.0.0.1 --port 8001 --reload
```

### Frontend

```bash
cd AITravelAssistant
npm install
npx expo start -c
```

### Environment

Create the required `.env` files for backend and frontend with your API keys and local configuration, including:
- Google Places API key
- Weather API key
- Google OAuth credentials
- Frontend API base URL

## Demo Flow

1. Launch the app and complete onboarding preferences.
2. Allow location access to enable real-time local recommendations.
3. Connect Google Calendar/Gmail to enrich schedule and travel context.
4. Explore nearby or global places through the Explore screen.
5. Add places to your plan and see updates reflected across the app.
6. Use the Dashboard assistant to review free-time suggestions and context-aware recommendations.
7. Trigger backend notifications when location and session context support a strong recommendation.

## Future Improvements

- Persistent structured user profile and learning history
- Stronger adaptive ranking based on interaction feedback
- Native push notification delivery testing and rollout
- More robust trip timeline generation and trip history views
- Enhanced assistant reasoning and multi-option comparisons
- Production deployment configuration and monitoring

## Contributors

- Dheeraj D
- Mohan Sashank
- Eswar Vardhan
- Lalith Madhav

## License

This project is licensed under the MIT License.
