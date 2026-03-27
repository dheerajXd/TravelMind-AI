import React, { useEffect, useMemo, useState } from 'react';
import {
    ActivityIndicator,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    View,
} from 'react-native';
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
    });
    const { formattedTime, temperatureLabel, coordsLabel, locationLabel, latitude, longitude } = useLiveContext();

    useEffect(() => {
        if (latitude != null && longitude != null) {
            loadExplore();
        }
    }, [latitude, longitude]);

    const loadExplore = async () => {
        setLoading(true);
        try {
            const [restaurantData, museumData, parkData] = await Promise.all([
                fetchNearbyPlaces(latitude, longitude, 'restaurant', 4000),
                fetchNearbyPlaces(latitude, longitude, 'museum', 4000),
                fetchNearbyPlaces(latitude, longitude, 'park', 4000),
            ]);

            setPlacesByCategory({
                restaurant: restaurantData,
                museum: museumData,
                park: parkData,
            });
        } catch (error) {
            console.warn('Explore load failed:', error);
        } finally {
            setLoading(false);
        }
    };

    const filteredItems = useMemo(() => {
        const all = [
            ...placesByCategory.restaurant.map((item) => ({ ...item, category: 'Restaurants' })),
            ...placesByCategory.museum.map((item) => ({ ...item, category: 'Museums' })),
            ...placesByCategory.park.map((item) => ({ ...item, category: 'Parks' })),
        ];

        const categoryFiltered = activeCategory === 'all'
            ? all
            : all.filter((item) => item.category.toLowerCase().startsWith(activeCategory));

        if (!query.trim()) {
            return categoryFiltered;
        }

        const normalizedQuery = query.trim().toLowerCase();
        return categoryFiltered.filter((item) =>
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

    if (loading) {
        return (
            <View style={styles.center}>
                <ActivityIndicator size="large" color="#6C3BFF" />
                <Text style={styles.loadingText}>Discovering nearby places…</Text>
            </View>
        );
    }

    return (
        <ScrollView style={styles.screen} contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
            <Text style={styles.title}>Explore {locationLabel}</Text>
            <Text style={styles.subtitle}>Discover amazing places around you</Text>

            <TopInfoBar
                timeLabel={formattedTime}
                temperatureLabel={temperatureLabel}
                coordsLabel={coordsLabel}
                locationLabel={locationLabel}
            />

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
                        <Text
                            key={item.key}
                            onPress={() => setActiveCategory(item.key)}
                            style={[styles.tabChip, isActive && styles.tabChipActive, isActive && styles.tabChipTextActive]}
                        >
                            {item.label}
                        </Text>
                    );
                })}
            </View>

            <View style={styles.sectionHeadingRow}>
                <Text style={styles.sectionHeading}>{sectionTitle}</Text>
            </View>

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

            {filteredItems.length === 0 ? (
                <View style={styles.emptyWrap}>
                    <Text style={styles.emptyTitle}>No places match this filter yet</Text>
                    <Text style={styles.emptyText}>Try another category or a broader search.</Text>
                </View>
            ) : null}

            <View style={styles.footerSpace} />
        </ScrollView>
    );
};

const styles = StyleSheet.create({
    screen: {
        flex: 1,
        backgroundColor: '#F8F9FB',
    },
    container: {
        paddingHorizontal: 18,
        paddingTop: 22,
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
    title: {
        fontSize: 24,
        fontWeight: '800',
        color: '#171329',
        letterSpacing: -0.7,
        marginBottom: 6,
    },
    subtitle: {
        fontSize: 15,
        color: '#6B6480',
        marginBottom: 18,
    },
    searchWrap: {
        marginTop: 18,
        marginBottom: 18,
    },
    searchInput: {
        minHeight: 58,
        backgroundColor: '#FFFFFF',
        borderRadius: 20,
        paddingHorizontal: 22,
        fontSize: 16,
        color: '#1D1733',
        borderWidth: 1,
        borderColor: '#ECE6F8',
        shadowColor: 'rgba(60, 32, 122, 0.08)',
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 1,
        shadowRadius: 20,
        elevation: 3,
    },
    tabsRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 12,
        marginBottom: 22,
    },
    tabChip: {
        backgroundColor: '#FFFFFF',
        borderRadius: 18,
        paddingHorizontal: 20,
        paddingVertical: 14,
        overflow: 'hidden',
        color: '#4B556B',
        fontSize: 15,
        fontWeight: '700',
        borderWidth: 1,
        borderColor: '#ECE6F8',
        shadowColor: 'rgba(60, 32, 122, 0.06)',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 1,
        shadowRadius: 14,
        elevation: 2,
    },
    tabChipActive: {
        backgroundColor: '#6C3BFF',
        borderColor: '#6C3BFF',
        color: '#FFFFFF',
    },
    tabChipTextActive: {
        color: '#FFFFFF',
    },
    sectionHeadingRow: {
        marginBottom: 14,
    },
    sectionHeading: {
        fontSize: 20,
        fontWeight: '800',
        color: '#171329',
    },
    emptyWrap: {
        marginTop: 30,
        backgroundColor: '#FFFFFF',
        borderRadius: 24,
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
        height: 24,
    },
});

export default ExploreScreen;
