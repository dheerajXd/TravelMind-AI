import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, Alert, ScrollView } from 'react-native';
import SuggestionCard from '../components/SuggestionCard';
import { fetchSmartSuggestions } from '../services/backendService';

const RecommendationScreen = ({ route }) => {
    const { userId, inferredTripType, activityPreference, cuisinePreference } = route.params;
    const [loading, setLoading] = useState(true);
    const [recommendations, setRecommendations] = useState([]);
    const [nearbyMatches, setNearbyMatches] = useState([]);
    const heroRecommendation = recommendations[0] ?? null;
    const remainingRecommendations = heroRecommendation
        ? recommendations.filter((item) => item.title !== heroRecommendation.title || item.priority !== heroRecommendation.priority)
        : recommendations;

    useEffect(() => {
        loadRecommendations();
    }, []);

    const loadRecommendations = async () => {
        setLoading(true);
        try {
            const response = await fetchSmartSuggestions({
                userId,
                inferredTripType,
                activityPreference,
                cuisinePreference,
            });
            setRecommendations(response.recommendations || []);
            setNearbyMatches(response.nearby_matches || []);
        } catch (error) {
            Alert.alert('Error', 'Failed to fetch smart suggestions from the backend.');
        } finally {
            setLoading(false);
        }
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
            {heroRecommendation ? (
                <View style={styles.heroCard}>
                    <Text style={styles.heroLabel}>Best Match Right Now</Text>
                    <Text style={styles.heroSubtitle}>{buildSectionSummary(activityPreference, inferredTripType)}</Text>
                    <SuggestionCard
                        name={heroRecommendation.title}
                        rating={buildRatingLine(heroRecommendation)}
                        helperText={buildHelperText(heroRecommendation, activityPreference)}
                        badges={buildBadges(heroRecommendation, activityPreference)}
                        metaText={buildMetaText(heroRecommendation)}
                        address={heroRecommendation.reason}
                    />
                </View>
            ) : null}

            {renderSection(
                'Best for Right Now',
                remainingRecommendations.filter((item) => classifyRecommendation(item) === 'immediate'),
                activityPreference
            )}
            {renderSection(
                'Good for a Focused Break',
                remainingRecommendations.filter((item) => classifyRecommendation(item) === 'focus'),
                activityPreference
            )}
            {renderSection(
                'Worth Exploring Nearby',
                remainingRecommendations.filter((item) => classifyRecommendation(item) === 'explore'),
                activityPreference
            )}
            {renderSection(
                'Other Good Fits',
                remainingRecommendations.filter((item) => classifyRecommendation(item) === 'other'),
                activityPreference
            )}

            {nearbyMatches.length ? (
                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>
                        {recommendations.length === 0 ? 'Closest Nearby Fits' : 'Nearby Matches from Google Maps'}
                    </Text>
                    <Text style={styles.sectionSubtitle}>
                        {recommendations.length === 0
                            ? 'No exact match was found, so these are the nearest options that still look close to your preferences.'
                            : 'Raw nearby results for trust, distance, and quick comparison.'}
                    </Text>
                    {nearbyMatches.map((item) => (
                        <SuggestionCard
                            key={`${item.name}-${item.address}`}
                            name={item.name}
                            rating={buildNearbyRatingLine(item)}
                            helperText={item.open_now ? 'Maps says open now' : 'Check hours'}
                            badges={buildNearbyBadges(item)}
                            metaText={buildNearbyMeta(item)}
                            address={item.address}
                        />
                    ))}
                </View>
            ) : null}

            {recommendations.length === 0 && nearbyMatches.length === 0 && (
                <View style={styles.centerEmpty}>
                    <Text style={styles.emptyText}>No recommendations found in this area.</Text>
                </View>
            )}
            <View style={{ height: 40 }} />
        </ScrollView>
    );
};

const renderSection = (title, data, activityPreference) => {
    if (!data.length) return null;
    return (
        <View style={styles.section}>
            <Text style={styles.sectionTitle}>{title}</Text>
            {data.map(item => (
                <SuggestionCard
                    key={`${item.priority}-${item.title}`}
                    name={item.title}
                    rating={buildRatingLine(item)}
                    helperText={buildHelperText(item, activityPreference)}
                    badges={buildBadges(item, activityPreference)}
                    metaText={buildMetaText(item)}
                    address={item.reason}
                />
            ))}
        </View>
    );
};

const classifyRecommendation = (item) => {
    const reason = `${item.title} ${item.reason}`.toLowerCase();
    if (
        reason.includes('hours look favorable') ||
        reason.includes('quick') ||
        reason.includes('late-night')
    ) {
        return 'immediate';
    }
    if (item.type === 'cafe' || reason.includes('work') || reason.includes('productive') || reason.includes('quiet')) {
        return 'focus';
    }
    if (item.type === 'activity' || reason.includes('explore') || reason.includes('sightseeing') || reason.includes('walk')) {
        return 'explore';
    }
    return 'other';
};

