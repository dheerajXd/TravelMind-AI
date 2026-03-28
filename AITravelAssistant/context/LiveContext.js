import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import * as Location from 'expo-location';
import { getCurrentWeather, getLocationLabel } from '../services/weatherService';

const LiveContext = createContext(null);

const WEATHER_REFRESH_MS = 5 * 60 * 1000;
const FALLBACK_COORDS = { latitude: 13.5571, longitude: 80.0251 };

export const LiveContextProvider = ({ children }) => {
    const [currentTime, setCurrentTime] = useState(new Date());
    const [weather, setWeather] = useState(null);
    const [locationLabel, setLocationLabel] = useState('Locating…');
    const [coords, setCoords] = useState(FALLBACK_COORDS);
    const [loading, setLoading] = useState(true);
    const lastWeatherRef = useRef(null);
    const lastMeaningfulLocationRef = useRef(null);

    useEffect(() => {
        const timer = setInterval(() => {
            setCurrentTime(new Date());
        }, 1000);

        return () => clearInterval(timer);
    }, []);

    useEffect(() => {
        let active = true;

        const refresh = async () => {
            try {
                let latitude = FALLBACK_COORDS.latitude;
                let longitude = FALLBACK_COORDS.longitude;

                try {
                    const { status } = await Location.requestForegroundPermissionsAsync();
                    if (status === 'granted') {
                        const loc = await Location.getCurrentPositionAsync({});
                        latitude = loc.coords.latitude;
                        longitude = loc.coords.longitude;
                    }
                } catch (error) {
                    console.warn('Live context location fallback:', error);
                }

                if (!active) return;
                setCoords({ latitude, longitude });

                const [weatherData, labelData] = await Promise.all([
                    getCurrentWeather(latitude, longitude).catch(() => null),
                    getLocationLabel(latitude, longitude).catch(() => null),
                ]);

                if (!active) return;

                if (weatherData) {
                    setWeather(weatherData);
                    lastWeatherRef.current = weatherData;
                } else if (lastWeatherRef.current) {
                    setWeather(lastWeatherRef.current);
                }

                const resolvedLabel = firstMeaningfulLabel(
                    labelData,
                    weatherData?.city,
                    lastWeatherRef.current?.city
                );

                if (resolvedLabel) {
                    lastMeaningfulLocationRef.current = resolvedLabel;
                    setLocationLabel(resolvedLabel);
                } else if (lastMeaningfulLocationRef.current) {
                    setLocationLabel(lastMeaningfulLocationRef.current);
                } else {
                    setLocationLabel('Nearby area');
                }
            } finally {
                if (active) {
                    setLoading(false);
                }
            }
        };

        refresh();
        const interval = setInterval(refresh, WEATHER_REFRESH_MS);

        return () => {
            active = false;
            clearInterval(interval);
        };
    }, []);

    const value = useMemo(() => {
        const shortLocation = (locationLabel || 'Nearby area').split(',')[0].trim();
        return {
            currentTime,
            formattedTime: currentTime.toLocaleTimeString([], {
                hour: 'numeric',
                minute: '2-digit',
            }),
            preciseTime: currentTime.toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
            }),
            weather,
            temperatureLabel: weather ? `${weather.temperature}°C` : '—',
            locationLabel,
            shortLocation,
            latitude: coords.latitude,
            longitude: coords.longitude,
            coordsLabel: `${coords.latitude.toFixed(4)}° N, ${coords.longitude.toFixed(4)}° E`,
            loading,
        };
    }, [coords.latitude, coords.longitude, currentTime, loading, locationLabel, weather]);

    return <LiveContext.Provider value={value}>{children}</LiveContext.Provider>;
};

export const useLiveContext = () => {
    const context = useContext(LiveContext);
    if (!context) {
        throw new Error('useLiveContext must be used inside LiveContextProvider');
    }
    return context;
};

const firstMeaningfulLabel = (...values) => {
    for (const value of values) {
        const normalized = String(value || '').trim();
        if (!normalized) continue;
        if (normalized.toLowerCase() === 'nearby area') continue;
        if (normalized.toLowerCase() === 'locating…') continue;
        if (normalized.toLowerCase() === 'locating...') continue;
        return normalized;
    }
    return null;
};
