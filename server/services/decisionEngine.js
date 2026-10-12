const { searchPlaces } = require('./placesService');

const haversineMeters = (lat1, lng1, lat2, lng2) => {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLng/2) * Math.sin(dLng/2);
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
};

const friendlyCategory = (types) => {
  const normalized = types.map(t => t.toLowerCase());
  if (normalized.some(t => ['cafe', 'bakery'].includes(t))) return "Cafe";
  if (normalized.some(t => ['restaurant', 'meal_takeaway', 'meal_delivery'].includes(t))) return "Food";
  if (normalized.some(t => ['park', 'museum', 'tourist_attraction', 'attraction'].includes(t))) return "Explore";
  if (normalized.some(t => ['coworking', 'library'].includes(t))) return "Work";
  return "Nearby";
};

const buildContext = (userId, storedContext, weather, gmailContext, calendarContext) => {
  return {
    user_id: userId,
    location: storedContext.location || {},
    preferences: storedContext.preferences || {},
    onboarding_profile: storedContext.onboarding_profile || {},
    time: storedContext.time,
    trip_details: storedContext.trip_details || null,
    learning_state: storedContext.learning_state || {},
    weather: weather || {},
    gmail_context: gmailContext,
    calendar_context: calendarContext,
  };
};

const categoryPlan = (context, requestedType) => {
  const preferences = context.preferences || {};
  const onboardingProfile = context.onboarding_profile || {};
  const activity = String(context.intent || onboardingProfile.free_time_preference || "").toLowerCase();
  const cuisine = String(onboardingProfile.cuisine_preference || "").toLowerCase();

  const planned = [requestedType];
  
  if (activity === "food" || activity === "quick_meal") {
    planned.push("restaurant");
    if (cuisine) planned.push(cuisine);
  } else if (activity === "coffee" || activity === "cafe") {
    planned.push("cafe", "bakery");
  } else if (activity === "work") {
    planned.push("coworking", "cafe");
  } else if (activity === "explore") {
    planned.push("attraction", "museum", "park");
  } else {
    planned.push("restaurant", "cafe", "attraction");
  }

  const deduped = [];
  for (const item of planned) {
    const norm = String(item || "").trim().toLowerCase();
    if (norm && !deduped.includes(norm)) deduped.push(norm);
  }
  return deduped.slice(0, 5);
};

const fetchCandidatePlaces = async (context, requestedType, radius) => {
  const location = context.location || {};
  const coordinates = location.coordinates || {};
  const plan = categoryPlan(context, requestedType);
  
  const tasks = plan.map(category => searchPlaces({
    lat: coordinates.lat,
    lng: coordinates.lng,
    city: location.city,
    type: category,
    radius
  }));

  const results = await Promise.allSettled(tasks);
  
  const merged = [];
  const seen = new Set();
  
  for (const result of results) {
    if (result.status === 'fulfilled') {
      for (const place of result.value) {
        const key = `${place.id || place.name}|${place.address}`;
        if (!seen.has(key)) {
          seen.add(key);
          merged.push(place);
        }
      }
    }
  }
  return merged;
};

const rankPlaces = (context, places, radius) => {
  const coordinates = context.location?.coordinates;
  const scored = places.map(place => {
    let distance = Infinity;
    if (coordinates && coordinates.lat && coordinates.lng && place.lat && place.lng) {
      distance = haversineMeters(coordinates.lat, coordinates.lng, place.lat, place.lng);
    }
    const distanceScore = distance < radius ? 1 : 0;
    const ratingScore = (place.rating || 0) / 5;
    const openScore = place.open_now ? 1 : 0;
    
    return {
      place,
      score: (ratingScore * 0.4) + (openScore * 0.4) + (distanceScore * 0.2),
      distance
    };
  });
  
  scored.sort((a, b) => b.score - a.score);
  return scored.map(s => ({
    ...s.place,
    distance_meters: s.distance === Infinity ? null : Math.round(s.distance)
  }));
};

const toRecommendationItems = (rankedPlaces) => {
  return rankedPlaces.slice(0, 4).map((candidate, index) => ({
    title: String(candidate.name || "Nearby recommendation"),
    reason: candidate.open_now ? "Hours look favorable right now." : "Strong nearby fit for the current moment.",
    type: friendlyCategory(candidate.types).toLowerCase(),
    priority: index + 1,
    google_rating: candidate.rating,
    place_address: candidate.address || null,
  }));
};

const toNearbyMatchItems = (places, context) => {
  const coordinates = context.location?.coordinates;
  return places.slice(0, 6).map(place => {
    let distanceMeters = null, walkEta = null, driveEta = null;
    if (coordinates && coordinates.lat && coordinates.lng && place.lat && place.lng) {
      distanceMeters = Math.round(haversineMeters(coordinates.lat, coordinates.lng, place.lat, place.lng));
      walkEta = Math.max(1, Math.round(distanceMeters / 80));
      driveEta = Math.max(1, Math.round(distanceMeters / 350));
    }
    return {
      name: place.name,
      google_rating: place.rating,
      address: place.address,
      category: friendlyCategory(place.types || []),
      open_now: place.open_now,
      distance_meters: distanceMeters,
      walk_eta_minutes: walkEta,
      drive_eta_minutes: driveEta,
    };
  });
};

const generateRecommendations = async ({ userId, storedContext, requestedType, radius, weather, gmailContext = null, calendarContext = null }) => {
  const context = buildContext(userId, storedContext, weather, gmailContext, calendarContext);
  let places = await fetchCandidatePlaces(context, requestedType, radius);
  let rankedPlaces = rankPlaces(context, places, radius);

  if (rankedPlaces.length === 0) {
    const broaderRadius = Math.min(radius * 2, 10000);
    places = await fetchCandidatePlaces(context, "popular places", broaderRadius);
    rankedPlaces = rankPlaces(context, places, broaderRadius);
  }

  return {
    context,
    raw_places: places,
    ranked_places: rankedPlaces,
    recommendations: toRecommendationItems(rankedPlaces),
    nearby_matches: toNearbyMatchItems(places, context),
  };
};

const applyFeedback = async ({ userId, storedContext, weather, action, place, gmailContext = null, calendarContext = null }) => {
  // TODO: update user learning state in DB based on feedback action, place, and context
  return buildContext(userId, storedContext, weather, gmailContext, calendarContext);
};

module.exports = { generateRecommendations, applyFeedback };
