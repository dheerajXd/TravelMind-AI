import axios from 'axios';

export const getCurrentWeather = async (lat, lon) => {
    const apiKey = process.env.EXPO_PUBLIC_OPENWEATHER_API_KEY;
    if (!apiKey || apiKey === 'your_key_here') {
        return null;
    }

    try {
        const response = await axios.get(
            `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${apiKey}&units=metric`
        );
        const data = response.data;
        return {
            temperature: Math.round(data.main.temp),
            condition: data.weather[0].main,
            city: data.name
        };
    } catch (error) {
        console.warn("Weather Error:", error.message);
        return null; // Return null to trigger fallback UI
    }
};
