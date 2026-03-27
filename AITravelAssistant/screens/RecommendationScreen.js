import React, { useEffect, useMemo, useState } from 'react';
import {
    ActivityIndicator,
    Linking,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    View,
} from 'react-native';
import SuggestionCard from '../components/SuggestionCard';
import { fetchSmartSuggestions, getPlannedItems, togglePlannedItem } from '../services/backendService';

const PRIMARY_OPTIONS = [
    { key: 'food', label: 'Food', icon: '🍽️' },
    { key: 'shopping', label: 'Shopping', icon: '🛍️' },
    { key: 'explore', label: 'Explore', icon: '✦' },
];

const DETAIL_OPTIONS = {
    food: ['Quick Dinner', 'Cafe Break', 'Street Food', 'Local Favorite'],
    shopping: ['Malls', 'Street Markets', 'Luxury Stores', 'Local Crafts'],
    explore: ['Museums', 'Landmarks', 'Walks', 'Culture'],
};

const RecommendationScreen = ({ route, navigation }) => {
    const { userId, inferredTripType, activityPreference, cuisinePreference } = route.params;
    const [loading, setLoading] = useState(true);
    const [recommendations, setRecommendations] = useState([]);
    const [nearbyMatches, setNearbyMatches] = useState([]);
    const [activePrimary, setActivePrimary] = useState(mapActivityToPrimary(activityPreference));
    const [plannedIds, setPlannedIds] = useState([]);

    useEffect(() => {
        loadRecommendations();
        loadPlannedItems();
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
            console.warn('Recommendation fetch failed:', error);
            setRecommendations([]);
            setNearbyMatches([]);
        } finally {
            setLoading(false);
        }
    };

    const loadPlannedItems = async () => {
        try {
            const items = await getPlannedItems();
            setPlannedIds(items.map((item) => item.id));
        } catch (error) {
            console.warn('Planned items load failed:', error);
        }
    };

    const handleAddToPlan = async (item) => {
        try {
            const result = await togglePlannedItem(handlePlanPayload(item));
            setPlannedIds(result.items.map((entry) => entry.id));
            console.log(result.saved ? 'Added to plan:' : 'Removed from plan:', item.name);
        } catch (error) {
            console.warn('Toggle plan item failed:', error);
        }
    };

    const renderedCards = useMemo(() => {
        if (recommendations.length) {
            return recommendations.map((item) => ({
                id: `${item.priority}-${item.title}`,
                name: item.title,
                subtitle: buildCardSubtitle(item),
                description: item.reason,
                rating: item.google_rating ? `⭐ ${item.google_rating.toFixed(1)}` : null,
                distanceLabel: buildDistanceLabelFromReason(item.reason),
                imageUrl: buildImageUrl(item.title, item.type),
                metaText: item.place_address || null,
                primaryActionLabel: plannedIds.includes(`${item.priority}-${item.title}`) ? 'Added' : 'Add to Plan',
                secondaryActionLabel: 'Map',
                mapQuery: `${item.title} ${item.place_address || ''}`.trim(),
            }));
        }

        return nearbyMatches.map((item) => ({
            id: `${item.name}-${item.address}`,
            name: item.name,
            subtitle: item.category,
            description: item.open_now
                ? 'Looks like a convenient nearby option that is currently open.'
                : 'A close nearby match worth checking if it fits your plans.',
            rating: item.google_rating ? `⭐ ${item.google_rating.toFixed(1)}` : null,
            distanceLabel: buildNearbyDistance(item),
            imageUrl: buildImageUrl(item.name, item.category),
            metaText: item.address,
            primaryActionLabel: plannedIds.includes(`${item.name}-${item.address}`) ? 'Added' : 'Add to Plan',
            secondaryActionLabel: 'Map',
            mapQuery: `${item.name} ${item.address || ''}`.trim(),
        }));
    }, [nearbyMatches, plannedIds, recommendations]);

    if (loading) {
        return (
            <View style={styles.center}>
                <ActivityIndicator size="large" color="#6C3BFF" />
                <Text style={styles.loadingText}>Finding the best free-time suggestions…</Text>
            </View>
        );
    }

    return (
        <ScrollView style={styles.screen} contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
            <View style={styles.headerRow}>
                <Pressable style={styles.backButton} onPress={() => navigation.goBack()}>
                    <Text style={styles.backButtonText}>←</Text>
                </Pressable>
                <Text style={styles.headerTitle}>Free Time Suggestions</Text>
            </View>

            <View style={styles.infoCard}>
                <Text style={styles.infoTitle}>You have free time this evening</Text>
                <Text style={styles.infoSubtitle}>Here are great places that feel relevant right now.</Text>
                <View style={styles.infoChipRow}>
                    <View style={[styles.infoChip, styles.infoChipBlue]}>
                        <Text style={styles.infoChipText}>🕒 This time of day</Text>
                    </View>
                    <View style={[styles.infoChip, styles.infoChipPurple]}>
                        <Text style={styles.infoChipText}>📍 Nearby to you</Text>
                    </View>
                    <View style={[styles.infoChip, styles.infoChipPink]}>
                        <Text style={styles.infoChipText}>
                            {recommendations.length === 0 ? 'Showing closest nearby matches' : 'Live recommendations'}
                        </Text>
                    </View>
                </View>
            </View>

            <View style={styles.intentCard}>
                <Text style={styles.intentTitle}>What would you like to do?</Text>
                <View style={styles.primaryRow}>
                    {PRIMARY_OPTIONS.map((option) => {
                        const isActive = activePrimary === option.key;
                        return (
                            <Pressable
                                key={option.key}
                                style={[styles.primaryChip, isActive && styles.primaryChipActive]}
                                onPress={() => setActivePrimary(option.key)}
                            >
                                <Text style={[styles.primaryChipLabel, isActive && styles.primaryChipLabelActive]}>
                                    {option.icon} {option.label}
                                </Text>
                            </Pressable>
                        );
                    })}
                </View>

                <Text style={styles.detailLabel}>More specific</Text>
                <View style={styles.detailGrid}>
                    {DETAIL_OPTIONS[activePrimary].map((option) => (
                        <View key={option} style={styles.detailChip}>
                            <Text style={styles.detailChipText}>{option}</Text>
                        </View>
                    ))}
                </View>
            </View>

            {renderedCards.map((item) => (
                <SuggestionCard
                    key={item.id}
                    name={item.name}
                    subtitle={item.subtitle}
                    description={item.description}
                    rating={item.rating}
                    distanceLabel={item.distanceLabel}
                    imageUrl={item.imageUrl}
                    metaText={item.metaText}
                    primaryActionLabel={item.primaryActionLabel}
                    secondaryActionLabel={item.secondaryActionLabel}
                    onPrimaryAction={() => handleAddToPlan(item)}
                    onSecondaryAction={() => openMap(item.mapQuery)}
                />
            ))}

            {renderedCards.length === 0 ? (
                <View style={styles.emptyCard}>
                    <Text style={styles.emptyTitle}>No suggestions found right now</Text>
                    <Text style={styles.emptyText}>Try again in a moment or adjust your preferences from profile.</Text>
                </View>
            ) : null}

            <View style={styles.footerSpace} />
        </ScrollView>
    );
};

