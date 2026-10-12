const axios = require('axios');
const config = require('../config/config');

class GeminiService {
  constructor() {
    this.apiKey = config.geminiApiKey;
    this.baseUrl = config.geminiBaseUrl;
    this.timeout = config.geminiTimeoutSeconds;
    this.model = config.geminiModel;
  }

  async generateRecommendations(payload) {
    if (!this.apiKey) {
      const err = new Error("Gemini API key is not configured.");
      err.statusCode = 500;
      throw err;
    }

    const body = {
      contents: [
        {
          parts: [
            { text: this.buildPrompt(payload) }
          ]
        }
      ],
      generationConfig: {
        temperature: 0.2,
        responseMimeType: "application/json",
      }
    };

    let response;
    try {
      response = await axios.post(`${this.baseUrl}/${this.model}:generateContent`, body, {
        params: { key: this.apiKey },
        timeout: this.timeout * 1000,
      });
    } catch (error) {
      if (error.code === 'ECONNABORTED') {
        const err = new Error("Gemini error: request timed out.");
        err.statusCode = 504;
        throw err;
      }
      if (error.response) {
        const err = new Error(`Gemini error: HTTP ${error.response.status}`);
        err.statusCode = error.response.status;
        throw err;
      }
      const err = new Error("Gemini error: network error while generating recommendations.");
      err.statusCode = 502;
      throw err;
    }

    const rawJson = this.extractJsonText(response.data);
    let parsed;
    try {
      parsed = JSON.parse(rawJson);
    } catch (e) {
      const err = new Error("Gemini returned invalid JSON.");
      err.statusCode = 502;
      throw err;
    }

    return this.enrichWithPlaceDetails(parsed, payload.places || []);
  }

  buildPrompt(payload) {
    return (
      "You are an AI travel assistant reasoning engine. Analyze the user's travel context, " +
      "live weather, and nearby places together. Prefer options that match the user's vibe, " +
      "budget, timing, trip purpose, and current weather. Rank the best options. " +
      "Avoid repetitive suggestions that are all the same venue pattern. Prefer a diverse mix " +
      "such as one quick meal option, one cafe/work option, one nearby experience, and one wildcard when possible. " +
      "Do not fill the list with near-identical restaurants unless there are truly no better alternatives. " +
      "Favor concise, useful reasons that mention why the option fits right now. " +
      "Prioritize places that appear open now when the current time suggests immediate action, but do not state " +
      "that a venue is definitely open unless the place data explicitly confirms it. If hours are uncertain, say that " +
      "hours should be verified. Avoid hotel-like properties unless they clearly match the user's intent. " +
      "Do not return prose outside JSON.\n\n" +
      "Return strictly valid JSON with this schema:\n" +
      '{\n  "recommendations": [\n    {\n      "title": "string",\n      "reason": "string",\n' +
      '      "type": "cafe | restaurant | activity",\n      "priority": 1\n    }\n  ]\n}\n\n' +
      `User context:\n${JSON.stringify(payload.user_context, null, 2)}\n\n` +
      `Weather:\n${JSON.stringify(payload.weather, null, 2)}\n\n` +
      `Places:\n${JSON.stringify(payload.places, null, 2)}\n\n` +
      `Gmail context:\n${JSON.stringify(payload.gmail_context || {}, null, 2)}\n\n` +
      `Calendar context:\n${JSON.stringify(payload.calendar_context || {}, null, 2)}\n\n` +
      "Create 4 concise recommendations when the place data allows it. Priority 1 is the best option. " +
      "Reasons must explain the combined reasoning using preferences, weather, place attributes, and any useful schedule or email signals when present. " +
      "At least two recommendations should feel meaningfully different in use-case whenever the place data allows it. " +
      "Do not recommend the same place twice. Do not give more than one recommendation from the same hotel/property family. " +
      "When appropriate, naturally include signals like 'hours look favorable', 'good for a quick dinner', " +
      "'good for a short gap between meetings', 'quiet work-friendly option', or 'good nearby experience' inside the reason " +
      "so the UI can surface those as badges. Never invent opening status."
    );
  }

  extractJsonText(responseData) {
    const candidates = responseData.candidates || [];
    if (candidates.length === 0) {
      const err = new Error("Gemini returned no candidates.");
      err.statusCode = 502;
      throw err;
    }

    const parts = (candidates[0].content && candidates[0].content.parts) || [];
    if (parts.length === 0) {
      const err = new Error("Gemini returned empty content.");
      err.statusCode = 502;
      throw err;
    }

    let text = (parts[0].text || "").trim();
    if (text.startsWith("```")) {
      text = text.replace(/^```(json)?/, '').replace(/```$/, '').trim();
    }
    return text;
  }

  enrichWithPlaceDetails(response, places) {
    const enriched = [];
    for (const recommendation of (response.recommendations || [])) {
      const match = this.matchPlace(recommendation.title, places);
      if (match) {
        recommendation.google_rating = match.rating;
        recommendation.place_address = match.address;
      }
      enriched.push(recommendation);
    }
    return { recommendations: enriched };
  }

  matchPlace(title, places) {
    const normalizedTitle = this.normalizeName(title);
    for (const place of places) {
      if (this.normalizeName(place.name || "") === normalizedTitle) {
        return place;
      }
    }
    for (const place of places) {
      const normalizedPlace = this.normalizeName(place.name || "");
      if (normalizedTitle && (normalizedTitle.includes(normalizedPlace) || normalizedPlace.includes(normalizedTitle))) {
        return place;
      }
    }
    return null;
  }

  normalizeName(value) {
    return value.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
  }
}

module.exports = new GeminiService();
