const express = require('express');
const { getContext } = require('../services/contextService');
const { getWeather } = require('../services/weatherService');
const { listUpcomingEvents } = require('../services/calendarService');
const { listMessages } = require('../services/gmailService');
const { generateRecommendations, applyFeedback } = require('../services/decisionEngine');

const router = express.Router();

const loadDependencies = async (storedContext, googleSessionId) => {
  const coordinates = storedContext.location?.coordinates;
  const weatherQuery = coordinates 
    ? { lat: coordinates.lat, lng: coordinates.lng }
    : { location: storedContext.location?.city };

  let weather = {};
  try {
    weather = await getWeather(weatherQuery);
  } catch (e) {
    console.warn("Weather fetch failed in smart load dependencies", e);
  }

  let gmailContext = null;
  let calendarContext = null;

  if (googleSessionId) {
    try {
      const [gmailData, calendarData] = await Promise.all([
        listMessages({ sessionId: googleSessionId, maxResults: 5 }),
        listUpcomingEvents({ sessionId: googleSessionId, maxResults: 5 })
      ]);
      gmailContext = {
        recent_messages: gmailData.messages || [],
        result_size_estimate: gmailData.resultSizeEstimate || 0,
      };
      calendarContext = {
        upcoming_events: calendarData.events || [],
      };
    } catch (e) {
      console.warn("Google API fetch failed in smart load dependencies", e);
    }
  }

  return { weather, gmailContext, calendarContext };
};

const buildProactiveTriggers = (context, weather, calendarContext) => {
  const triggers = [];
  const currentTime = context.time ? new Date(context.time) : new Date();
  const hour = currentTime.getHours();

  if (hour >= 7 && hour < 11) triggers.push("Morning window detected: good time for coffee or a quick breakfast stop.");
  else if (hour >= 12 && hour < 15) triggers.push("Lunch window detected: nearby food picks are especially relevant right now.");
  else if (hour >= 18 && hour < 22) triggers.push("Evening free time detected: good moment for dinner, coffee, or a short outing nearby.");
  else if (hour >= 22 || hour < 6) triggers.push("Late-hour context detected: open-now places should be prioritized before longer outings.");

  const condition = String(weather?.condition || "").toLowerCase();
  const temperature = weather?.temperature;
  if (['clear', 'mostly clear'].includes(condition) && temperature >= 20 && temperature <= 30) {
    triggers.push("Weather looks comfortable for a short walk or nearby stop.");
  }

  // Simplified calendar check
  if (!calendarContext || !calendarContext.upcoming_events || calendarContext.upcoming_events.length === 0) {
    triggers.push("No near-term calendar block found, so broader nearby options can be suggested.");
  } else {
    triggers.push("You have upcoming events on your calendar.");
  }

  return triggers.slice(0, 3);
};

router.get('/smart-suggestions', async (req, res, next) => {
  try {
    const { user_id, type = 'explore', radius = 5000, google_session_id } = req.query;
    if (!user_id) return res.status(422).json({ detail: "user_id is required" });

    const storedContext = await getContext(user_id);
    if (!storedContext) {
      return res.status(404).json({ detail: "Context not found for user. Submit /context first." });
    }

    const { weather, gmailContext, calendarContext } = await loadDependencies(storedContext, google_session_id);

    const decision = await generateRecommendations({
      userId: user_id,
      storedContext,
      requestedType: type,
      radius: parseInt(radius),
      weather,
      gmailContext,
      calendarContext
    });

    res.json({
      recommendations: decision.recommendations,
      nearby_matches: decision.nearby_matches,
      proactive_triggers: buildProactiveTriggers(storedContext, weather, calendarContext)
    });
  } catch (error) {
    next(error);
  }
});

router.post('/smart-feedback', async (req, res, next) => {
  try {
    const { user_id, action, place } = req.body;
    if (!user_id) return res.status(422).json({ detail: "user_id is required" });

    const storedContext = await getContext(user_id);
    if (!storedContext) {
      return res.status(404).json({ detail: "Context not found for user. Submit /context first." });
    }

    const coordinates = storedContext.location?.coordinates;
    const weatherQuery = coordinates 
      ? { lat: coordinates.lat, lng: coordinates.lng }
      : { location: storedContext.location?.city };
    
    let weather = {};
    try { weather = await getWeather(weatherQuery); } catch (e) {}

    await applyFeedback({
      userId: user_id,
      storedContext,
      weather,
      action,
      place
    });

    res.json({ message: "Feedback stored successfully.", learning_state_updated: true });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