const handlePlanPayload = (item) => ({
    id: item.id,
    name: item.name,
    subtitle: item.subtitle,
    description: item.description,
    rating: item.rating,
    distanceLabel: item.distanceLabel,
    imageUrl: item.imageUrl,
    metaText: item.metaText,
    mapQuery: item.mapQuery,
});

const mapActivityToPrimary = (activityPreference) => {
    if (activityPreference === 'sightseeing') return 'explore';
    if (activityPreference === 'shopping') return 'shopping';
    return 'food';
};

const buildImageUrl = (name, type) => {
    const query = encodeURIComponent(`${name} ${type || 'travel place'}`);
    return `https://source.unsplash.com/900x600/?${query}`;
};

const buildCardSubtitle = (item) => {
    if (item.type === 'cafe') return 'Cafe suggestion';
    if (item.type === 'activity') return 'Explore suggestion';
    return 'Nearby recommendation';
};

const buildDistanceLabelFromReason = (reason) => {
    const lower = reason.toLowerCase();
    if (lower.includes('short break')) return 'Short break fit';
    if (lower.includes('quick')) return 'Fast option';
    if (lower.includes('walk')) return 'Easy outing';
    return 'Good nearby fit';
};

const buildNearbyDistance = (item) => {
    if (item.walk_eta_minutes) return `${item.walk_eta_minutes} min walk`;
    if (item.drive_eta_minutes) return `${item.drive_eta_minutes} min drive`;
    if (item.distance_meters) return `${item.distance_meters} m away`;
    return 'Close by';
};

