import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, ScrollView } from 'react-native';
import * as Location from 'expo-location';
import { checkBackendHealth, getBackendUrl, getOrCreateUserId, storeTravelContext } from '../services/backendService';
import { getCurrentWeather } from '../services/weatherService';

// Note: Using a simple custom picker or default UI to avoid extra dependencies if possible
// We will just use simple buttons for selection to avoid configuring @react-native-picker/picker if it's missing.
const HomeScreen = ({ navigation }) => {
    const [location, setLocation] = useState(null);
    const [errorMsg, setErrorMsg] = useState(null);
    const [currentTime, setCurrentTime] = useState(new Date().toLocaleTimeString());
    const [budget, setBudget] = useState('medium');
    const [vibe, setVibe] = useState('calm');
    const [cuisinePreference, setCuisinePreference] = useState('local');
    const [activityPreference, setActivityPreference] = useState('food');
    const [priority, setPriority] = useState('open_now');
    const [weather, setWeather] = useState('loading');
    const [backendStatus, setBackendStatus] = useState('checking');

    const backendLabel = weather && weather !== 'loading'
        ? 'Connected'
        : backendStatus === 'connected'
            ? 'Connected'
            : backendStatus === 'unreachable'
                ? 'Reconnecting...'
                : 'Checking...';

    useEffect(() => {
        (async () => {
            let { status } = await Location.requestForegroundPermissionsAsync();
            if (status !== 'granted') {
                setErrorMsg('Permission to access location was denied');
                // fallback location (Bengaluru)
                const fallback = { coords: { latitude: 12.9716, longitude: 77.5946 } };
                setLocation(fallback);
                await refreshBackendAndWeather(fallback.coords.latitude, fallback.coords.longitude);
                return;
            }

            try {
                let loc = await Location.getCurrentPositionAsync({});
                setLocation(loc);
                await refreshBackendAndWeather(loc.coords.latitude, loc.coords.longitude);
            } catch (e) {
                const fallback = { coords: { latitude: 12.9716, longitude: 77.5946 } };
                setLocation(fallback);
                await refreshBackendAndWeather(fallback.coords.latitude, fallback.coords.longitude);
            }
        })();

        const interval = setInterval(() => {
            setCurrentTime(new Date().toLocaleTimeString());
        }, 1000);
        return () => clearInterval(interval);
    }, []);

    const refreshBackendAndWeather = async (latitude, longitude) => {
        try {
            await retry(async () => checkBackendHealth(), 3, 800);
            setBackendStatus('connected');
        } catch (error) {
            setBackendStatus('unreachable');
            setWeather(null);
            return;
        }

        const latestWeather = await retry(
            async () => getCurrentWeather(latitude, longitude),
            2,
            600
        );
        setWeather(latestWeather);
        if (latestWeather) {
            setBackendStatus('connected');
        }
    };

    const handleGetSuggestions = async () => {
        if (!location) {
            Alert.alert('Waiting for location...', 'Please wait a moment while we find your location.');
            return;
        }

        try {
            await retry(async () => checkBackendHealth(), 2, 500);
            setBackendStatus('connected');
            const userId = await getOrCreateUserId();
            const inferredTripType = inferTripType(activityPreference, priority);
            await storeTravelContext({
                userId,
                latitude: location.coords.latitude,
                longitude: location.coords.longitude,
                inferredTripType,
                vibe,
                budget,
                cuisinePreference,
                activityPreference,
                priority,
            });
            navigation.navigate('Recommendations', {
                userId,
                inferredTripType,
                activityPreference,
                cuisinePreference,
            });
        } catch (error) {
            if ((error?.message || '').toLowerCase().includes('network request failed')) {
                setBackendStatus('unreachable');
            }
            Alert.alert(
                'Request Error',
                `Could not save your travel context.\n\nBackend URL: ${getBackendUrl()}\n\nReason: ${error?.message || 'Unknown error'}`
            );
        }
    };

    return (
        <ScrollView
            style={styles.screen}
            contentContainerStyle={styles.container}
            showsVerticalScrollIndicator={false}
        >
            <View style={styles.infoCard}>
                {weather && weather !== 'loading' ? (
                    <Text style={styles.weatherText}>🌦️ {weather.city} {'\n'}{weather.temperature}°C — {weather.condition}</Text>
                ) : weather === null ? (
                    <Text style={styles.weatherText}>Weather unavailable</Text>
                ) : (
                    <Text style={styles.weatherText}>Fetching weather...</Text>
                )}
                <Text style={styles.timeTitle}>{currentTime}</Text>
                <Text style={styles.locationText}>
                    {errorMsg ? "Mock Location: Bengaluru" : (location ? `Lat: ${location.coords.latitude.toFixed(4)}, Lng: ${location.coords.longitude.toFixed(4)}` : 'Fetching location...')}
                </Text>
                <Text style={styles.backendText}>Backend: {backendLabel}</Text>
            </View>

            <View style={styles.typeContainer}>
                <Text style={styles.label}>Your Usual Budget</Text>
                <View style={styles.row}>
                    {['low', 'medium', 'high'].map((option) => (
                        <TouchableOpacity
                            key={option}
                            style={[styles.typeBtn, budget === option && styles.typeBtnActive]}
                            onPress={() => setBudget(option)}>
                            <Text style={[styles.typeText, budget === option && styles.typeTextActive]}>
                                {option}
                            </Text>
                        </TouchableOpacity>
                    ))}
                </View>
            </View>

            <View style={styles.typeContainer}>
                <Text style={styles.label}>Preferred Atmosphere</Text>
                <View style={styles.row}>
                    {['calm', 'social', 'productive'].map((option) => (
                        <TouchableOpacity
                            key={option}
                            style={[styles.typeBtn, vibe === option && styles.typeBtnActive]}
                            onPress={() => setVibe(option)}>
                            <Text style={[styles.typeText, vibe === option && styles.typeTextActive]}>
                                {option}
                            </Text>
                        </TouchableOpacity>
                    ))}
                </View>
            </View>

            <View style={styles.typeContainer}>
                <Text style={styles.label}>Food You Usually Enjoy</Text>
                <View style={styles.row}>
                    {['local', 'cafe', 'veg', 'quick bites'].map((option) => (
                        <TouchableOpacity
                            key={option}
                            style={[styles.typeBtn, cuisinePreference === option && styles.typeBtnActive]}
                            onPress={() => setCuisinePreference(option)}>
                            <Text style={[styles.typeText, cuisinePreference === option && styles.typeTextActive]}>
                                {option}
                            </Text>
                        </TouchableOpacity>
                    ))}
                </View>
            </View>

            <View style={styles.typeContainer}>
                <Text style={styles.label}>How You Like Spending Free Time</Text>
                <View style={styles.row}>
                    {['food', 'coffee', 'work spot', 'sightseeing'].map((option) => (
                        <TouchableOpacity
                            key={option}
                            style={[styles.typeBtn, activityPreference === option && styles.typeBtnActive]}
                            onPress={() => setActivityPreference(option)}>
                            <Text style={[styles.typeText, activityPreference === option && styles.typeTextActive]}>
                                {option}
                            </Text>
                        </TouchableOpacity>
                    ))}
                </View>
            </View>

            <View style={styles.typeContainer}>
                <Text style={styles.label}>What We Should Optimize For</Text>
                <View style={styles.row}>
                    {['open_now', 'closest', 'best_rated', 'quiet'].map((option) => (
                        <TouchableOpacity
                            key={option}
                            style={[styles.typeBtn, priority === option && styles.typeBtnActive]}
                            onPress={() => setPriority(option)}>
                            <Text style={[styles.typeText, priority === option && styles.typeTextActive]}>
                                {option.replace('_', ' ')}
                            </Text>
                        </TouchableOpacity>
                    ))}
                </View>
            </View>

            <TouchableOpacity style={styles.button} onPress={handleGetSuggestions}>
                <Text style={styles.buttonText}>Get Suggestions</Text>
            </TouchableOpacity>

            <TouchableOpacity
                style={styles.secondaryButton}
                onPress={() => {
                    if (location) {
                        refreshBackendAndWeather(location.coords.latitude, location.coords.longitude);
                    }
                }}>
                <Text style={styles.secondaryButtonText}>Refresh Live Context</Text>
            </TouchableOpacity>

        </ScrollView>
    );
};

