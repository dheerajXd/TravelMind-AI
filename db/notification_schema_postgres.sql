CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY,
    name TEXT,
    email TEXT UNIQUE,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_notification_settings (
    user_id UUID PRIMARY KEY REFERENCES users(id),
    notifications_enabled BOOLEAN DEFAULT TRUE,
    radius_km FLOAT DEFAULT 2,
    quiet_hours_start TIME,
    quiet_hours_end TIME,
    max_per_day INT DEFAULT 3,
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_sessions (
    user_id UUID PRIMARY KEY REFERENCES users(id),
    last_location_lat DOUBLE PRECISION,
    last_location_lng DOUBLE PRECISION,
    last_active TIMESTAMP,
    current_intent TEXT,
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS places (
    id TEXT PRIMARY KEY,
    name TEXT,
    type TEXT,
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    rating FLOAT,
    price_level INT,
    open_now BOOLEAN,
    updated_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_places_geo
ON places
USING GIST (geography(ST_MakePoint(longitude, latitude)));

CREATE TABLE IF NOT EXISTS user_profile (
    user_id UUID REFERENCES users(id),
    category TEXT,
    score FLOAT,
    PRIMARY KEY (user_id, category)
);

CREATE TABLE IF NOT EXISTS notifications (
    id SERIAL PRIMARY KEY,
    user_id UUID REFERENCES users(id),
    place_id TEXT REFERENCES places(id),
    type TEXT,
    title TEXT,
    message TEXT,
    sent_at TIMESTAMP DEFAULT NOW(),
    clicked BOOLEAN DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS notification_history (
    user_id UUID REFERENCES users(id),
    place_id TEXT REFERENCES places(id),
    last_sent TIMESTAMP,
    PRIMARY KEY (user_id, place_id)
);

CREATE TABLE IF NOT EXISTS notification_queue (
    id SERIAL PRIMARY KEY,
    user_id UUID REFERENCES users(id),
    place_id TEXT REFERENCES places(id),
    type TEXT,
    score FLOAT,
    status TEXT DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS device_tokens (
    user_id UUID REFERENCES users(id),
    token TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    PRIMARY KEY (user_id, token)
);

CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notification_history_user ON notification_history(user_id);
CREATE INDEX IF NOT EXISTS idx_user_profile_user ON user_profile(user_id);
CREATE INDEX IF NOT EXISTS idx_places_open ON places(open_now);
