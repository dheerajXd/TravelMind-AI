import axios from 'axios';

// Get the API key from Expo environment variables
const API_KEY = process.env.EXPO_PUBLIC_GOOGLE_PLACES_API_KEY;
const BASE_URL = 'https://maps.googleapis.com/maps/api/place/nearbysearch/json';

/**
 * Fetch nearby places based on location and keyword.
 * @param {number} latitude 
 * @param {number} longitude 
 * @param {string} keyword e.g. "restaurant", "cafe", "workspace"
 */
export const fetchNearbyPlaces = async (latitude, longitude, keyword, radius = 5000) => {
  if (!API_KEY || API_KEY === 'your_key_here') {
    throw new Error('INVALID_KEY');
  }

  try {
    const response = await axios.get(BASE_URL, {
      params: {
        location: `${latitude},${longitude}`,
        radius: radius,
        keyword: keyword,
        key: API_KEY,
      },
    });

    if (response.data.status === 'REQUEST_DENIED') {
      throw new Error('REQUEST_DENIED');
    }

    if (response.data.status !== 'OK' && response.data.status !== 'ZERO_RESULTS') {
      throw new Error(response.data.status);
    }

    // Map the results to just what we need
    return response.data.results.map((place) => ({
      id: place.place_id,
      name: place.name,
      rating: place.rating || 'N/A',
      vicinity: place.vicinity,
      location: place.geometry.location,
    }));
  } catch (error) {
    if (error.message === 'INVALID_KEY' || error.message === 'REQUEST_DENIED') {
      throw error;
    }
    console.error('Error fetching places:', error);
    throw new Error('NETWORK_ERROR');
  }
};
