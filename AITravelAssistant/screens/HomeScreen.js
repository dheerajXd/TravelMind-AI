import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import * as Location from 'expo-location';
import { getCurrentWeather } from '../services/weatherService';

// Note: Using a simple custom picker or default UI to avoid extra dependencies if possible
// We will just use simple buttons for selection to avoid configuring @react-native-picker/picker if it's missing.
const HomeScreen = ({ navigation }) => {
    const [location, setLocation] = useState(null);
    const [errorMsg, setErrorMsg] = useState(null);
    const [currentTime, setCurrentTime] = useState(new Date().toLocaleTimeString());
    const [tripType, setTripType] = useState('business');
    const [hasAlerted, setHasAlerted] = useState(false);
    const [weather, setWeather] = useState('loading');

    useEffect(() => {
        (async () => {
            let { status } = await Location.requestForegroundPermissionsAsync();
            if (status !== 'granted') {
                setErrorMsg('Permission to access location was denied');
                // fallback location (Bengaluru)
                const fallback = { coords: { latitude: 12.9716, longitude: 77.5946 } };
                setLocation(fallback);
                const w = await getCurrentWeather(fallback.coords.latitude, fallback.coords.longitude);
                setWeather(w);
                return;
            }

            try {
                let loc = await Location.getCurrentPositionAsync({});
                setLocation(loc);
                const w = await getCurrentWeather(loc.coords.latitude, loc.coords.longitude);
                setWeather(w);
            } catch (e) {
                const fallback = { coords: { latitude: 12.9716, longitude: 77.5946 } };
                setLocation(fallback);
                const w = await getCurrentWeather(fallback.coords.latitude, fallback.coords.longitude);
                setWeather(w);
            }
        })();

        const interval = setInterval(() => {
            setCurrentTime(new Date().toLocaleTimeString());
        }, 1000);
        return () => clearInterval(interval);
    }, []);

    // Proactive Feature: 5 seconds alert
    useEffect(() => {
        const timer = setTimeout(() => {
            if (!hasAlerted) {
                Alert.alert(
                    "Free Time!",
                    "You have free time. Here are suggestions nearby.",
                    [
                        { text: "Cancel", style: "cancel" },
                        {
                            text: "Show Suggestions",
                            onPress: () => handleGetSuggestions()
                        }
                    ]
                );
                setHasAlerted(true);
            }
        }, 5000);

        return () => clearTimeout(timer);
    }, [hasAlerted, location, tripType]);

    const handleGetSuggestions = () => {
        if (location) {
            navigation.navigate('Recommendations', {
                latitude: location.coords.latitude,
                longitude: location.coords.longitude,
                tripType: tripType
            });
        } else {
            Alert.alert('Waiting for location...', 'Please wait a moment while we find your location.');
        }
    };

    return (
        <View style={styles.container}>
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
            </View>

            <View style={styles.typeContainer}>
                <Text style={styles.label}>Trip Purpose:</Text>
                <View style={styles.row}>
                    <TouchableOpacity
                        style={[styles.typeBtn, tripType === 'business' && styles.typeBtnActive]}
                        onPress={() => setTripType('business')}>
                        <Text style={[styles.typeText, tripType === 'business' && styles.typeTextActive]}>Business</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                        style={[styles.typeBtn, tripType === 'leisure' && styles.typeBtnActive]}
                        onPress={() => setTripType('leisure')}>
                        <Text style={[styles.typeText, tripType === 'leisure' && styles.typeTextActive]}>Leisure</Text>
                    </TouchableOpacity>
                </View>
            </View>

            <TouchableOpacity style={styles.button} onPress={handleGetSuggestions}>
                <Text style={styles.buttonText}>Get Suggestions</Text>
            </TouchableOpacity>
        </View>
    );
};

const styles = StyleSheet.create({
    container: { flex: 1, padding: 20, backgroundColor: '#f9f9f9', justifyContent: 'center' },
    infoCard: { backgroundColor: '#fff', padding: 30, borderRadius: 16, alignItems: 'center', marginBottom: 30, shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 10, elevation: 4 },
    weatherText: { fontSize: 18, color: '#0d47a1', fontWeight: 'bold', textAlign: 'center', marginBottom: 16, lineHeight: 24 },
    timeTitle: { fontSize: 36, fontWeight: 'bold', color: '#333', marginBottom: 12 },
    locationText: { fontSize: 16, color: '#666' },
    typeContainer: { marginBottom: 30 },
    label: { fontSize: 16, fontWeight: '600', marginBottom: 12, color: '#444', textAlign: 'center' },
    row: { flexDirection: 'row', justifyContent: 'center', gap: 10 },
    typeBtn: { paddingVertical: 12, paddingHorizontal: 24, borderRadius: 25, backgroundColor: '#e0e0e0', minWidth: 120, alignItems: 'center' },
    typeBtnActive: { backgroundColor: '#6200ee' },
    typeText: { fontSize: 16, color: '#555', fontWeight: 'bold' },
    typeTextActive: { color: '#fff' },
    button: { backgroundColor: '#6200ee', paddingVertical: 16, borderRadius: 12, alignItems: 'center', shadowColor: '#6200ee', shadowOpacity: 0.3, shadowRadius: 8, elevation: 4 },
    buttonText: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
});

export default HomeScreen;
