import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { getApiBaseUrl, requestJson } from './apiClient';

const USER_ID_KEY = 'ai_travel_user_id';

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
  if (activityPreference === 'coffee' || cuisinePreference === 'cafe') {
    return 'cafe';
  }
  if (activityPreference === 'work spot') {
    return cuisinePreference === 'cafe' ? 'cafe' : 'coworking';
  }
  if (activityPreference === 'sightseeing') {
    return 'attraction';
  }
  if (cuisinePreference === 'quick bites') {
    return 'quick bites';
  }
  if (cuisinePreference === 'veg') {
    return 'vegetarian restaurant';
  }
  return inferredTripType === 'business' ? 'coworking' : 'restaurant';
};
