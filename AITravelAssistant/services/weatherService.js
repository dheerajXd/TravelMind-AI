import { requestJson } from './apiClient';

export const getCurrentWeather = async (lat, lon) => {
    try {
        const data = await requestJson('/weather', {
            params: {
                lat,
                lng: lon,
            },
        });
        return {
            temperature: Math.round(data.temperature),
            condition: data.condition,
            city: data.city
        };
    } catch (error) {
        console.warn("Weather Error:", error.message, error.url || '');
        return null; // Return null to trigger fallback UI
    }
};