const openMap = async (query) => {
    const url = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
    try {
        await Linking.openURL(url);
    } catch (error) {
        console.warn('Map open failed:', error);
    }
};

const styles = StyleSheet.create({
    screen: {
        flex: 1,
        backgroundColor: '#F8F9FB',
    },
    container: {
        paddingHorizontal: 18,
        paddingTop: 18,
        paddingBottom: 120,
    },
    center: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: '#F8F9FB',
    },
    loadingText: {
        marginTop: 12,
        fontSize: 16,
        color: '#6B6480',
    },
    headerRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
        marginBottom: 18,
    },
    backButton: {
        width: 48,
        height: 48,
        borderRadius: 24,
        backgroundColor: '#FFFFFF',
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1,
        borderColor: '#ECE6F8',
    },
    backButtonText: {
        fontSize: 24,
        color: '#1B1530',
        marginTop: -2,
    },
    headerTitle: {
        fontSize: 22,
        fontWeight: '800',
        color: '#171329',
    },
    infoCard: {
        backgroundColor: '#FFFFFF',
        borderRadius: 28,
        padding: 20,
        borderWidth: 1,
        borderColor: '#ECE6F8',
        shadowColor: 'rgba(60, 32, 122, 0.1)',
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 1,
        shadowRadius: 22,
        elevation: 4,
        marginBottom: 18,
    },
    infoTitle: {
        fontSize: 20,
        fontWeight: '800',
        color: '#1B1530',
        marginBottom: 8,
    },
    infoSubtitle: {
        fontSize: 15,
        color: '#706A83',
        lineHeight: 22,
        marginBottom: 16,
    },
    infoChipRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 10,
    },
    infoChip: {
        borderRadius: 999,
        paddingVertical: 10,
        paddingHorizontal: 14,
    },
    infoChipBlue: {
        backgroundColor: '#EDF1FF',
    },
    infoChipPurple: {
        backgroundColor: '#F4ECFF',
    },
    infoChipPink: {
        backgroundColor: '#FFF0F7',
    },
    infoChipText: {
        fontSize: 14,
        fontWeight: '700',
        color: '#5E43FF',
    },
    intentCard: {
        backgroundColor: '#FFFFFF',
        borderRadius: 28,
        padding: 20,
        borderWidth: 1,
        borderColor: '#ECE6F8',
        shadowColor: 'rgba(60, 32, 122, 0.1)',
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 1,
        shadowRadius: 22,
        elevation: 4,
        marginBottom: 18,
    },
    intentTitle: {
        fontSize: 18,
        fontWeight: '800',
        color: '#1B1530',
        marginBottom: 16,
    },
    primaryRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 10,
        marginBottom: 18,
    },
    primaryChip: {
        flex: 1,
        minWidth: 96,
        backgroundColor: '#F4F5F9',
        borderRadius: 18,
        paddingVertical: 14,
        paddingHorizontal: 16,
        alignItems: 'center',
    },
    primaryChipActive: {
        backgroundColor: '#6C3BFF',
    },
    primaryChipLabel: {
        fontSize: 16,
        fontWeight: '700',
        color: '#4A5166',
    },
    primaryChipLabelActive: {
        color: '#FFFFFF',
    },
    detailLabel: {
        fontSize: 16,
        fontWeight: '700',
        color: '#747086',
        marginBottom: 14,
    },
    detailGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 12,
    },
    detailChip: {
        minWidth: '47%',
        backgroundColor: '#FFFFFF',
        borderRadius: 18,
        borderWidth: 1,
        borderColor: '#E6E0F2',
        paddingVertical: 14,
        paddingHorizontal: 18,
        alignItems: 'center',
    },
    detailChipText: {
        fontSize: 15,
        fontWeight: '700',
        color: '#46516B',
    },
    emptyCard: {
        backgroundColor: '#FFFFFF',
        borderRadius: 28,
        padding: 22,
        borderWidth: 1,
        borderColor: '#ECE6F8',
        alignItems: 'center',
    },
    emptyTitle: {
        fontSize: 18,
        fontWeight: '800',
        color: '#1B1530',
        marginBottom: 8,
    },
    emptyText: {
        fontSize: 15,
        color: '#7D7692',
        textAlign: 'center',
        lineHeight: 22,
    },
    footerSpace: {
        height: 26,
    },
});

export default RecommendationScreen;
