import { getApiBaseUrl, requestJson } from './apiClient';

const resolvePhotoUrl = (photoUrl) => {
  if (!photoUrl) return null;
  if (photoUrl.startsWith('http://') || photoUrl.startsWith('https://')) {
    return photoUrl;
  }
  return `${getApiBaseUrl()}${photoUrl}`;
};

const mapBackendPlace = (place, fallbackCategory = 'all') => ({
  id: place.id || `${place.name}-${place.address}`,
  name: place.name,
  rating: place.rating ?? 'N/A',
  vicinity: place.address,
  address: place.address,
  location: place.lat != null && place.lng != null ? { lat: place.lat, lng: place.lng } : null,
  lat: place.lat ?? null,
  lng: place.lng ?? null,
  types: Array.isArray(place.types) ? place.types : [],
  openNow: place.open_now ?? null,
  photoUrl: resolvePhotoUrl(place.photo_url),
  normalizedCategory: fallbackCategory,
});

export const searchPlaces = async ({
  latitude,
  longitude,
  location,
  type,
  radius = 5000,
}) => {
  const params = {
    type: type || 'popular places',
    radius,
  };

  if (latitude != null && longitude != null) {
    params.lat = latitude;
    params.lng = longitude;
  } else if (location) {
    params.location = location;
  } else {
    throw new Error('MISSING_LOCATION');
  }

  const data = await requestJson('/places/search', { params });
  const places = (data?.places || []).map((place) => mapBackendPlace(place, type));

  console.log('Explore backend places response:', {
    source: location ? 'global' : 'nearby',
    type: params.type,
    radius,
    resultCount: places.length,
    lat: params.lat,
    lng: params.lng,
    location: params.location,
  });

  return places;
};

export const fetchNearbyPlaces = async (latitude, longitude, keyword, radius = 5000) => {
  return searchPlaces({
    latitude,
    longitude,
    type: keyword || 'popular places',
    radius,
  });
};

export const fetchPlaceSuggestions = async ({
  query,
  latitude,
  longitude,
  global = false,
}) => {
  const trimmedQuery = query?.trim();
  if (!trimmedQuery || trimmedQuery.length < 2) {
    return [];
  }

  const results = await searchPlaces({
    latitude: global ? undefined : latitude,
    longitude: global ? undefined : longitude,
    location: global ? trimmedQuery : undefined,
    type: global ? 'popular places' : trimmedQuery,
    radius: global ? 12000 : 5000,
  });

  return results.slice(0, 6);
};