const buildHelperText = (item, activityPreference) => {
    const reason = item.reason.toLowerCase();
    if (reason.includes('hours look favorable') || reason.includes('hours should be verified')) {
        return 'Check hours';
    }
    if (reason.includes('quick') || activityPreference === 'food') {
        return 'Fast option';
    }
    if (reason.includes('quiet') || activityPreference === 'work spot') {
        return 'Quiet fit';
    }
    if (reason.includes('coffee') || item.type === 'cafe') {
        return 'Coffee break';
    }
    if (item.type === 'activity') {
        return 'Nearby change of pace';
    }
    return 'Recommended for you';
};

const buildBadges = (item, activityPreference) => {
    const reason = item.reason.toLowerCase();
    const badges = [];

    if (reason.includes('hours look favorable')) {
        badges.push('Check hours');
    }
    if (
        reason.includes('quick bite') ||
        reason.includes('quick meal') ||
        reason.includes('late-night meal') ||
        (activityPreference === 'food' && item.type === 'restaurant')
    ) {
        badges.push('Best for quick dinner');
    }
    if (
        reason.includes('short break') ||
        reason.includes('free time') ||
        reason.includes('between meetings') ||
        reason.includes('fits a short') ||
        reason.includes('quick stop')
    ) {
        badges.push('Good for a short gap');
    }
    if (reason.includes('coffee') || item.type === 'cafe') {
        badges.push('Coffee-friendly');
    }
    if (reason.includes('quiet') || reason.includes('productive') || activityPreference === 'work spot') {
        badges.push('Work-friendly');
    }
    if (item.type === 'activity' || reason.includes('explore') || reason.includes('sightseeing')) {
        badges.push('Nearby experience');
    }
    if (reason.includes('budget') || reason.includes('affordable') || reason.includes('low budget')) {
        badges.push('Budget-aware');
    }

    return [...new Set(badges)].slice(0, 3);
};

const buildSectionSummary = (activityPreference, inferredTripType) => {
    if (activityPreference === 'work spot') {
        return 'Picked for a productive break near you.';
    }
    if (activityPreference === 'sightseeing') {
        return 'A strong nearby option that fits a short outing.';
    }
    if (inferredTripType === 'business') {
        return 'Ranked for quick decisions, useful spaces, and low-friction stops.';
    }
    return 'Ranked for convenience, relevance, and variety nearby.';
};

const buildRatingLine = (item) => {
    const parts = [];
    if (item.google_rating) {
        parts.push(`${item.google_rating.toFixed(1)}★ Google`);
    }
    parts.push(`P${item.priority}`);
    parts.push(item.type);
    return parts.join(' • ');
};

const buildMetaText = (item) => {
    const parts = [];
    if (item.place_address) {
        parts.push(item.place_address);
    }
    return parts.join(' • ');
};

const buildNearbyMeta = (item) => {
    const parts = [];
    if (item.distance_meters) {
        parts.push(`${item.distance_meters} m away`);
    }
    if (item.walk_eta_minutes) {
        parts.push(`${item.walk_eta_minutes} min walk`);
    }
    if (item.drive_eta_minutes) {
        parts.push(`${item.drive_eta_minutes} min drive`);
    }
    return parts.join(' • ');
};

const buildNearbyRatingLine = (item) => {
    const parts = [];
    if (item.google_rating) {
        parts.push(`${item.google_rating.toFixed(1)}★ Google`);
    }
    parts.push(item.category);
    return parts.join(' • ');
};

const buildNearbyBadges = (item) => {
    const badges = [];
    if (item.open_now) {
        badges.push('Open now');
    }
    if (item.walk_eta_minutes) {
        badges.push(`${item.walk_eta_minutes} min walk`);
    }
    if (item.drive_eta_minutes) {
        badges.push(`${item.drive_eta_minutes} min drive`);
    }
    return badges.slice(0, 3);
};

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#f5f5f5', padding: 16 },
    center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f5f5f5' },
    centerEmpty: { marginTop: 40, alignItems: 'center' },
    loadingText: { marginTop: 12, fontSize: 16, color: '#555' },
    heroCard: { marginBottom: 24 },
    heroLabel: { fontSize: 14, fontWeight: '700', color: '#6a1b9a', textTransform: 'uppercase', marginBottom: 8 },
    heroSubtitle: { fontSize: 14, color: '#555', marginBottom: 10 },
    section: { marginBottom: 24 },
    sectionTitle: { fontSize: 20, fontWeight: 'bold', color: '#222', marginBottom: 12 },
    sectionSubtitle: { fontSize: 14, color: '#666', marginBottom: 12 },
    emptyText: { color: '#888', fontStyle: 'italic', fontSize: 16 }
});

export default RecommendationScreen;
