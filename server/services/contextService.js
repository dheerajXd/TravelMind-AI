const User = require('../models/User');

const deriveCurrentIntent = (payload) => {
  const profile = payload.onboarding_profile || {};
  if (profile.free_time_preference) {
    return String(profile.free_time_preference);
  }
  const tripDetails = payload.trip_details;
  if (tripDetails && tripDetails.purpose) {
    return String(tripDetails.purpose);
  }
  return null;
};

const profileScores = (payload) => {
  const scores = {};
  const preferences = payload.preferences || {};
  const onboardingProfile = payload.onboarding_profile || {};

  const vibe = preferences.vibe;
  const budget = preferences.budget;
  const cuisine = onboardingProfile.cuisine_preference;
  const activity = onboardingProfile.free_time_preference;
  const priority = onboardingProfile.decision_priority;

  if (vibe) scores[`vibe:${String(vibe).toLowerCase()}`] = 0.8;
  if (budget) scores[`budget:${String(budget).toLowerCase()}`] = 0.7;
  if (cuisine) scores[`cuisine:${String(cuisine).toLowerCase()}`] = 0.9;
  if (activity) scores[`activity:${String(activity).toLowerCase()}`] = 0.85;
  if (priority) scores[`priority:${String(priority).toLowerCase()}`] = 0.6;

  const activityValue = String(activity || '').toLowerCase();
  const cuisineValue = String(cuisine || '').toLowerCase();
  const purposeValue = String(payload.trip_details?.purpose || '').toLowerCase();

  if (activityValue === 'food') {
    scores['restaurant'] = 0.95;
    scores['cafe'] = 0.75;
  } else if (activityValue === 'coffee') {
    scores['cafe'] = 0.95;
    scores['restaurant'] = 0.55;
  } else if (activityValue === 'work spot') {
    scores['cafe'] = 0.7;
    scores['coworking'] = 0.95;
  } else if (activityValue === 'sightseeing') {
    scores['attraction'] = 0.95;
    scores['museum'] = 0.8;
    scores['park'] = 0.7;
  } else if (activityValue === 'relax') {
    scores['park'] = 0.9;
    scores['cafe'] = 0.65;
  }

  if (cuisineValue) {
    scores['restaurant'] = Math.max(scores['restaurant'] || 0.0, 0.85);
    if (cuisineValue === 'cafe') {
      scores['cafe'] = Math.max(scores['cafe'] || 0.0, 0.95);
    }
  }

  if (purposeValue === 'business') {
    scores['coworking'] = Math.max(scores['coworking'] || 0.0, 0.9);
    scores['cafe'] = Math.max(scores['cafe'] || 0.0, 0.65);
  } else if (purposeValue === 'leisure') {
    scores['attraction'] = Math.max(scores['attraction'] || 0.0, 0.75);
    scores['park'] = Math.max(scores['park'] || 0.0, 0.7);
  }

  return Object.entries(scores).map(([category, score]) => ({ category, score }));
};

const saveContext = async (payload) => {
  const coordinates = payload.location?.coordinates;
  const currentIntent = deriveCurrentIntent(payload);
  const profile = profileScores(payload);

  const user = await User.findByIdAndUpdate(
    payload.user_id,
    {
      $set: {
        'context.payload': payload,
        'context.updatedAt': new Date(),
        'session.lastLocationLat': coordinates?.lat || null,
        'session.lastLocationLng': coordinates?.lng || null,
        'session.currentIntent': currentIntent,
        'session.updatedAt': new Date(),
        'profile': profile,
      },
    },
    { new: true, upsert: true }
  );

  return payload;
};

const getContext = async (userId) => {
  const user = await User.findById(userId);
  if (!user || !user.context || !user.context.payload) {
    return null;
  }
  return user.context.payload;
};

module.exports = {
  saveContext,
  getContext,
};
