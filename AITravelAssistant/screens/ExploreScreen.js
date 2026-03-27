import React, { useEffect, useMemo, useState } from 'react';
import {
    ActivityIndicator,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import SuggestionCard from '../components/SuggestionCard';
import TopInfoBar from '../components/TopInfoBar';
import { fetchNearbyPlaces } from '../services/placesService';
import { useLiveContext } from '../context/LiveContext';

const CATEGORY_CONFIG = [
    { key: 'all', label: 'All' },
    { key: 'restaurant', label: 'Restaurants' },
    { key: 'museum', label: 'Museums' },
    { key: 'park', label: 'Parks' },
];

const ExploreScreen = () => {
    const [loading, setLoading] = useState(true);
    const [activeCategory, setActiveCategory] = useState('all');
    const [query, setQuery] = useState('');
    const [placesByCategory, setPlacesByCategory] = useState({
        restaurant: [],
        museum: [],
        park: [],
        popular: [],
    });
    const [fallbackMessage, setFallbackMessage] = useState('');
    const { formattedTime, temperatureLabel, coordsLabel, locationLabel, latitude, longitude } = useLiveContext();

    useEffect(() => {
        if (latitude != null && longitude != null) {
            loadExplore();
        }
    }, [latitude, longitude]);

    const loadExplore = async () => {
        setLoading(true);
        try {
            const initialResults = await Promise.allSettled([
                fetchNearbyPlaces(latitude, longitude, 'restaurant', 4000),
                fetchNearbyPlaces(latitude, longitude, 'museum', 4000),
                fetchNearbyPlaces(latitude, longitude, 'park', 4000),
            ]);

            const initialCategoryData = {
                restaurant: getSettledPlaces(initialResults[0]),
                museum: getSettledPlaces(initialResults[1]),
                park: getSettledPlaces(initialResults[2]),
                popular: [],
            };

            console.log('Explore initial category summary:', summarizeCategoryData(initialCategoryData));

            let nextCategoryData = initialCategoryData;
            let nextFallbackMessage = '';

            if (!hasAnyPlaces(initialCategoryData)) {
                const expandedResults = await Promise.allSettled([
                    fetchNearbyPlaces(latitude, longitude, 'restaurant', 8000),
                    fetchNearbyPlaces(latitude, longitude, 'museum', 8000),
                    fetchNearbyPlaces(latitude, longitude, 'park', 8000),
                ]);

                nextCategoryData = {
                    restaurant: getSettledPlaces(expandedResults[0]),
                    museum: getSettledPlaces(expandedResults[1]),
                    park: getSettledPlaces(expandedResults[2]),
                    popular: [],
                };
                nextFallbackMessage = 'Showing broader nearby results.';
                console.log('Explore expanded-radius summary:', summarizeCategoryData(nextCategoryData));
            }

            if (!hasAnyPlaces(nextCategoryData)) {
                const popularNearby = await fetchNearbyPlaces(latitude, longitude, null, 8000).catch((error) => {
                    console.warn('Popular nearby fallback failed:', error);
                    return [];
                });

                nextCategoryData = {
                    ...nextCategoryData,
                    popular: popularNearby.map((place) => ({
                        ...place,
                        normalizedCategory: normalizePlaceCategory(place),
                    })),
                };
                nextFallbackMessage = 'Showing popular nearby places instead.';
                console.log('Explore popular fallback summary:', {
                    popularCount: nextCategoryData.popular.length,
                });
            }

            setPlacesByCategory(nextCategoryData);
            setFallbackMessage(nextFallbackMessage);
        } catch (error) {
            console.warn('Explore load failed:', error);
        } finally {
            setLoading(false);
        }
    };

    const filteredItems = useMemo(() => {
        const all = [
            ...placesByCategory.restaurant.map((item) => ({ ...item, category: 'Restaurants', normalizedCategory: 'restaurant' })),
            ...placesByCategory.museum.map((item) => ({ ...item, category: 'Museums', normalizedCategory: 'museum' })),
            ...placesByCategory.park.map((item) => ({ ...item, category: 'Parks', normalizedCategory: 'park' })),
            ...placesByCategory.popular.map((item) => ({
                ...item,
                category: categoryLabelFor(item.normalizedCategory),
                normalizedCategory: item.normalizedCategory,
            })),
        ];

        const deduped = dedupePlaces(all);

        const categoryFiltered = activeCategory === 'all'
            ? deduped
            : deduped.filter((item) => normalizeCategoryKey(item.normalizedCategory || item.category) === activeCategory);

        const fallbackFiltered = categoryFiltered.length === 0 && activeCategory !== 'all'
            ? deduped.filter((item) => item.normalizedCategory !== activeCategory)
            : categoryFiltered;

        if (!query.trim()) {
            return fallbackFiltered;
        }

        const normalizedQuery = query.trim().toLowerCase();
        return fallbackFiltered.filter((item) =>
            item.name.toLowerCase().includes(normalizedQuery) ||
            item.category.toLowerCase().includes(normalizedQuery) ||
            (item.vicinity || '').toLowerCase().includes(normalizedQuery)
        );
    }, [activeCategory, placesByCategory, query]);

    const sectionTitle = useMemo(() => {
        if (activeCategory === 'all') {
            return 'Trending Near You';
        }
        return CATEGORY_CONFIG.find((item) => item.key === activeCategory)?.label || 'Nearby Matches';
    }, [activeCategory]);

    const emptyStateMessage = useMemo(() => {
        if (filteredItems.length > 0) {
            if (activeCategory !== 'all') {
                const hasExactCategoryItems = filteredItems.some(
                    (item) => normalizeCategoryKey(item.normalizedCategory || item.category) === activeCategory
                );
                if (!hasExactCategoryItems) {
                    return `No exact ${sectionTitle.toLowerCase()} nearby, so we're showing other popular options around you.`;
                }
            }
            return fallbackMessage;
        }
        return 'We could not find exact matches yet. Try a broader search or explore popular nearby places.';
    }, [activeCategory, fallbackMessage, filteredItems, sectionTitle]);

    if (loading) {
        return (
            <View style={styles.center}>
                <ActivityIndicator size="large" color="#6C3BFF" />
                <Text style={styles.loadingText}>Discovering nearby places…</Text>
            </View>
        );
    }

    return (
        <LinearGradient
            colors={['#F8F9FB', '#F5F2FF', '#FFF7FD']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.screen}
        >
            <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
                <View style={styles.headerBlock}>
                    <Text style={styles.title}>Explore {locationLabel}</Text>
                    <Text style={styles.subtitle}>Discover amazing places around you</Text>
                </View>

                <View style={styles.majorBlock}>
                    <TopInfoBar
                        timeLabel={formattedTime}
                        temperatureLabel={temperatureLabel}
                        coordsLabel={coordsLabel}
                        locationLabel={locationLabel}
                    />
                </View>

                <View style={styles.searchWrap}>
                    <TextInput
                        value={query}
                        onChangeText={setQuery}
                        placeholder="Search places, activities..."
                        placeholderTextColor="#9A97AA"
                        style={styles.searchInput}
                    />
                </View>

                <View style={styles.tabsRow}>
                    {CATEGORY_CONFIG.map((item) => {
                        const isActive = activeCategory === item.key;
                        return (
                            <Pressable
                                key={item.key}
                                onPress={() => setActiveCategory(item.key)}
                                style={({ pressed, hovered }) => [
                                    styles.tabChip,
                                    (pressed || hovered) && styles.tabChipInteractive,
                                ]}
                            >
                                {isActive ? (
                                    <LinearGradient
                                        colors={['#6366F1', '#8B5CF6']}
                                        start={{ x: 0, y: 0 }}
                                        end={{ x: 1, y: 1 }}
                                        style={styles.tabChipGradient}
                                    >
                                        <Text style={styles.tabChipTextActive}>{item.label}</Text>
                                    </LinearGradient>
                                ) : (
                                    <View style={styles.tabChipInactive}>
                                        <Text style={styles.tabChipText}>{item.label}</Text>
                                    </View>
                                )}
                            </Pressable>
                        );
                    })}
                </View>

                <View style={styles.sectionHeadingRow}>
                    <Text style={styles.sectionHeading}>{sectionTitle}</Text>
                    {emptyStateMessage ? <Text style={styles.sectionSupport}>{emptyStateMessage}</Text> : null}
                </View>

                <View style={styles.resultsList}>
                    {filteredItems.map((item) => (
                        <SuggestionCard
                            key={`${item.category}-${item.id}`}
                            compact
                            name={item.name}
                            subtitle={item.category}
                            rating={item.rating === 'N/A' ? null : item.rating}
                            metaText={item.vicinity}
                            imageUrl={item.photoUrl}
                            trailingIcon="⌖"
                        />
                    ))}
                </View>

                {filteredItems.length === 0 ? (
                    <View style={styles.emptyWrap}>
                        <Text style={styles.emptyTitle}>No exact matches yet</Text>
                        <Text style={styles.emptyText}>Try another category, a broader search, or explore popular nearby places.</Text>
                    </View>
                ) : null}

                <View style={styles.footerSpace} />
            </ScrollView>
        </LinearGradient>
    );
};

const styles = StyleSheet.create({
    screen: {
        flex: 1,
    },
    container: {
        paddingHorizontal: 16,
        paddingTop: 24,
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
    headerBlock: {
        marginBottom: 24,
    },
    title: {
        fontSize: 24,
        fontWeight: '800',
        color: '#171329',
        letterSpacing: -0.7,
        marginBottom: 8,
    },
    subtitle: {
        fontSize: 16,
        color: '#6B6480',
        lineHeight: 24,
    },
    majorBlock: {
        marginBottom: 24,
    },
    searchWrap: {
        marginBottom: 24,
    },
    searchInput: {
        minHeight: 56,
        backgroundColor: '#FFFFFF',
        borderRadius: 20,
        paddingHorizontal: 16,
        fontSize: 16,
        color: '#1D1733',
        shadowColor: '#000000',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.05,
        shadowRadius: 20,
        elevation: 3,
    },
    tabsRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 12,
        marginBottom: 24,
    },
    tabChip: {
        borderRadius: 20,
        overflow: 'hidden',
        shadowColor: '#000000',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.05,
        shadowRadius: 20,
        elevation: 2,
    },
    tabChipInteractive: {
        transform: [{ scale: 0.985 }],
    },
    tabChipGradient: {
        minHeight: 56,
        minWidth: 124,
        paddingHorizontal: 20,
        paddingVertical: 16,
        justifyContent: 'center',
        alignItems: 'center',
        borderRadius: 20,
    },
    tabChipInactive: {
        minHeight: 56,
        minWidth: 124,
        paddingHorizontal: 20,
        paddingVertical: 16,
        justifyContent: 'center',
        alignItems: 'center',
        borderRadius: 20,
        backgroundColor: '#F1F3F8',
    },
    tabChipText: {
        color: '#4B556B',
        fontSize: 15,
        fontWeight: '700',
    },
    tabChipTextActive: {
        color: '#FFFFFF',
        fontSize: 15,
        fontWeight: '700',
    },
    sectionHeadingRow: {
        marginBottom: 16,
    },
    sectionHeading: {
        fontSize: 20,
        fontWeight: '800',
        color: '#171329',
    },
    sectionSupport: {
        marginTop: 8,
        fontSize: 14,
        color: '#7D7692',
        lineHeight: 20,
    },
    resultsList: {
        gap: 16,
    },
    emptyWrap: {
        marginTop: 8,
        backgroundColor: '#FFFFFF',
        borderRadius: 20,
        padding: 16,
        alignItems: 'center',
        shadowColor: '#000000',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.05,
        shadowRadius: 20,
        elevation: 3,
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
        height: 24,
    },
});

export default ExploreScreen;

const getSettledPlaces = (result) => (result.status === 'fulfilled' ? result.value : []);

const hasAnyPlaces = (categoryData) =>
    Object.values(categoryData).some((items) => Array.isArray(items) && items.length > 0);

const normalizeCategoryKey = (value) => {
    const lower = String(value || '').toLowerCase();
    if (lower.includes('restaurant') || lower.includes('food')) return 'restaurant';
    if (lower.includes('museum') || lower.includes('art_gallery')) return 'museum';
    if (lower.includes('park') || lower.includes('campground')) return 'park';
    return 'all';
};

const normalizePlaceCategory = (place) => {
    const types = Array.isArray(place.types) ? place.types : [];
    if (types.some((type) => ['restaurant', 'meal_takeaway', 'meal_delivery', 'food', 'cafe'].includes(type))) {
        return 'restaurant';
    }
    if (types.some((type) => ['museum', 'art_gallery'].includes(type))) {
        return 'museum';
    }
    if (types.some((type) => ['park', 'campground'].includes(type))) {
        return 'park';
    }
    return 'all';
};

const categoryLabelFor = (normalizedCategory) => {
    if (normalizedCategory === 'restaurant') return 'Restaurants';
    if (normalizedCategory === 'museum') return 'Museums';
    if (normalizedCategory === 'park') return 'Parks';
    return 'Popular nearby';
};

const dedupePlaces = (items) => {
    const seen = new Set();
    return items.filter((item) => {
        const key = item.id || `${item.name}-${item.vicinity}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
};

const summarizeCategoryData = (categoryData) => ({
    restaurant: categoryData.restaurant.length,
    museum: categoryData.museum.length,
    park: categoryData.park.length,
    popular: categoryData.popular.length,
});
