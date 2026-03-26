import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, Alert, ScrollView } from 'react-native';
import SuggestionCard from '../components/SuggestionCard';
import { fetchNearbyPlaces } from '../services/placesService';

const RecommendationScreen = ({ route }) => {
    const { latitude, longitude, tripType } = route.params;
    const [loading, setLoading] = useState(true);
    const [restaurants, setRestaurants] = useState([]);
    const [cafes, setCafes] = useState([]);
    const [workspaces, setWorkspaces] = useState([]);
    const [places, setPlaces] = useState([]);

    useEffect(() => {
        loadRecommendations();
    }, []);

    const loadRecommendations = async () => {
        setLoading(true);
        try {
            const isBusiness = tripType === 'business';
            const extraKeywords = isBusiness ? 'lounge' : 'sightseeing';

            const [restaurantsResult, cafesResult, workspacesResult, placesResult] = await Promise.allSettled([
                fetchNearbyPlaces(latitude, longitude, 'restaurant', 2000),
                fetchNearbyPlaces(latitude, longitude, 'cafe', 2000),
                isBusiness ? fetchNearbyPlaces(latitude, longitude, 'workspace|coworking|business start', 3000) : Promise.resolve([]),
                fetchNearbyPlaces(latitude, longitude, extraKeywords, 3000),
            ]);

            const resResults = restaurantsResult.status === 'fulfilled' ? restaurantsResult.value : [];
            const cafeResults = cafesResult.status === 'fulfilled' ? cafesResult.value : [];
            const workResults = workspacesResult.status === 'fulfilled' ? workspacesResult.value : [];
            const placeResults = placesResult.status === 'fulfilled' ? placesResult.value : [];

            setRestaurants(resResults.slice(0, 3));
            setCafes(cafeResults.slice(0, 3));
            setWorkspaces(workResults.slice(0, 3));
            setPlaces(placeResults.slice(0, 3));

            const failedRequests = [restaurantsResult, cafesResult, workspacesResult, placesResult]
                .filter((result) => result.status === 'rejected');

            if (failedRequests.length > 0 && resResults.length === 0 && cafeResults.length === 0 && workResults.length === 0 && placeResults.length === 0) {
                Alert.alert('Limited results', 'Nearby places could not be loaded.');
            }
        } catch (error) {
            Alert.alert('Error', 'Failed to fetch nearby places.');
        } finally {
            setLoading(false);
        }
    };

    const renderSection = (title, icon, data) => {
        if (data.length === 0) return null; // Hide empty sections to keep UI clean
        return (
            <View style={styles.section}>
                <Text style={styles.sectionTitle}>{icon} {title}</Text>
                {data.map(item => (
                    <SuggestionCard
                        key={item.id}
                        name={item.name}
                        rating={item.rating}
                        address={item.vicinity}
                    />
                ))}
            </View>
        );
    };

    if (loading) {
        return (
            <View style={styles.center}>
                <ActivityIndicator size="large" color="#6200ee" />
                <Text style={styles.loadingText}>Finding best spots...</Text>
            </View>
        );
    }

    return (
        <ScrollView style={styles.container}>
            {renderSection('Restaurants', '🍽️', restaurants)}
            {renderSection('Cafes', '☕', cafes)}
            {renderSection(tripType === 'business' ? 'Lounges' : 'Sightseeing', '📍', places)}
            {tripType === 'business' && renderSection('Workspaces', '🏢', workspaces)}

            {restaurants.length === 0 && cafes.length === 0 && places.length === 0 && workspaces.length === 0 && (
                <View style={styles.centerEmpty}>
                    <Text style={styles.emptyText}>No recommendations found in this area.</Text>
                </View>
            )}
            <View style={{ height: 40 }} />
        </ScrollView>
    );
};

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#f5f5f5', padding: 16 },
    center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f5f5f5' },
    centerEmpty: { marginTop: 40, alignItems: 'center' },
    loadingText: { marginTop: 12, fontSize: 16, color: '#555' },
    section: { marginBottom: 24 },
    sectionTitle: { fontSize: 20, fontWeight: 'bold', color: '#222', marginBottom: 12 },
    emptyText: { color: '#888', fontStyle: 'italic', fontSize: 16 }
});

export default RecommendationScreen;