const inferTripType = (activityPreference, priority) => {
    if (activityPreference === 'work spot' || priority === 'quiet') {
        return 'business';
    }
    return 'leisure';
};

const retry = async (fn, attempts, delayMs) => {
    let lastError = null;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
        try {
            return await fn();
        } catch (error) {
            lastError = error;
            if (attempt < attempts - 1) {
                await new Promise((resolve) => setTimeout(resolve, delayMs));
            }
        }
    }
    if (lastError) {
        throw lastError;
    }
    return null;
};

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: '#f9f9f9' },
    container: {
        paddingHorizontal: 20,
        paddingTop: 24,
        paddingBottom: 40,
        backgroundColor: '#f9f9f9',
        alignSelf: 'center',
        width: '100%',
        maxWidth: 960,
    },
    infoCard: {
        backgroundColor: '#fff',
        paddingVertical: 28,
        paddingHorizontal: 24,
        borderRadius: 16,
        alignItems: 'center',
        marginBottom: 30,
        shadowColor: '#000',
        shadowOpacity: 0.1,
        shadowRadius: 10,
        elevation: 4,
    },
    weatherText: { fontSize: 18, color: '#0d47a1', fontWeight: 'bold', textAlign: 'center', marginBottom: 16, lineHeight: 24 },
    timeTitle: { fontSize: 36, fontWeight: 'bold', color: '#333', marginBottom: 12 },
    locationText: { fontSize: 16, color: '#666' },
    backendText: { fontSize: 13, color: '#7b1fa2', marginTop: 12, textAlign: 'center' },
    typeContainer: { marginBottom: 30 },
    label: { fontSize: 16, fontWeight: '600', marginBottom: 12, color: '#444', textAlign: 'center' },
    row: { flexDirection: 'row', justifyContent: 'center', gap: 10, flexWrap: 'wrap' },
    typeBtn: { paddingVertical: 12, paddingHorizontal: 20, borderRadius: 25, backgroundColor: '#e0e0e0', minWidth: 96, alignItems: 'center' },
    typeBtnActive: { backgroundColor: '#6200ee' },
    typeText: { fontSize: 16, color: '#555', fontWeight: 'bold' },
    typeTextActive: { color: '#fff' },
    button: { backgroundColor: '#6200ee', paddingVertical: 16, borderRadius: 12, alignItems: 'center', shadowColor: '#6200ee', shadowOpacity: 0.3, shadowRadius: 8, elevation: 4, marginTop: 8 },
    buttonText: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
    secondaryButton: { marginTop: 12, marginBottom: 12, paddingVertical: 12, borderRadius: 12, alignItems: 'center', borderWidth: 1, borderColor: '#6200ee' },
    secondaryButtonText: { color: '#6200ee', fontSize: 16, fontWeight: '600' },
});

export default HomeScreen;
