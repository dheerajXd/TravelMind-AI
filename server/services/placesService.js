const axios = require('axios');
const config = require('../config/config');
const { TTLCache, makeCacheKey, buildLocationString } = require('../utils/helpers');

const placesCache = new TTLCache(config.cacheTtlSeconds || 300);

const raiseUpstreamError = (provider, detail, statusCode = 502) => {
  const error = new Error(`${provider} error: ${detail}`);
  error.statusCode = statusCode;
  throw error;
};

const buildRequest = (query) => {
  const coordinates = buildLocationString(query.lat, query.lng);
  if (coordinates) {
    return {
      endpoint: `${config.googlePlacesBaseUrl}/nearbysearch/json`,
      params: {
        location: coordinates,
        radius: query.radius,
        keyword: query.type,
        key: config.googlePlacesApiKey,
      }
    };
  }
  return {
    endpoint: `${config.googlePlacesBaseUrl}/textsearch/json`,
    params: {
      query: `${query.type} in ${query.location}`,
      key: config.googlePlacesApiKey,
    }
  };
};

const serializePlace = (place) => {
  let photoReference = null;
  const photos = place.photos || [];
  if (photos.length > 0) {
    photoReference = photos[0].photo_reference;
  }

  return {
    id: place.place_id,
    name: place.name || 'Unknown',
    rating: place.rating,
    address: place.vicinity || place.formatted_address || 'Address unavailable',
    open_now: (place.opening_hours || {}).open_now,
    types: place.types || [],
    photo_url: photoReference ? `/places/photo?photo_reference=${photoReference}` : null,
    lat: ((place.geometry || {}).location || {}).lat,
    lng: ((place.geometry || {}).location || {}).lng,
  };
};

const serializeReverseGeocode = (results) => {
  const components = {};
  for (const result of results) {
    for (const component of (result.address_components || [])) {
      const longName = component.long_name;
      for (const compType of (component.types || [])) {
        if (longName && !components[compType]) {
          components[compType] = longName;
        }
      }
    }
  }

  const city = components.locality || components.sublocality_level_1 || components.administrative_area_level_3 || components.administrative_area_level_2;
  const region = components.administrative_area_level_2 || components.administrative_area_level_1;
  const country = components.country;

  const labelParts = [];
  if (city) labelParts.push(city);
  if (region && region !== city) labelParts.push(region);

  const label = labelParts.length > 0 ? labelParts.join(', ') : (country || 'Nearby area');

  return {
    label,
    city,
    region,
    country,
  };
};

const searchPlaces = async (query) => {
  if (!config.googlePlacesApiKey) {
    const err = new Error("Google Places API key is not configured.");
    err.statusCode = 500;
    throw err;
  }

  const cacheKey = makeCacheKey('places', { location: query.location, lat: query.lat, lng: query.lng, type: query.type, radius: query.radius });
  const cached = placesCache.get(cacheKey);
  if (cached) return cached;

  const { endpoint, params } = buildRequest(query);

  let response;
  try {
    response = await axios.get(endpoint, {
      params,
      timeout: config.requestTimeoutSeconds * 1000,
    });
  } catch (error) {
    if (error.code === 'ECONNABORTED') raiseUpstreamError('Google Places', 'request timed out.', 504);
    if (error.response) raiseUpstreamError('Google Places', `HTTP ${error.response.status}`);
    raiseUpstreamError('Google Places', 'network error while fetching places.');
  }

  const payload = response.data;
  const apiStatus = payload.status;
  if (apiStatus !== 'OK' && apiStatus !== 'ZERO_RESULTS') {
    raiseUpstreamError('Google Places', payload.error_message || apiStatus || 'unknown error');
  }

  const results = (payload.results || []).map(serializePlace);
  placesCache.set(cacheKey, results);
  return results;
};

const reverseGeocode = async (query) => {
  if (!config.googlePlacesApiKey) {
    const err = new Error("Google Places API key is not configured.");
    err.statusCode = 500;
    throw err;
  }

  const cacheKey = makeCacheKey('reverse_geocode', { lat: query.lat, lng: query.lng });
  const cached = placesCache.get(cacheKey);
  if (cached) return cached;

  let response;
  try {
    response = await axios.get('https://maps.googleapis.com/maps/api/geocode/json', {
      params: {
        latlng: `${query.lat},${query.lng}`,
        key: config.googlePlacesApiKey,
      },
      timeout: config.requestTimeoutSeconds * 1000,
    });
  } catch (error) {
    if (error.code === 'ECONNABORTED') raiseUpstreamError('Google Geocoding', 'request timed out.', 504);
    if (error.response) raiseUpstreamError('Google Geocoding', `HTTP ${error.response.status}`);
    raiseUpstreamError('Google Geocoding', 'network error while fetching location label.');
  }

  const payload = response.data;
  const apiStatus = payload.status;
  if (apiStatus !== 'OK' && apiStatus !== 'ZERO_RESULTS') {
    raiseUpstreamError('Google Geocoding', payload.error_message || apiStatus || 'unknown error');
  }

  const result = serializeReverseGeocode(payload.results || []);
  placesCache.set(cacheKey, result);
  return result;
};

const getPhotoBytes = async (photoReference, maxWidth = 400) => {
  if (!config.googlePlacesApiKey) {
    const err = new Error("Google Places API key is not configured.");
    err.statusCode = 500;
    throw err;
  }

  let response;
  try {
    response = await axios.get('https://maps.googleapis.com/maps/api/place/photo', {
      params: {
        maxwidth: maxWidth,
        photo_reference: photoReference,
        key: config.googlePlacesApiKey,
      },
      responseType: 'arraybuffer',
      timeout: config.requestTimeoutSeconds * 1000,
    });
  } catch (error) {
    if (error.code === 'ECONNABORTED') raiseUpstreamError('Google Places', 'photo request timed out.', 504);
    if (error.response) raiseUpstreamError('Google Places', `photo HTTP ${error.response.status}`);
    raiseUpstreamError('Google Places', 'network error while fetching photo.');
  }

  return {
    content: response.data,
    contentType: response.headers['content-type'] || 'image/jpeg',
  };
};

module.exports = { searchPlaces, reverseGeocode, getPhotoBytes };
