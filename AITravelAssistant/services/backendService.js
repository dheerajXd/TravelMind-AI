import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { getApiBaseUrl, requestJson } from './apiClient';

const USER_ID_KEY = 'ai_travel_user_id';
const SAVED_PLAN_KEY = 'ai_travel_saved_plan_items';
const NOTIFICATIONS_ENABLED_KEY = 'ai_travel_notifications_enabled';

const buildUserId = () => `mobile-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

export const getOrCreateUserId = async () => {
  const existing = await getStoredValue(USER_ID_KEY);
  if (existing) {
    return existing;
  }

  const created = buildUserId();
  await setStoredValue(USER_ID_KEY, created);
  return created;
};

export const checkBackendHealth = async () => {
  return requestJson('/health');
};

export const getBackendUrl = () => getApiBaseUrl();

const getStoredValue = async (key) => {
  if (Platform.OS === 'web') {
    return window.localStorage.getItem(key);
  }
  return SecureStore.getItemAsync(key);
};

const setStoredValue = async (key, value) => {
  if (Platform.OS === 'web') {
    window.localStorage.setItem(key, value);
    return;
  }
  await SecureStore.setItemAsync(key, value);
};

const getStoredJson = async (key, fallback = []) => {
  try {
    const rawValue = await getStoredValue(key);
    if (!rawValue) return fallback;
    return JSON.parse(rawValue);
  } catch (error) {
    console.warn('Stored JSON parse failed:', error);
    return fallback;
  }
};

export const storeTravelContext = async ({
  userId,
  latitude,
  longitude,
  inferredTripType,
  vibe,
  budget,
  cuisinePreference,
  activityPreference,
  priority,
}) => {
  return requestJson('/context', {
    method: 'POST',
    body: {
      user_id: userId,
      location: {
        coordinates: {
          lat: latitude,
          lng: longitude,
        },
      },
      time: new Date().toISOString(),
      preferences: {
        vibe,
        budget,
        food: inferredTripType === 'business' ? ['coffee', 'quick bites'] : ['local cuisine', 'coffee'],
      },
      onboarding_profile: {
        cuisine_preference: cuisinePreference,
        free_time_preference: activityPreference,
        decision_priority: priority,
        notification_style: 'proactive',
      },
      trip_details: {
        purpose: inferredTripType,
        travelers: 1,
        notes:
          inferredTripType === 'business'
            ? 'Optimize for productivity, quick meals, and reliable work-friendly spaces.'
            : 'Optimize for local experiences, relaxed cafes, and memorable food stops.',
      },
    },
  });
};

export const fetchSmartSuggestions = async ({
  userId,
  inferredTripType,
  activityPreference,
  cuisinePreference,
  googleSessionId,
}) => {
  return requestJson('/smart-suggestions', {
    params: {
      user_id: userId,
      type: pickPrimaryPlaceType({
        inferredTripType,
        activityPreference,
        cuisinePreference,
      }),
      radius: 2500,
      google_session_id: googleSessionId,
    },
  });
};

const pickPrimaryPlaceType = ({
  inferredTripType,
  activityPreference,
  cuisinePreference,
}) => {
  const normalizedCuisine = cuisinePreference?.toLowerCase?.() || '';

  if (activityPreference === 'coffee' || normalizedCuisine === 'cafe') {
    return 'cafe';
  }
  if (activityPreference === 'work spot') {
    return normalizedCuisine === 'cafe' ? 'cafe' : 'coworking';
  }
  if (activityPreference === 'sightseeing') {
    return 'attraction';
  }
  if (normalizedCuisine === 'quick bites' || normalizedCuisine === 'street food') {
    return 'quick bites';
  }
  if (normalizedCuisine === 'veg') {
    return 'vegetarian restaurant';
  }
  if (normalizedCuisine === 'south indian') {
    return 'south indian restaurant';
  }
  if (normalizedCuisine === 'italian') {
    return 'italian restaurant';
  }
  if (normalizedCuisine === 'chinese') {
    return 'chinese restaurant';
  }
  return inferredTripType === 'business' ? 'coworking' : 'restaurant';
};

// ---------- Hero place ----------

export const fetchNearbyHeroPlace = async (lat, lng) => {
  try {
    const data = await requestJson('/places/nearby', {
      params: { lat, lng, type: 'tourist_attraction', radius: 3000 },
    });
    const results = data?.results || data?.places || [];
    if (results.length === 0) return null;
    const place = results[0];
    return {
      name: place.name,
      address: place.vicinity || place.formatted_address || '',
      photo_url: place.photo_url || null,
    };
  } catch {
    return null;
  }
};

// ---------- Google Calendar / Gmail ----------

const GOOGLE_SESSION_KEY = 'google_oauth_session_id';

export const getGoogleSessionId = async () => {
  return getStoredValue(GOOGLE_SESSION_KEY);
};

export const saveGoogleSessionId = async (sessionId) => {
  await setStoredValue(GOOGLE_SESSION_KEY, sessionId);
};

export const clearGoogleSessionId = async () => {
  if (Platform.OS === 'web') {
    window.localStorage.removeItem(GOOGLE_SESSION_KEY);
    return;
  }
  await SecureStore.deleteItemAsync(GOOGLE_SESSION_KEY);
};

export const getGoogleLoginUrl = () => {
  return `${getApiBaseUrl()}/auth/google/login`;
};

export const fetchCalendarEvents = async (sessionId) => {
  return requestJson('/calendar/events', {
    params: { session_id: sessionId, max_results: 10 },
  });
};

export const fetchGmailMessages = async (sessionId, maxResults = 5) => {
  return requestJson('/gmail/messages', {
    params: { session_id: sessionId, max_results: maxResults },
  });
};

export const fetchUserContext = async (userId) => {
  return requestJson(`/context/${encodeURIComponent(userId)}`);
};

export const fetchGoogleProfile = async (sessionId) => {
  return requestJson('/auth/google/me', {
    params: { session_id: sessionId },
  });
};

export const getPlannedItems = async () => {
  const items = await getStoredJson(SAVED_PLAN_KEY, []);
  return Array.isArray(items) ? items : [];
};

export const togglePlannedItem = async (item) => {
  const existingItems = await getPlannedItems();
  const existingIndex = existingItems.findIndex((entry) => entry.id === item.id);

  if (existingIndex >= 0) {
    const nextItems = existingItems.filter((entry) => entry.id !== item.id);
    await setStoredValue(SAVED_PLAN_KEY, JSON.stringify(nextItems));
    return {
      saved: false,
      items: nextItems,
    };
  }

  const nextItem = {
    ...item,
    saved_at: new Date().toISOString(),
  };
  const nextItems = [nextItem, ...existingItems];
  await setStoredValue(SAVED_PLAN_KEY, JSON.stringify(nextItems));
  return {
    saved: true,
    items: nextItems,
  };
};

export const clearPlannedItems = async () => {
  if (Platform.OS === 'web') {
    window.localStorage.removeItem(SAVED_PLAN_KEY);
    return;
  }
  await SecureStore.deleteItemAsync(SAVED_PLAN_KEY);
};

export const getNotificationsEnabled = async () => {
  const stored = await getStoredValue(NOTIFICATIONS_ENABLED_KEY);
  if (stored == null) return true;
  return stored === 'true';
};

export const setNotificationsEnabled = async (enabled) => {
  await setStoredValue(NOTIFICATIONS_ENABLED_KEY, String(Boolean(enabled)));
};

export const clearLocalProfileState = async () => {
  await clearGoogleSessionId();
  if (Platform.OS === 'web') {
    window.localStorage.removeItem(USER_ID_KEY);
    return;
  }
  await SecureStore.deleteItemAsync(USER_ID_KEY);
};
