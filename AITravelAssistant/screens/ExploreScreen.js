import React, { useEffect, useMemo, useState } from 'react';
import {
    ActivityIndicator,
    Linking,
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
import { useLiveContext } from '../context/LiveContext';
import {
    fetchUserContext,
    getOrCreateUserId,
    getPlannedItems,
    togglePlannedItem,
} from '../services/backendService';
import {
    fetchNearbyPlaces,
    fetchPlaceSuggestions,
    searchPlaces,
} from '../services/placesService';

const CATEGORY_CONFIG = [
    { key: 'all', label: 'All', type: 'popular places' },
    { key: 'restaurant', label: 'Restaurants', type: 'restaurant' },
    { key: 'cafe', label: 'Cafes', type: 'cafe' },
    { key: 'museum', label: 'Museums', type: 'museum' },
    { key: 'park', label: 'Parks', type: 'park' },
    { key: 'shopping', label: 'Shopping', type: 'shopping mall' },
    { key: 'street_food', label: 'Street Food', type: 'street food' },
];

const QUICK_ACTIONS = [
    { key: 'food', label: 'Food near me', emoji: '🍽', type: 'restaurant', categoryKey: 'restaurant', radius: 3500 },
    { key: 'cafe', label: 'Cafe break', emoji: '☕', type: 'cafe', categoryKey: 'cafe', radius: 3000 },
    { key: 'park', label: 'Relax / Parks', emoji: '🌳', type: 'park', categoryKey: 'park', radius: 5000 },
    { key: 'walkable', label: 'Walkable places', emoji: '🚶', type: 'attraction', categoryKey: 'all', radius: 1800 },
];

const SEARCH_MODES = [
    { key: 'nearby', label: '📍 Near You' },
    { key: 'global', label: '🌍 Search Anywhere' },
];

const INITIAL_CATEGORY_DATA = {
    restaurant: [],
    cafe: [],
    museum: [],
    park: [],
    shopping: [],
    street_food: [],
    popular: [],
};

const ExploreScreen = () => {
    const {
        formattedTime,
        temperatureLabel,
        coordsLabel,
        locationLabel,
        latitude,
        longitude,
        currentTime,
        weather,
        shortLocation,
    } = useLiveContext();

    const [loading, setLoading] = useState(true);
    const [searchLoading, setSearchLoading] = useState(false);
    const [activeCategory, setActiveCategory] = useState('all');
    const [searchMode, setSearchMode] = useState('nearby');
    const [query, setQuery] = useState('');
    const [debouncedQuery, setDebouncedQuery] = useState('');
    const [suggestions, setSuggestions] = useState([]);
    const [loadingSuggestions, setLoadingSuggestions] = useState(false);
    const [selectedSearchOrigin, setSelectedSearchOrigin] = useState(null);
    const [placesByCategory, setPlacesByCategory] = useState(INITIAL_CATEGORY_DATA);
    const [searchResults, setSearchResults] = useState([]);
    const [fallbackResults, setFallbackResults] = useState([]);
    const [fallbackMessage, setFallbackMessage] = useState('');
    const [resultHeadline, setResultHeadline] = useState('Trending Near You');
    const [activeQuickAction, setActiveQuickAction] = useState(null);
    const [plannedIds, setPlannedIds] = useState(new Set());
    const [userContext, setUserContext] = useState(null);

    useEffect(() => {
        const timeoutId = setTimeout(() => {
            setDebouncedQuery(query.trim());
        }, 300);
        return () => clearTimeout(timeoutId);
    }, [query]);

    useEffect(() => {
        if (latitude != null && longitude != null) {
            loadExplore();
            loadUserContext();
            loadPlannedIds();
        }
    }, [latitude, longitude]);

    useEffect(() => {
        if (latitude == null || longitude == null) {
            return;
        }

        if (!debouncedQuery || debouncedQuery.length < 2) {
            setSuggestions([]);
            setLoadingSuggestions(false);
            return;
        }

        let active = true;
        setLoadingSuggestions(true);

        fetchPlaceSuggestions({
            query: debouncedQuery,
            latitude,
            longitude,
            global: searchMode === 'global',
        })
            .then((items) => {
                if (!active) return;
                setSuggestions(items);
            })
            .catch((error) => {
                console.warn('Explore suggestions failed:', error);
                if (active) {
                    setSuggestions([]);
                }
            })
            .finally(() => {
                if (active) {
                    setLoadingSuggestions(false);
                }
            });

        return () => {
            active = false;
        };
    }, [debouncedQuery, latitude, longitude, searchMode]);

    useEffect(() => {
        if (latitude == null || longitude == null) {
            return;
        }

        if (!debouncedQuery) {
            setSearchResults([]);
            setFallbackResults([]);
            setFallbackMessage('');
            setResultHeadline(getSectionTitle(activeCategory));
            return;
        }

        let active = true;
        runSearch({
            searchTerm: debouncedQuery,
            categoryKey: activeCategory,
            mode: searchMode,
            sourceLabel: searchMode === 'global' ? `Results around ${debouncedQuery}` : `Matches for "${debouncedQuery}"`,
            originOverride: searchMode === 'global' ? selectedSearchOrigin : null,
        })
            .then((result) => {
                if (!active) return;
                applySearchOutcome(result);
            })
            .catch((error) => {
                console.warn('Explore query search failed:', error);
                if (active) {
                    setSearchResults([]);
                    setFallbackResults(placesByCategory.popular || []);
                    setFallbackMessage('Showing popular nearby places instead.');
                    setResultHeadline('Results near you');
                }
            });

        return () => {
            active = false;
        };
    }, [activeCategory, debouncedQuery, latitude, longitude, searchMode]);

    const loadUserContext = async () => {
        try {
            const userId = await getOrCreateUserId();
            const context = await fetchUserContext(userId).catch(() => null);
            setUserContext(context?.context || null);
        } catch (error) {
            console.warn('Explore user context failed:', error);
        }
    };

    const loadPlannedIds = async () => {
        try {
            const items = await getPlannedItems();
            setPlannedIds(new Set(items.map((item) => item.id)));
        } catch (error) {
            console.warn('Explore planned items failed:', error);
        }
    };

    const loadExplore = async () => {
        setLoading(true);
        try {
            const initialResults = await Promise.allSettled([
                fetchNearbyPlaces(latitude, longitude, 'restaurant', 3500),
                fetchNearbyPlaces(latitude, longitude, 'cafe', 3500),
                fetchNearbyPlaces(latitude, longitude, 'museum', 5000),
                fetchNearbyPlaces(latitude, longitude, 'park', 5000),
                fetchNearbyPlaces(latitude, longitude, 'shopping mall', 6000),
                fetchNearbyPlaces(latitude, longitude, 'street food', 4500),
                fetchNearbyPlaces(latitude, longitude, null, 6000),
            ]);

            let nextCategoryData = {
                restaurant: normalizePlaces(getSettledPlaces(initialResults[0])),
                cafe: normalizePlaces(getSettledPlaces(initialResults[1])),
                museum: normalizePlaces(getSettledPlaces(initialResults[2])),
                park: normalizePlaces(getSettledPlaces(initialResults[3])),
                shopping: normalizePlaces(getSettledPlaces(initialResults[4])),
                street_food: normalizePlaces(getSettledPlaces(initialResults[5])),
                popular: normalizePlaces(getSettledPlaces(initialResults[6])),
            };

            console.log('Explore initial category summary:', summarizeCategoryData(nextCategoryData));

            if (!hasAnyPlaces(nextCategoryData)) {
                const expandedResults = await Promise.allSettled([
                    fetchNearbyPlaces(latitude, longitude, 'restaurant', 8000),
                    fetchNearbyPlaces(latitude, longitude, 'cafe', 7000),
                    fetchNearbyPlaces(latitude, longitude, 'museum', 10000),
                    fetchNearbyPlaces(latitude, longitude, 'park', 10000),
                    fetchNearbyPlaces(latitude, longitude, 'shopping mall', 10000),
                    fetchNearbyPlaces(latitude, longitude, 'street food', 8000),
                    fetchNearbyPlaces(latitude, longitude, null, 10000),
                ]);

                nextCategoryData = {
                    restaurant: normalizePlaces(getSettledPlaces(expandedResults[0])),
                    cafe: normalizePlaces(getSettledPlaces(expandedResults[1])),
                    museum: normalizePlaces(getSettledPlaces(expandedResults[2])),
                    park: normalizePlaces(getSettledPlaces(expandedResults[3])),
                    shopping: normalizePlaces(getSettledPlaces(expandedResults[4])),
                    street_food: normalizePlaces(getSettledPlaces(expandedResults[5])),
                    popular: normalizePlaces(getSettledPlaces(expandedResults[6])),
                };
                console.log('Explore expanded category summary:', summarizeCategoryData(nextCategoryData));
            }

            setPlacesByCategory(nextCategoryData);
            setFallbackResults(nextCategoryData.popular);
            setFallbackMessage(nextCategoryData.popular.length ? 'Showing popular nearby places.' : '');
        } catch (error) {
            console.warn('Explore load failed:', error);
        } finally {
            setLoading(false);
        }
    };

    const runSearch = async ({
        searchTerm,
        categoryKey,
        mode,
        sourceLabel,
        radiusOverride,
        originOverride = null,
    }) => {
        setSearchLoading(true);

        const primaryResults = await fetchSearchLayer({
            searchTerm,
            categoryKey,
            mode,
            radius: radiusOverride || 5000,
            originOverride,
        });

        let fallbackPool = [];
        let nextFallbackMessage = '';

        if (primaryResults.length === 0) {
            fallbackPool = await fetchSearchLayer({
                searchTerm,
                categoryKey,
                mode,
                radius: mode === 'nearby' ? 10000 : 15000,
                broadenCategory: true,
                originOverride,
            });
            if (fallbackPool.length > 0) {
                nextFallbackMessage = mode === 'global'
                    ? `Showing broader spots around ${originOverride?.name || searchTerm}.`
                    : 'No exact matches yet, so we broadened the search for you.';
            }
        }

        if (primaryResults.length === 0 && fallbackPool.length === 0) {
            if (mode === 'global') {
                if (originOverride?.lat != null && originOverride?.lng != null) {
                    fallbackPool = dedupePlaces(
                        await fetchNearbyPlaces(originOverride.lat, originOverride.lng, null, 12000).catch(() => [])
                    );
                }
            } else {
                fallbackPool = dedupePlaces([
                    ...(placesByCategory.popular || []),
                    ...(await fetchNearbyPlaces(latitude, longitude, null, 10000).catch(() => [])),
                ]);
            }
            if (fallbackPool.length > 0) {
                nextFallbackMessage = mode === 'global'
                    ? `✨ Popular around ${originOverride?.name || searchTerm}`
                    : '✨ Popular Nearby';
            }
        }

        setSearchLoading(false);
        return {
            results: primaryResults,
            fallback: fallbackPool,
            fallbackMessage: nextFallbackMessage,
            headline: sourceLabel,
        };
    };

    const fetchSearchLayer = async ({
        searchTerm,
        categoryKey,
        mode,
        radius,
        broadenCategory = false,
        originOverride = null,
    }) => {
        const effectiveCategory = broadenCategory ? 'all' : categoryKey;
        const searchType = buildSearchType({
            categoryKey: effectiveCategory,
            searchTerm,
            mode,
        });

        if (mode === 'global' && originOverride?.lat != null && originOverride?.lng != null) {
            return normalizePlaces(
                await searchPlaces({
                    latitude: originOverride.lat,
                    longitude: originOverride.lng,
                    type: searchType,
                    radius,
                }).catch((error) => {
                    console.warn('Explore global origin search failed:', error);
                    return [];
                })
            );
        }

        if (mode === 'global') {
            return normalizePlaces(
                await searchPlaces({
                    location: searchTerm,
                    type: searchType,
                    radius,
                }).catch((error) => {
                    console.warn('Explore global search failed:', error);
                    return [];
                })
            );
        }

        return normalizePlaces(
            await searchPlaces({
                latitude,
                longitude,
                type: searchType,
                radius,
            }).catch((error) => {
                console.warn('Explore nearby search failed:', error);
                return [];
            })
        );
    };

    const applySearchOutcome = ({ results, fallback, fallbackMessage: message, headline }) => {
        setSearchResults(results);
        setFallbackResults(fallback);
        setFallbackMessage(message);
        setResultHeadline(headline);
    };

    const handleSuggestionSelect = async (item) => {
        setQuery(item.name);
        setSuggestions([]);
        const origin = {
            name: item.name,
            lat: item.lat ?? item.location?.lat ?? null,
            lng: item.lng ?? item.location?.lng ?? null,
        };
        setSelectedSearchOrigin(origin);
        try {
            const result = await runSearch({
                searchTerm: item.name,
                categoryKey: activeCategory,
                mode: searchMode,
                sourceLabel: searchMode === 'global' ? `Results around ${item.name}` : `Matches for "${item.name}"`,
                originOverride: searchMode === 'global' ? origin : null,
            });
            applySearchOutcome(result);
        } catch (error) {
            console.warn('Explore suggestion search failed:', error);
        }
    };

    const handleQuickAction = async (action) => {
        setActiveQuickAction(action.key);
        setActiveCategory(action.categoryKey);
        setQuery('');
        setSuggestions([]);
        setSelectedSearchOrigin(null);
        try {
            const result = await runSearch({
                searchTerm: action.type,
                categoryKey: action.categoryKey,
                mode: 'nearby',
                sourceLabel: action.label,
                radiusOverride: action.radius,
            });
            applySearchOutcome(result);
        } catch (error) {
            console.warn('Explore quick action failed:', error);
        }
    };

    const handleAddToPlan = async (item) => {
        try {
            const result = await togglePlannedItem({
                id: item.id,
                name: item.name,
                address: item.address || item.vicinity,
                lat: item.lat ?? item.location?.lat ?? null,
                lng: item.lng ?? item.location?.lng ?? null,
                rating: item.rating === 'N/A' ? null : item.rating,
                imageUrl: item.photoUrl || null,
                category: categoryLabelFor(item.normalizedCategory),
            });
            setPlannedIds(new Set(result.items.map((entry) => entry.id)));
        } catch (error) {
            console.warn('Explore add to plan failed:', error);
        }
    };

    const handleOpenMap = async (item) => {
        const queryText = item.name || item.address || locationLabel;
        const lat = item.lat ?? item.location?.lat;
        const lng = item.lng ?? item.location?.lng;
        const url = lat != null && lng != null
            ? `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`
            : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(queryText)}`;

        try {
            await Linking.openURL(url);
        } catch (error) {
            console.warn('Explore map open failed:', error);
        }
    };

    const aiBannerText = useMemo(() => {
        const hour = currentTime.getHours();
        const preference = userContext?.onboarding_profile?.free_time_preference;
        const cuisine = userContext?.onboarding_profile?.cuisine_preference;
        const priority = userContext?.onboarding_profile?.decision_priority;
        const weatherCondition = weather?.condition?.toLowerCase?.() || '';

        if (hour >= 18) {
            return `🧠 AI Suggestion: It's evening — try nearby ${preference === 'coffee' ? 'cafes' : 'quick dinner spots'} around ${shortLocation}.`;
        }
        if (weatherCondition.includes('rain')) {
            return '🧠 AI Suggestion: Rainy conditions make indoor cafes, museums, and cozy stops a better fit right now.';
        }
        if (priority === 'quiet') {
            return '🧠 AI Suggestion: Looking for calmer picks? Explore quieter parks, museums, and cafes nearby.';
        }
        if (cuisine) {
            return `🧠 AI Suggestion: Since you enjoy ${cuisine}, we’re prioritizing nearby fits that match that taste.`;
        }
        return '🧠 AI Suggestion: Start with popular nearby places, then refine by category or search anywhere.';
    }, [currentTime, shortLocation, userContext, weather]);

    const trendingCards = useMemo(() => {
        return dedupePlaces([
            ...(placesByCategory.popular || []),
            ...(placesByCategory.cafe || []),
            ...(placesByCategory.restaurant || []),
        ]).slice(0, 8);
    }, [placesByCategory]);

    const visibleItems = useMemo(() => {
        if (searchResults.length > 0) {
            return dedupePlaces(searchResults);
        }

        if (activeQuickAction && fallbackResults.length > 0) {
            return dedupePlaces(fallbackResults);
        }

        if (activeCategory === 'all') {
            return dedupePlaces([
                ...(placesByCategory.popular || []),
                ...(placesByCategory.restaurant || []),
                ...(placesByCategory.cafe || []),
                ...(placesByCategory.museum || []),
                ...(placesByCategory.park || []),
                ...(placesByCategory.shopping || []),
                ...(placesByCategory.street_food || []),
            ]);
        }

        return dedupePlaces(placesByCategory[activeCategory] || []);
    }, [activeCategory, activeQuickAction, fallbackResults, placesByCategory, searchResults]);

    const noExactResults = searchResults.length === 0 && fallbackResults.length > 0 && Boolean(debouncedQuery || activeQuickAction);

    if (loading) {
        return (
            <LinearGradient
                colors={['#F8F9FB', '#F5F2FF', '#FFF7FD']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.screen}
            >
                <View style={styles.center}>
                    <ActivityIndicator size="large" color="#6D5DF6" />
                    <Text style={styles.loadingText}>Discovering nearby places…</Text>
                    <View style={styles.skeletonStack}>
                        {[0, 1, 2].map((item) => (
                            <View key={item} style={styles.skeletonCard} />
                        ))}
                    </View>
                </View>
            </LinearGradient>
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

                <View style={styles.searchModeRow}>
                    {SEARCH_MODES.map((mode) => {
                        const isActive = searchMode === mode.key;
                        return (
                            <Pressable
                                key={mode.key}
                                onPress={() => setSearchMode(mode.key)}
                                style={({ pressed }) => [styles.searchModeChip, pressed && styles.interactiveChip]}
                            >
                                {isActive ? (
                                    <LinearGradient
                                        colors={['#6D5DF6', '#7C3AED']}
                                        start={{ x: 0, y: 0 }}
                                        end={{ x: 1, y: 1 }}
                                        style={styles.searchModeActive}
                                    >
                                        <Text style={styles.searchModeTextActive}>{mode.label}</Text>
                                    </LinearGradient>
                                ) : (
                                    <View style={styles.searchModeInactive}>
                                        <Text style={styles.searchModeText}>{mode.label}</Text>
                                    </View>
                                )}
                            </Pressable>
                        );
                    })}
                </View>

                <View style={styles.searchWrap}>
                    <TextInput
                        value={query}
                        onChangeText={(value) => {
                            setQuery(value);
                            setActiveQuickAction(null);
                            if (!selectedSearchOrigin || value.trim() !== selectedSearchOrigin.name) {
                                setSelectedSearchOrigin(null);
                            }
                        }}
                        placeholder={searchMode === 'global'
                            ? 'Search any city, place, or destination...'
                            : 'Search nearby places, cafes, activities...'}
                        placeholderTextColor="#9A97AA"
                        style={styles.searchInput}
                    />
                    {loadingSuggestions ? <ActivityIndicator style={styles.searchLoader} size="small" color="#6D5DF6" /> : null}
                    {suggestions.length > 0 ? (
                        <View style={styles.suggestionsWrap}>
                            {suggestions.map((item) => (
                                <Pressable
                                    key={`${item.id}-${item.name}`}
                                    onPress={() => handleSuggestionSelect(item)}
                                    style={({ pressed }) => [styles.suggestionRow, pressed && styles.suggestionRowPressed]}
                                >
                                    <Text style={styles.suggestionIcon}>{iconForCategory(item.normalizedCategory)}</Text>
                                    <View style={styles.suggestionTextWrap}>
                                        <Text style={styles.suggestionName} numberOfLines={1}>{item.name}</Text>
                                        <Text style={styles.suggestionMeta} numberOfLines={1}>
                                            {categoryLabelFor(item.normalizedCategory)} · {item.vicinity}
                                        </Text>
                                    </View>
                                </Pressable>
                            ))}
                        </View>
                    ) : null}
                </View>

                <View style={styles.quickActionsWrap}>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.quickActionsRow}>
                        {QUICK_ACTIONS.map((action) => {
                            const isActive = activeQuickAction === action.key;
                            return (
                                <Pressable
                                    key={action.key}
                                    onPress={() => handleQuickAction(action)}
                                    style={({ pressed }) => [styles.quickActionChip, (pressed || isActive) && styles.interactiveChip]}
                                >
                                    {isActive ? (
                                        <LinearGradient
                                            colors={['#6D5DF6', '#7C3AED']}
                                            start={{ x: 0, y: 0 }}
                                            end={{ x: 1, y: 1 }}
                                            style={styles.quickActionActive}
                                        >
                                            <Text style={styles.quickActionTextActive}>{`${action.emoji} ${action.label}`}</Text>
                                        </LinearGradient>
                                    ) : (
                                        <View style={styles.quickActionInactive}>
                                            <Text style={styles.quickActionText}>{`${action.emoji} ${action.label}`}</Text>
                                        </View>
                                    )}
                                </Pressable>
                            );
                        })}
                    </ScrollView>
                </View>

                <View style={styles.bannerCard}>
                    <Text style={styles.bannerText}>{aiBannerText}</Text>
                </View>

                <View style={styles.tabsRow}>
                    {CATEGORY_CONFIG.map((item) => {
                        const isActive = activeCategory === item.key;
                        return (
                            <Pressable
                                key={item.key}
                                onPress={() => {
                                    setActiveCategory(item.key);
                                    setActiveQuickAction(null);
                                }}
                                style={({ pressed, hovered }) => [
                                    styles.tabChip,
                                    (pressed || hovered) && styles.interactiveChip,
                                ]}
                            >
                                {isActive ? (
                                    <LinearGradient
                                        colors={['#6D5DF6', '#7C3AED']}
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
                    <Text style={styles.sectionHeading}>Trending Near You</Text>
                    <Text style={styles.sectionSupport}>Live picks with photos, ratings, and quick actions.</Text>
                </View>

                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.trendingRow}>
                    {trendingCards.map((item) => (
                        <Pressable
                            key={`trending-${item.id}`}
                            onPress={() => handleSuggestionSelect(item)}
                            style={({ pressed }) => [styles.trendingCard, pressed && styles.interactiveCard]}
                        >
                            <View style={styles.trendingImageWrap}>
                                <SuggestionCard
                                    compact
                                    name={item.name}
                                    subtitle={categoryLabelFor(item.normalizedCategory)}
                                    rating={item.rating === 'N/A' ? null : item.rating}
                                    metaText={buildDistanceLabel(item, latitude, longitude)}
                                    imageUrl={item.photoUrl}
                                />
                            </View>
                        </Pressable>
                    ))}
                </ScrollView>

                <View style={styles.sectionHeadingRow}>
                    <Text style={styles.sectionHeading}>{resultHeadline}</Text>
                    <Text style={styles.sectionSupport}>
                            {noExactResults
                                ? '✨ Popular Nearby'
                                : searchLoading
                                    ? 'Finding the best nearby fits for you…'
                                    : searchMode === 'global' && selectedSearchOrigin?.name
                                        ? `Showing places around ${selectedSearchOrigin.name}.`
                                        : 'Smart results based on your location, search mode, and filters.'}
                    </Text>
                </View>

                {searchLoading ? (
                    <View style={styles.resultsList}>
                        {[0, 1].map((item) => (
                            <View key={`loading-${item}`} style={styles.resultSkeleton} />
                        ))}
                    </View>
                ) : null}

                {!searchLoading && visibleItems.length > 0 ? (
                    <View style={styles.resultsList}>
                        {visibleItems.map((item) => (
                            <SuggestionCard
                                key={`${item.normalizedCategory}-${item.id}`}
                                name={item.name}
                                subtitle={categoryLabelFor(item.normalizedCategory)}
                                rating={item.rating === 'N/A' ? null : item.rating}
                                metaText={item.vicinity}
                                imageUrl={item.photoUrl}
                                distanceLabel={buildDistanceLabel(item, latitude, longitude)}
                                description={buildDescription(item)}
                                primaryActionLabel={plannedIds.has(item.id) ? 'Added to Plan' : 'Add to Plan'}
                                secondaryActionLabel="Map"
                                onPrimaryAction={() => handleAddToPlan(item)}
                                onSecondaryAction={() => handleOpenMap(item)}
                            />
                        ))}
                    </View>
                ) : null}

                {!searchLoading && visibleItems.length === 0 ? (
                    <View style={styles.emptyWrap}>
                        <Text style={styles.emptyTitle}>No exact matches right now</Text>
                        <Text style={styles.emptyText}>
                            Try another category, switch search mode, or start with the popular nearby picks below.
                        </Text>
                    </View>
                ) : null}

                {!searchLoading && fallbackResults.length > 0 && searchResults.length === 0 ? (
                    <View style={styles.popularWrap}>
                        <View style={styles.sectionHeadingRow}>
                            <Text style={styles.sectionHeading}>✨ Popular Nearby</Text>
                            <Text style={styles.sectionSupport}>
                                {fallbackMessage || 'Top-rated and close-by spots so Explore never feels empty.'}
                            </Text>
                        </View>

                        <View style={styles.resultsList}>
                            {dedupePlaces(fallbackResults).slice(0, 6).map((item) => (
                                <SuggestionCard
                                    key={`fallback-${item.id}`}
                                    name={item.name}
                                    subtitle={categoryLabelFor(item.normalizedCategory)}
                                    rating={item.rating === 'N/A' ? null : item.rating}
                                    metaText={item.vicinity}
                                    imageUrl={item.photoUrl}
                                    distanceLabel={buildDistanceLabel(item, latitude, longitude)}
                                    description={buildDescription(item)}
                                    primaryActionLabel={plannedIds.has(item.id) ? 'Added to Plan' : 'Add to Plan'}
                                    secondaryActionLabel="Map"
                                    onPrimaryAction={() => handleAddToPlan(item)}
                                    onSecondaryAction={() => handleOpenMap(item)}
                                />
                            ))}
                        </View>
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
        paddingHorizontal: 24,
    },
    loadingText: {
        marginTop: 12,
        fontSize: 16,
        color: '#6B6480',
    },
    skeletonStack: {
        width: '100%',
        gap: 16,
        marginTop: 24,
    },
    skeletonCard: {
        height: 148,
        borderRadius: 20,
        backgroundColor: '#FFFFFF',
        shadowColor: '#000000',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.05,
        shadowRadius: 20,
        elevation: 3,
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
    searchModeRow: {
        flexDirection: 'row',
        gap: 12,
        marginBottom: 16,
    },
    searchModeChip: {
        flex: 1,
        borderRadius: 20,
        overflow: 'hidden',
    },
    searchModeActive: {
        minHeight: 48,
        borderRadius: 20,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 16,
    },
    searchModeInactive: {
        minHeight: 48,
        borderRadius: 20,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 16,
        backgroundColor: '#F1F3F8',
    },
    searchModeText: {
        color: '#4B556B',
        fontSize: 15,
        fontWeight: '700',
    },
    searchModeTextActive: {
        color: '#FFFFFF',
        fontSize: 15,
        fontWeight: '700',
    },
    searchWrap: {
        marginBottom: 16,
        position: 'relative',
    },
    searchInput: {
        minHeight: 56,
        backgroundColor: '#FFFFFF',
        borderRadius: 20,
        paddingHorizontal: 16,
        paddingRight: 52,
        fontSize: 16,
        color: '#1D1733',
        shadowColor: '#000000',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.05,
        shadowRadius: 20,
        elevation: 3,
    },
    searchLoader: {
        position: 'absolute',
        right: 16,
        top: 18,
    },
    suggestionsWrap: {
        marginTop: 8,
        backgroundColor: '#FFFFFF',
        borderRadius: 20,
        shadowColor: '#000000',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.05,
        shadowRadius: 20,
        elevation: 3,
        overflow: 'hidden',
    },
    suggestionRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderBottomWidth: 1,
        borderBottomColor: '#F1EDF9',
    },
    suggestionRowPressed: {
        backgroundColor: '#F8F4FF',
    },
    suggestionIcon: {
        fontSize: 18,
    },
    suggestionTextWrap: {
        flex: 1,
    },
    suggestionName: {
        fontSize: 15,
        fontWeight: '700',
        color: '#1B1530',
    },
    suggestionMeta: {
        marginTop: 2,
        fontSize: 13,
        color: '#7D7692',
    },
    quickActionsWrap: {
        marginBottom: 24,
    },
    quickActionsRow: {
        paddingRight: 4,
        gap: 12,
    },
    quickActionChip: {
        borderRadius: 20,
        overflow: 'hidden',
    },
    quickActionActive: {
        minHeight: 48,
        paddingHorizontal: 16,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 20,
    },
    quickActionInactive: {
        minHeight: 48,
        paddingHorizontal: 16,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 20,
        backgroundColor: '#FFFFFF',
        shadowColor: '#000000',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.05,
        shadowRadius: 20,
        elevation: 3,
    },
    quickActionText: {
        fontSize: 14,
        fontWeight: '700',
        color: '#4B556B',
    },
    quickActionTextActive: {
        fontSize: 14,
        fontWeight: '700',
        color: '#FFFFFF',
    },
    bannerCard: {
        marginBottom: 24,
        borderRadius: 20,
        padding: 16,
        backgroundColor: '#FFFFFF',
        shadowColor: '#000000',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.05,
        shadowRadius: 20,
        elevation: 3,
    },
    bannerText: {
        fontSize: 14,
        lineHeight: 22,
        fontWeight: '600',
        color: '#5A4EA8',
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
    interactiveChip: {
        transform: [{ scale: 0.985 }],
    },
    interactiveCard: {
        transform: [{ scale: 0.99 }],
    },
    tabChipGradient: {
        minHeight: 52,
        minWidth: 112,
        paddingHorizontal: 20,
        paddingVertical: 14,
        justifyContent: 'center',
        alignItems: 'center',
        borderRadius: 20,
    },
    tabChipInactive: {
        minHeight: 52,
        minWidth: 112,
        paddingHorizontal: 20,
        paddingVertical: 14,
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
    trendingRow: {
        gap: 16,
        paddingRight: 8,
        marginBottom: 24,
    },
    trendingCard: {
        width: 240,
    },
    trendingImageWrap: {
        width: '100%',
    },
    resultsList: {
        gap: 16,
    },
    resultSkeleton: {
        height: 320,
        borderRadius: 20,
        backgroundColor: '#FFFFFF',
        shadowColor: '#000000',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.05,
        shadowRadius: 20,
        elevation: 3,
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
    popularWrap: {
        marginTop: 24,
    },
    footerSpace: {
        height: 24,
    },
});

export default ExploreScreen;

const getSettledPlaces = (result) => (result.status === 'fulfilled' ? result.value : []);

const hasAnyPlaces = (categoryData) =>
    Object.values(categoryData).some((items) => Array.isArray(items) && items.length > 0);

const getCategorySearchType = (categoryKey) =>
    CATEGORY_CONFIG.find((item) => item.key === categoryKey)?.type || 'popular places';

const getSectionTitle = (categoryKey) =>
    CATEGORY_CONFIG.find((item) => item.key === categoryKey)?.label || 'Trending Near You';

const buildSearchType = ({ categoryKey, searchTerm, mode }) => {
    const trimmed = searchTerm?.trim();
    if (mode === 'global') {
        return categoryKey === 'all' ? 'popular places' : getCategorySearchType(categoryKey);
    }
    if (trimmed) {
        return trimmed;
    }
    return categoryKey === 'all' ? 'popular places' : getCategorySearchType(categoryKey);
};

const normalizePlaces = (items) =>
    items.map((item) => ({
        ...item,
        normalizedCategory: normalizePlaceCategory(item),
    }));

const normalizePlaceCategory = (place) => {
    const types = Array.isArray(place.types) ? place.types.map((type) => String(type).toLowerCase()) : [];
    if (types.some((type) => ['cafe', 'coffee_shop', 'bakery'].includes(type))) {
        return 'cafe';
    }
    if (types.some((type) => ['restaurant', 'food', 'meal_takeaway', 'meal_delivery'].includes(type))) {
        return 'restaurant';
    }
    if (types.some((type) => ['museum', 'art_gallery'].includes(type))) {
        return 'museum';
    }
    if (types.some((type) => ['park', 'campground', 'rv_park'].includes(type))) {
        return 'park';
    }
    if (types.some((type) => ['shopping_mall', 'department_store', 'store'].includes(type))) {
        return 'shopping';
    }
    if (types.some((type) => ['meal_takeaway', 'food_court'].includes(type))) {
        return 'street_food';
    }
    return 'all';
};

const categoryLabelFor = (normalizedCategory) => {
    if (normalizedCategory === 'restaurant') return 'Restaurants';
    if (normalizedCategory === 'cafe') return 'Cafes';
    if (normalizedCategory === 'museum') return 'Museums';
    if (normalizedCategory === 'park') return 'Parks';
    if (normalizedCategory === 'shopping') return 'Shopping';
    if (normalizedCategory === 'street_food') return 'Street Food';
    return 'Popular nearby';
};

const iconForCategory = (normalizedCategory) => {
    if (normalizedCategory === 'restaurant') return '🍽';
    if (normalizedCategory === 'cafe') return '☕';
    if (normalizedCategory === 'museum') return '🖼';
    if (normalizedCategory === 'park') return '🌳';
    if (normalizedCategory === 'shopping') return '🛍';
    if (normalizedCategory === 'street_food') return '🥟';
    return '📍';
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
    cafe: categoryData.cafe.length,
    museum: categoryData.museum.length,
    park: categoryData.park.length,
    shopping: categoryData.shopping.length,
    street_food: categoryData.street_food.length,
    popular: categoryData.popular.length,
});

const buildDistanceLabel = (item, latitude, longitude) => {
    const lat = item.lat ?? item.location?.lat;
    const lng = item.lng ?? item.location?.lng;
    if (lat == null || lng == null || latitude == null || longitude == null) {
        return 'Nearby';
    }
    const distanceMeters = getDistanceMeters(latitude, longitude, lat, lng);
    if (distanceMeters < 1000) {
        return `${Math.max(1, Math.round(distanceMeters / 80))} min walk`;
    }
    return `${(distanceMeters / 1000).toFixed(1)} km away`;
};

const buildDescription = (item) => {
    const category = categoryLabelFor(item.normalizedCategory).toLowerCase();
    if (item.openNow === true) {
        return `Open now and close by, this ${category} option is a strong fit for a quick stop.`;
    }
    if (item.rating && item.rating !== 'N/A') {
        return `Well-rated nearby choice with a ${item.rating}★ Google rating.`;
    }
    return `A nearby ${category} pick worth considering around your current area.`;
};

const getDistanceMeters = (lat1, lng1, lat2, lng2) => {
    const toRad = (value) => (value * Math.PI) / 180;
    const earthRadius = 6371000;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
        Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return earthRadius * c;
};
