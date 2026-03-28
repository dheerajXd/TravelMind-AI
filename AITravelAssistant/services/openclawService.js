import { requestJson } from './apiClient';

export const fetchOpenClawStatus = async () => {
  return requestJson('/openclaw/status');
};

export const previewOpenClawContext = async ({
  userId,
  locationLabel,
  preferences,
  onboardingProfile,
  weather,
  schedule,
  freeTimeSummary,
  sources,
}) => {
  return requestJson('/openclaw/context-preview', {
    method: 'POST',
    body: {
      user_id: userId,
      location_label: locationLabel,
      preferences: preferences || {},
      onboarding_profile: onboardingProfile || {},
      weather: weather || {},
      schedule: schedule || [],
      free_time_summary: freeTimeSummary || null,
      sources: sources || {},
    },
  });
};

export const fetchOpenClawUserPreview = async ({
  userId,
  googleSessionId,
  gmailMaxResults,
  calendarMaxResults,
}) => {
  return requestJson('/openclaw/user-preview', {
    method: 'POST',
    body: {
      user_id: userId,
      google_session_id: googleSessionId || null,
      gmail_max_results: gmailMaxResults ?? 5,
      calendar_max_results: calendarMaxResults ?? 10,
    },
  });
};

export const fetchOpenClawUserBrief = async ({
  userId,
  googleSessionId,
  gmailMaxResults,
  calendarMaxResults,
}) => {
  return requestJson('/openclaw/user-brief', {
    method: 'POST',
    body: {
      user_id: userId,
      google_session_id: googleSessionId || null,
      gmail_max_results: gmailMaxResults ?? 5,
      calendar_max_results: calendarMaxResults ?? 10,
    },
  });
};
