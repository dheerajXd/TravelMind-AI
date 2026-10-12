const axios = require('axios');
const config = require('../config/config');
const { TTLCache, makeCacheKey } = require('../utils/helpers');

const weatherCache = new TTLCache(config.cacheTtlSeconds || 300);

const raiseUpstreamError = (provider, detail, statusCode = 502) => {
  const error = new Error(`${provider} error: ${detail}`);
  error.statusCode = statusCode;
  throw error;
};

const mapWeatherCode = (code) => {
  const codes = {
    0: "Clear", 1: "Mostly Clear", 2: "Partly Cloudy", 3: "Cloudy",
    45: "Fog", 48: "Rime Fog", 51: "Light Drizzle", 53: "Drizzle",
    55: "Heavy Drizzle", 61: "Light Rain", 63: "Rain", 65: "Heavy Rain",
    71: "Light Snow", 73: "Snow", 75: "Heavy Snow", 80: "Rain Showers",
    81: "Rain Showers", 82: "Heavy Showers", 95: "Thunderstorm",
    96: "Thunderstorm", 99: "Thunderstorm",
  };
  return codes[code] || "Unknown";
};

const geocodeLocation = async (location) => {
  try {
    const response = await axios.get(`${config.openmeteoGeocodingBaseUrl}/search`, {
      params: { name: location, count: 1, language: 'en', format: 'json' },
      timeout: config.requestTimeoutSeconds * 1000,
    });
    const results = response.data.results || [];
    if (results.length === 0) {
      const err = new Error("Open-Meteo error: location not found.");
      err.statusCode = 404;
      throw err;
    }
    const first = results[0];
    return { latitude: first.latitude, longitude: first.longitude, city: first.name };
  } catch (error) {
    if (error.statusCode) throw error;
    if (error.code === 'ECONNABORTED') raiseUpstreamError('Open-Meteo', 'geocoding request timed out.', 504);
    if (error.response) raiseUpstreamError('Open-Meteo', `geocoding HTTP ${error.response.status}`, error.response.status);
    raiseUpstreamError('Open-Meteo', 'network error while geocoding location.');
  }
};

const getWeather = async (query) => {
  const cacheKey = makeCacheKey('weather', { location: query.location, lat: query.lat, lng: query.lng });
  const cached = weatherCache.get(cacheKey);
  if (cached) return cached;

  let latitude = query.lat;
  let longitude = query.lng;
  let city = query.location;

  if (query.location && (query.lat === undefined || query.lng === undefined || query.lat === null || query.lng === null)) {
    const geocoded = await geocodeLocation(query.location);
    latitude = geocoded.latitude;
    longitude = geocoded.longitude;
    city = geocoded.city;
  }

  let response;
  try {
    response = await axios.get(`${config.openweatherBaseUrl}/forecast`, {
      params: {
        latitude,
        longitude,
        current: "temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code",
        timezone: "auto",
      },
      timeout: config.requestTimeoutSeconds * 1000,
    });
  } catch (error) {
    if (error.code === 'ECONNABORTED') raiseUpstreamError('Open-Meteo', 'request timed out.', 504);
    if (error.response) {
      const detail = error.response.status === 404 ? 'location not found.' : `HTTP ${error.response.status}`;
      raiseUpstreamError('Open-Meteo', detail, error.response.status);
    }
    raiseUpstreamError('Open-Meteo', 'network error while fetching weather.');
  }

  const current = response.data.current;
  const result = {
    temperature: parseFloat(current.temperature_2m.toFixed(1)),
    condition: mapWeatherCode(current.weather_code),
    humidity: current.relative_humidity_2m,
    wind_speed: parseFloat(current.wind_speed_10m.toFixed(1)),
    city,
  };

  weatherCache.set(cacheKey, result);
  return result;
};

module.exports = { getWeather };
