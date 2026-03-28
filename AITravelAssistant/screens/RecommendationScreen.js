import React, { useEffect, useMemo, useRef, useState } from 'react';
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
import {
    fetchSmartSuggestions,
    fetchUserContext,
    getOrCreateUserId,
    storeTravelContext,
} from '../services/backendService';
import { fetchNearbyPlaces } from '../services/placesService';
import { usePlan } from '../context/PlanContext';

const DISTANCE_RADII = {
    nearby: 2000,
    moderate: 5000,
    far: 10000,
};

const DISTANCE_FILTERS = [
    { key: 'nearby', label: 'Nearby' },
    { key: 'moderate', label: 'Moderate' },
    { key: 'far', label: 'Far' },
];

const RATING_FILTERS = [
    { key: '3.5', label: '3.5+' },
    { key: '4.0', label: '4.0+' },
    { key: '4.5', label: '4.5+' },
];

const TYPE_FILTERS = [
    { key: 'any', label: 'Any' },
    { key: 'cafe', label: 'Cafe' },
    { key: 'restaurant', label: 'Restaurant' },
];

const PAGE_SIZE = 5;
const LOADING_SKELETON_COUNT = 3;

const RecommendationScreen = ({ route, navigation }) => {
    const {
        userId,
        inferredTripType = 'leisure',
        activityPreference = 'explore',
        cuisinePreference = 'local food',
    } = route.params;
    const [loading, setLoading] = useState(true);
    const [retrying, setRetrying] = useState(false);
    const [hasRetried, setHasRetried] = useState(false);
    const [suggestions, setSuggestions] = useState([]);
    const [error, setError] = useState(null);
    const [distanceFilter, setDistanceFilter] = useState('moderate');
    const [ratingFilter, setRatingFilter] = useState('3.5');
    const [typeFilter, setTypeFilter] = useState('any');
    const [openNowOnly, setOpenNowOnly] = useState(false);
    const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
    const hasLoadedRef = useRef(false);
    const activeLoadIdRef = useRef(0);
    const { plan, addToPlan, isPlanned } = usePlan();

    useEffect(() => {
        loadSuggestions();
    }, []);

    useEffect(() => {
        if (!hasLoadedRef.current) {
            return;
        }
        loadSuggestions({
            distanceOverride: distanceFilter,
            ratingOverride: ratingFilter,
            typeOverride: typeFilter,
            openNowOverride: openNowOnly,
        });
    }, [distanceFilter, ratingFilter, typeFilter, openNowOnly]);

    const loadSuggestions = async ({ distanceOverride, ratingOverride, typeOverride, openNowOverride } = {}) => {
        const loadId = activeLoadIdRef.current + 1;
        activeLoadIdRef.current = loadId;
        const resolvedType = typeOverride || typeFilter;
        const resolvedRating = ratingOverride || ratingFilter;
        const resolvedOpenNow = typeof openNowOverride === 'boolean' ? openNowOverride : openNowOnly;
        try {
            setLoading(true);
            setRetrying(false);
            setError(null);
            setHasRetried(false);

            const results = await fetchPlaces({
                distanceOverride,
                ratingOverride: resolvedRating,
                typeOverride: resolvedType,
                openNowOverride: resolvedOpenNow,
            });
            if (activeLoadIdRef.current !== loadId) {
                return;
            }

            if (results.length > 0) {
                setSuggestions(results);
                setVisibleCount(PAGE_SIZE);
                hasLoadedRef.current = true;
                setLoading(false);
                return;
            }

            setRetrying(true);
            setHasRetried(true);

            const fallbackResults = await fetchPlaces({
                relaxed: true,
                distanceOverride,
                ratingOverride: resolvedRating,
                typeOverride: resolvedType,
                openNowOverride: resolvedOpenNow,
            });
            if (activeLoadIdRef.current !== loadId) {
                return;
            }

            setSuggestions(
                fallbackResults.length > 0
                    ? fallbackResults
                    : buildContextualFallbackSuggestions({
                        preferences: getUserPreferences({
                            contextResponse: null,
                            inferredTripType,
                        activityPreference,
                        cuisinePreference,
                        typeOverride: resolvedType,
                    }),
                    latitude: 13.555,
                    longitude: 80.0265,
                    ratingOverride: resolvedRating,
                    typeOverride: resolvedType,
                    openNowOnly: resolvedOpenNow,
                    })
            );
            setVisibleCount(PAGE_SIZE);
            setRetrying(false);
            hasLoadedRef.current = true;
            setLoading(false);
            return;
        } catch (error) {
            if (activeLoadIdRef.current !== loadId) {
                return;
            }
            console.warn('Automatic suggestion load failed:', error);
            setError(error);
            setSuggestions(
                buildContextualFallbackSuggestions({
                    preferences: getUserPreferences({
                        contextResponse: null,
                        inferredTripType,
                        activityPreference,
                        cuisinePreference,
                        typeOverride: resolvedType,
                    }),
                    latitude: 13.555,
                    longitude: 80.0265,
                    ratingOverride: resolvedRating,
                    typeOverride: resolvedType,
                    openNowOnly: resolvedOpenNow,
                })
            );
            setRetrying(false);
            hasLoadedRef.current = true;
            setLoading(false);
        }
    };

    const fetchPlaces = async (options = {}) => {
        try {
            const { relaxed = false, distanceOverride, ratingOverride, typeOverride, openNowOverride } = options;
            const activeUserId = userId || await getOrCreateUserId();
            let contextResponse = null;
            try {
                contextResponse = await fetchUserContext(activeUserId);
            } catch (contextError) {
                console.warn('User context unavailable for suggestions, using route defaults:', contextError);
            }
            const preferences = getUserPreferences({
                contextResponse,
                inferredTripType,
                activityPreference,
                cuisinePreference,
                typeOverride,
            });
            const location = await getCurrentLocation(contextResponse);
            const baseRadius = getRadius(distanceOverride || preferences.distance_preference);
            const keyword = buildKeywordString(preferences);

            if (!contextResponse) {
                try {
                    await storeTravelContext({
                        userId: activeUserId,
                        latitude: location.lat,
                        longitude: location.lng,
                        inferredTripType,
                        vibe: preferences.atmosphere[0] || 'calm',
                        budget: preferences.budget || 'medium',
                        cuisinePreference,
                        activityPreference,
                        priority: 'balanced',
                    });
                    contextResponse = await fetchUserContext(activeUserId);
                } catch (storeError) {
                    console.warn('Could not rebuild missing context for suggestions:', storeError);
                }
            }

            const nearbyResults = await fetchRankedPlaces({
                latitude: location.lat,
                longitude: location.lng,
                keyword,
                radius: relaxed ? Math.min(baseRadius * 2, 10000) : baseRadius,
                preferences,
                relaxed,
                ratingOverride,
                typeOverride,
                openNowOnly: openNowOverride,
            });

            if (nearbyResults.length > 0) {
                return nearbyResults;
            }

            if (!relaxed) {
                return [];
            }

            const smartSuggestions = await fetchSmartSuggestions({
                userId: activeUserId,
                inferredTripType,
                activityPreference: typeOverride === 'cafe' ? 'coffee' : activityPreference,
                cuisinePreference: typeOverride === 'cafe' ? 'cafe' : cuisinePreference,
            });
            const mappedSmartSuggestions = mapSmartSuggestionsToSuggestions(smartSuggestions);
            if (mappedSmartSuggestions.length > 0) {
                return mappedSmartSuggestions;
            }

            const guaranteedFallback = await fetchGuaranteedFallbackPlaces({
                latitude: location.lat,
                longitude: location.lng,
                ratingOverride,
                typeOverride,
                openNowOnly: openNowOverride,
            });
            if (Array.isArray(guaranteedFallback) && guaranteedFallback.length > 0) {
                return guaranteedFallback;
            }

            return buildContextualFallbackSuggestions({
                preferences,
                latitude: location.lat,
                longitude: location.lng,
                ratingOverride,
                typeOverride,
                openNowOnly: openNowOverride,
            });
        } catch (err) {
            console.warn('Suggestion fetch failed:', err);
            return buildContextualFallbackSuggestions({
                preferences: getUserPreferences({
                    contextResponse: null,
                    inferredTripType,
                    activityPreference,
                    cuisinePreference,
                    typeOverride: options.typeOverride,
                }),
                latitude: 13.555,
                longitude: 80.0265,
                ratingOverride: options.ratingOverride,
                typeOverride: options.typeOverride,
                openNowOnly: options.openNowOverride,
            });
        }
    };

    const handleAddToPlan = async (item) => {
        try {
            const result = await addToPlan(handlePlanPayload(item), { toast: true });
            console.log(result.saved ? 'Added to plan:' : 'Already in plan:', item.name);
        } catch (error) {
            console.warn('Toggle plan item failed:', error);
        }
    };

    const renderedCards = useMemo(() => {
        return suggestions.map((item) => ({
            id: item.id,
            name: item.name,
            subtitle: item.category,
            description: item.reason,
            rating: item.google_rating ? `⭐ ${item.google_rating.toFixed(1)}` : null,
            ratingValue: item.google_rating ?? 0,
            distanceLabel: buildNearbyDistance(item),
            distanceMeters: item.distance_meters ?? null,
            imageUrl: item.photo_url || buildImageUrl(item.name, item.category),
            metaText: item.address,
            categoryKey: item.categoryKey || item.category,
            openNow: item.open_now,
            primaryActionLabel: isPlanned(item.id) ? 'Added ✓' : 'Add to Plan',
            secondaryActionLabel: 'Map',
            tertiaryActionLabel: isPlanned(item.id) ? 'Saved' : 'Save',
            mapQuery: `${item.name} ${item.address || ''}`.trim(),
        }));
    }, [isPlanned, suggestions]);

    const filteredCards = useMemo(() => {
        return renderedCards.filter((item) => {
            const distanceMeters = item.distanceMeters ?? Number.MAX_SAFE_INTEGER;
            const ratingValue = item.ratingValue ?? 0;
            const category = String(item.categoryKey || '').toLowerCase();
            const openNow = item.openNow;

            if (distanceFilter && distanceMeters > getRadius(distanceFilter)) {
                return false;
            }

            if (ratingFilter && ratingValue < Number(ratingFilter)) {
                return false;
            }

            if (typeFilter !== 'any') {
                if (typeFilter === 'cafe' && !category.includes('cafe')) return false;
                if (typeFilter === 'restaurant' && !(category.includes('restaurant') || category.includes('street food'))) return false;
            }

            if (openNowOnly && openNow === false) {
                return false;
            }

            return true;
        });
    }, [distanceFilter, openNowOnly, ratingFilter, renderedCards, typeFilter]);

    const hasActiveRefinement =
        distanceFilter !== 'moderate'
        || ratingFilter !== '3.5'
        || typeFilter !== 'any'
        || openNowOnly;

    const partiallyRelaxedCards = useMemo(() => {
        return renderedCards.filter((item) => {
            const distanceMeters = item.distanceMeters ?? Number.MAX_SAFE_INTEGER;
            const category = String(item.categoryKey || '').toLowerCase();
            const openNow = item.openNow;

            if (distanceFilter && distanceMeters > getRadius(distanceFilter)) {
                return false;
            }

            if (typeFilter !== 'any') {
                if (typeFilter === 'cafe' && !category.includes('cafe')) return false;
                if (typeFilter === 'restaurant' && !(category.includes('restaurant') || category.includes('street food'))) return false;
            }

            if (openNowOnly && openNow === false) {
                return false;
            }

            return true;
        });
    }, [distanceFilter, openNowOnly, renderedCards, typeFilter]);

    const minimallyRelaxedCards = useMemo(() => {
        return renderedCards.filter((item) => {
            const category = String(item.categoryKey || '').toLowerCase();
            const openNow = item.openNow;

            if (typeFilter !== 'any') {
                if (typeFilter === 'cafe' && !category.includes('cafe')) return false;
                if (typeFilter === 'restaurant' && !(category.includes('restaurant') || category.includes('street food'))) return false;
            }

            if (openNowOnly && openNow === false) {
                return false;
            }

            return true;
        });
    }, [openNowOnly, renderedCards, typeFilter]);

    const visibleCards = useMemo(
        () => filteredCards.slice(0, visibleCount),
        [filteredCards, visibleCount]
    );

    const fallbackVisibleCards = useMemo(
        () => renderedCards.slice(0, visibleCount),
        [renderedCards, visibleCount]
    );
    const partiallyRelaxedVisibleCards = useMemo(
        () => partiallyRelaxedCards.slice(0, visibleCount),
        [partiallyRelaxedCards, visibleCount]
    );
    const minimallyRelaxedVisibleCards = useMemo(
        () => minimallyRelaxedCards.slice(0, visibleCount),
        [minimallyRelaxedCards, visibleCount]
    );

    const shouldUseLegacyFallback =
        filteredCards.length === 0
        && renderedCards.length > 0
        && (error || hasRetried);

    const cardsToRender = filteredCards.length > 0
        ? visibleCards
        : partiallyRelaxedCards.length > 0
            ? partiallyRelaxedVisibleCards
            : minimallyRelaxedCards.length > 0
                ? minimallyRelaxedVisibleCards
                : shouldUseLegacyFallback
                    ? fallbackVisibleCards
                    : hasActiveRefinement
                        ? []
                        : fallbackVisibleCards;

    useEffect(() => {
        setVisibleCount(PAGE_SIZE);
    }, [distanceFilter, ratingFilter, typeFilter, openNowOnly, suggestions]);

    if (loading) {
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
                            <Text style={styles.infoChipText}>Showing closest nearby matches</Text>
                        </View>
                    </View>
                </View>

                <View style={styles.intentCard}>
                    <View style={styles.primaryRow}>
                        <View style={styles.primaryChip}>
                            <Text style={styles.primaryChipLabel}>✦ Explore</Text>
                        </View>
                    </View>

                    <View style={styles.filterBlock}>
                        <Text style={styles.filterLabel}>Distance</Text>
                        <View style={styles.filterRow}>
                            {DISTANCE_FILTERS.map((option) => (
                                <View
                                    key={option.key}
                                    style={[styles.filterChip, option.key === distanceFilter && styles.filterChipActive]}
                                >
                                    <Text style={[styles.filterChipText, option.key === distanceFilter && styles.filterChipTextActive]}>
                                        {option.label}
                                    </Text>
                                </View>
                            ))}
                        </View>
                    </View>

                    <View style={styles.filterBlock}>
                        <Text style={styles.filterLabel}>Rating</Text>
                        <View style={styles.filterRow}>
                            {RATING_FILTERS.map((option) => (
                                <View
                                    key={option.key}
                                    style={[styles.filterChip, option.key === ratingFilter && styles.filterChipActive]}
                                >
                                    <Text style={[styles.filterChipText, option.key === ratingFilter && styles.filterChipTextActive]}>
                                        {option.label}
                                    </Text>
                                </View>
                            ))}
                        </View>
                    </View>

                    <View style={styles.filterBlock}>
                        <Text style={styles.filterLabel}>Type</Text>
                        <View style={styles.filterRow}>
                            {TYPE_FILTERS.map((option) => (
                                <View
                                    key={option.key}
                                    style={[styles.filterChip, option.key === typeFilter && styles.filterChipActive]}
                                >
                                    <Text style={[styles.filterChipText, option.key === typeFilter && styles.filterChipTextActive]}>
                                        {option.label}
                                    </Text>
                                </View>
                            ))}
                            <View style={[styles.filterChip, openNowOnly && styles.filterChipActive]}>
                                <Text style={[styles.filterChipText, openNowOnly && styles.filterChipTextActive]}>Open now</Text>
                            </View>
                        </View>
                    </View>
                </View>

                <View style={styles.loadingCard}>
                    <Text style={styles.loadingHeadline}>
                        {retrying ? 'Refreshing nearby suggestions…' : 'Finding the best free-time suggestions…'}
                    </Text>
                    <Text style={styles.loadingSubtext}>
                        {retrying
                            ? 'We are broadening the nearby search so useful places keep loading in.'
                            : 'Looking for nearby places that match your preferences.'}
                    </Text>
                </View>

                {Array.from({ length: LOADING_SKELETON_COUNT }).map((_, index) => (
                    <View key={`skeleton-${index}`} style={styles.skeletonCard}>
                        <View style={styles.skeletonImage} />
                        <View style={styles.skeletonContent}>
                            <View style={styles.skeletonTitle} />
                            <View style={styles.skeletonSubtitle} />
                            <View style={styles.skeletonMetaRow}>
                                <View style={styles.skeletonMetaLeft} />
                                <View style={styles.skeletonMetaRight} />
                            </View>
                            <View style={styles.skeletonLineLong} />
                            <View style={styles.skeletonLineShort} />
                            <View style={styles.skeletonActionRow}>
                                <View style={styles.skeletonPrimaryAction} />
                                <View style={styles.skeletonSecondaryAction} />
                            </View>
                        </View>
                    </View>
                ))}

                <View style={styles.footerSpace} />
            </ScrollView>
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
                        <Text style={styles.infoChipText}>Showing closest nearby matches</Text>
                    </View>
                </View>
            </View>

            <View style={styles.intentCard}>
                <View style={styles.primaryRow}>
                    <Pressable
                        style={styles.primaryChip}
                        onPress={() => navigation.navigate('MainTabs', { screen: 'Dashboard', params: { openAssistant: true } })}
                    >
                        <Text style={styles.primaryChipLabel}>✦ Explore</Text>
                    </Pressable>
                </View>

                <View style={styles.filterBlock}>
                    <Text style={styles.filterLabel}>Distance</Text>
                    <View style={styles.filterRow}>
                        {DISTANCE_FILTERS.map((option) => {
                            const isActive = distanceFilter === option.key;
                            return (
                                <Pressable
                                    key={option.key}
                                    style={[styles.filterChip, isActive && styles.filterChipActive]}
                                    onPress={() => setDistanceFilter(option.key)}
                                >
                                    <Text style={[styles.filterChipText, isActive && styles.filterChipTextActive]}>{option.label}</Text>
                                </Pressable>
                            );
                        })}
                    </View>
                </View>

                <View style={styles.filterBlock}>
                    <Text style={styles.filterLabel}>Rating</Text>
                    <View style={styles.filterRow}>
                        {RATING_FILTERS.map((option) => {
                            const isActive = ratingFilter === option.key;
                            return (
                                <Pressable
                                    key={option.key}
                                    style={[styles.filterChip, isActive && styles.filterChipActive]}
                                    onPress={() => setRatingFilter(option.key)}
                                >
                                    <Text style={[styles.filterChipText, isActive && styles.filterChipTextActive]}>{option.label}</Text>
                                </Pressable>
                            );
                        })}
                    </View>
                </View>

                <View style={styles.filterBlock}>
                    <Text style={styles.filterLabel}>Type</Text>
                    <View style={styles.filterRow}>
                        {TYPE_FILTERS.map((option) => {
                            const isActive = typeFilter === option.key;
                            return (
                                <Pressable
                                    key={option.key}
                                    style={[styles.filterChip, isActive && styles.filterChipActive]}
                                    onPress={() => setTypeFilter(option.key)}
                                >
                                    <Text style={[styles.filterChipText, isActive && styles.filterChipTextActive]}>{option.label}</Text>
                                </Pressable>
                            );
                        })}
                        <Pressable
                            style={[styles.filterChip, openNowOnly && styles.filterChipActive]}
                            onPress={() => setOpenNowOnly((current) => !current)}
                        >
                            <Text style={[styles.filterChipText, openNowOnly && styles.filterChipTextActive]}>Open now</Text>
                        </Pressable>
                    </View>
                </View>
            </View>

            {cardsToRender.map((item) => (
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
                    tertiaryActionLabel={item.tertiaryActionLabel}
                    onPrimaryAction={() => handleAddToPlan(item)}
                    onSecondaryAction={() => openMap(item.mapQuery)}
                    onTertiaryAction={() => handleAddToPlan(item)}
                />
            ))}

            {cardsToRender.length === 0 && !loading && !hasActiveRefinement ? (
                <View style={styles.emptyCard}>
                    <Text style={styles.emptyTitle}>No suggestions found right now</Text>
                    <Text style={styles.emptyText}>
                        {error
                            ? 'Something went wrong while loading suggestions. Please try again in a moment.'
                            : 'Try again in a moment or adjust your preferences from profile.'}
                    </Text>
                </View>
            ) : null}

            {filteredCards.length === 0 && renderedCards.length > 0 && hasActiveRefinement && !shouldUseLegacyFallback && partiallyRelaxedCards.length === 0 && minimallyRelaxedCards.length === 0 ? (
                <View style={styles.emptyCard}>
                    <Text style={styles.emptyTitle}>No matches for the current filters</Text>
                    <Text style={styles.emptyText}>
                        Try a broader distance, lower rating, or a different type to see more nearby options.
                    </Text>
                </View>
            ) : null}

            {(shouldUseLegacyFallback || (filteredCards.length === 0 && partiallyRelaxedCards.length > 0) || (filteredCards.length === 0 && partiallyRelaxedCards.length === 0 && minimallyRelaxedCards.length > 0)) ? (
                <View style={styles.emptyCard}>
                    <Text style={styles.emptyTitle}>Showing best available nearby matches</Text>
                    <Text style={styles.emptyText}>
                        {filteredCards.length === 0 && partiallyRelaxedCards.length > 0
                            ? 'No exact rating match was found, so we kept the strongest nearby places for your distance and type.'
                            : filteredCards.length === 0 && minimallyRelaxedCards.length > 0
                                ? 'No exact distance match was found, so we kept the strongest nearby places for your selected type.'
                                : 'The live recommendation engine did not return enough exact matches, so we surfaced the strongest nearby options instead.'}
                    </Text>
                </View>
            ) : null}

            {(filteredCards.length > visibleCount || (filteredCards.length === 0 && renderedCards.length > visibleCount)) ? (
                <Pressable style={styles.loadMoreButton} onPress={() => setVisibleCount((current) => current + PAGE_SIZE)}>
                    <Text style={styles.loadMoreButtonText}>Load more</Text>
                </Pressable>
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

const getUserPreferences = ({ contextResponse, inferredTripType, activityPreference, cuisinePreference, typeOverride = 'any' }) => {
    const profile = contextResponse?.context?.onboarding_profile || {};
    const preferences = contextResponse?.context?.preferences || {};
    const vibe = preferences.vibe || profile.vibe || null;
    const budget = preferences.budget || profile.budget || null;
    const foodPreference = profile.cuisine_preference || cuisinePreference || null;
    const purpose = profile.free_time_preference || activityPreference || inferredTripType || null;

    const normalizedType = String(typeOverride || 'any').toLowerCase();
    const foodPreferences = foodPreference ? [String(foodPreference).toLowerCase()] : [];
    const purposes = purpose ? [String(purpose).toLowerCase()] : [];

    if (normalizedType === 'cafe') {
        if (!foodPreferences.includes('cafe')) foodPreferences.unshift('cafe');
        if (!purposes.includes('coffee')) purposes.unshift('coffee');
    } else if (normalizedType === 'restaurant') {
        if (!foodPreferences.includes('restaurant')) foodPreferences.unshift('restaurant');
        if (!purposes.includes('food')) purposes.unshift('food');
    }

    return {
        budget,
        atmosphere: vibe ? [String(vibe).toLowerCase()] : [],
        food_preferences: foodPreferences,
        purpose: purposes,
        distance_preference: normalizeDistancePreference(profile.distance_preference),
    };
};

const getCurrentLocation = async (contextResponse) => {
    const coordinates = contextResponse?.context?.location?.coordinates;
    if (typeof navigator !== 'undefined' && navigator.geolocation) {
        try {
            const position = await new Promise((resolve, reject) => {
                navigator.geolocation.getCurrentPosition(resolve, reject, {
                    enableHighAccuracy: true,
                    timeout: 8000,
                    maximumAge: 120000,
                });
            });

            return {
                lat: position.coords.latitude,
                lng: position.coords.longitude,
            };
        } catch (error) {
            console.warn('Browser geolocation failed, falling back to stored context:', error);
        }
    }

    if (coordinates?.lat && coordinates?.lng) {
        return {
            lat: coordinates.lat,
            lng: coordinates.lng,
        };
    }

    return {
        lat: 13.555,
        lng: 80.0265,
    };
};

const normalizeDistancePreference = (value) => {
    const normalized = String(value || '').toLowerCase();
    if (normalized === 'far') return 'far';
    if (normalized === 'moderate') return 'moderate';
    return 'nearby';
};

const getRadius = (distancePreference) => {
    return DISTANCE_RADII[distancePreference] || DISTANCE_RADII.nearby;
};

const buildKeywordString = (preferences) => {
    return [
        ...preferences.atmosphere,
        ...preferences.food_preferences,
        ...preferences.purpose,
    ]
        .filter(Boolean)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
};

const fetchRankedPlaces = async ({
    latitude,
    longitude,
    keyword,
    radius,
    preferences,
    relaxed = false,
    ratingOverride = '3.5',
    typeOverride = 'any',
    openNowOnly = false,
}) => {
    const keywordCandidates = buildKeywordCandidates(preferences, keyword);
    let places = await fetchPlacesForKeywords(latitude, longitude, keywordCandidates, radius);
    let filteredPlaces = filterPlaces(places, preferences, { relaxed, ratingOverride, typeOverride, openNowOnly });

    if (!filteredPlaces.length && relaxed) {
        places = await fetchPlacesForKeywords(latitude, longitude, getGenericFallbackKeywords(preferences), Math.min(radius, 20000));
        filteredPlaces = filterPlaces(places, preferences, { relaxed: true, ratingOverride, typeOverride, openNowOnly });
    }

    if (!filteredPlaces.length && places.length) {
        filteredPlaces = places;
    }

    return sortPlaces(filteredPlaces, preferences, latitude, longitude).map((item) => ({
        id: item.id || `${item.name}-${item.address || item.vicinity || ''}`,
        name: item.name,
        google_rating: item.rating === 'N/A' ? null : Number(item.rating),
        address: item.address || item.vicinity || '',
        category: categoryLabelFor(item.normalizedCategory),
        categoryKey: item.normalizedCategory,
        open_now: item.openNow ?? null,
        distance_meters: estimateMeters(item, latitude, longitude),
        walk_eta_minutes: estimateWalkEta(item, latitude, longitude),
        drive_eta_minutes: null,
        lat: item.lat ?? item.location?.lat ?? null,
        lng: item.lng ?? item.location?.lng ?? null,
        photo_url: item.photoUrl || null,
        reason: buildReasonString(item, preferences),
        score: getRankScore(item, preferences, latitude, longitude),
    }));
};

const fetchPlacesForKeywords = async (latitude, longitude, keywords, radius) => {
    const uniquePlaces = new Map();

    for (const keyword of keywords) {
        try {
            const results = await fetchNearbyPlaces(latitude, longitude, keyword, radius);
            results.forEach((place) => {
                const id = place.id || `${place.name}-${place.address || place.vicinity || ''}`;
                if (!uniquePlaces.has(id)) {
                    uniquePlaces.set(id, place);
                }
            });
            if (uniquePlaces.size >= 12) {
                break;
            }
        } catch (error) {
            console.warn(`Nearby fetch failed for keyword "${keyword}":`, error);
        }
    }

    return Array.from(uniquePlaces.values());
};

const fetchGuaranteedFallbackPlaces = async ({ latitude, longitude, ratingOverride = '3.5', typeOverride = 'any', openNowOnly = false }) => {
    const fallbackKeywords =
        typeOverride === 'cafe'
            ? ['cafe', 'coffee shop', 'bakery']
            : typeOverride === 'restaurant'
                ? ['restaurant', 'street food', 'bakery']
                : ['restaurant', 'cafe', 'bakery', 'park', 'museum'];
    const places = await fetchPlacesForKeywords(latitude, longitude, fallbackKeywords, 8000);

    return places
        .filter((item) => !openNowOnly || item.openNow !== false)
        .filter((item) => {
            const rating = item.rating === 'N/A' ? 0 : Number(item.rating || 0);
            return rating >= Number(ratingOverride || '3.5');
        })
        .slice(0, 10)
        .map((item) => ({
        id: item.id || `${item.name}-${item.address || item.vicinity || ''}`,
        name: item.name,
        google_rating: item.rating === 'N/A' ? null : Number(item.rating),
        address: item.address || item.vicinity || '',
        category: categoryLabelFor(item.normalizedCategory),
        categoryKey: item.normalizedCategory,
        open_now: item.openNow ?? null,
        distance_meters: estimateMeters(item, latitude, longitude),
        walk_eta_minutes: estimateWalkEta(item, latitude, longitude),
        drive_eta_minutes: null,
        lat: item.lat ?? item.location?.lat ?? null,
        lng: item.lng ?? item.location?.lng ?? null,
        photo_url: item.photoUrl || null,
        reason: 'A strong nearby option surfaced from broader local results.',
        score: item.rating === 'N/A' ? 0 : Number(item.rating || 0),
    }));
};

const buildContextualFallbackSuggestions = ({ preferences, latitude, longitude, ratingOverride = '3.5', typeOverride = 'any', openNowOnly = false }) => {
    const timeBucket = getTimeBucket();
    const shortPreference = typeOverride !== 'any' ? typeOverride : (preferences.food_preferences[0] || preferences.purpose[0] || 'nearby');
    const templates = getFallbackTemplates(preferences, timeBucket, ratingOverride, typeOverride, openNowOnly);

    return templates.map((template, index) => ({
        id: `contextual-fallback-${template.categoryKey}-${index}`,
        name: template.name,
        google_rating: template.googleRating,
        address: template.address,
        category: template.category,
        categoryKey: template.categoryKey,
        open_now: true,
        distance_meters: template.distanceMeters,
        walk_eta_minutes: Math.max(1, Math.round(template.distanceMeters / 80)),
        drive_eta_minutes: null,
        lat: latitude,
        lng: longitude,
        photo_url: buildImageUrl(template.name, template.category),
        reason: template.reason || `Recommended for your ${shortPreference} preference this ${timeBucket}.`,
        score: 4.5 - (index * 0.1),
    }));
};

const getFallbackTemplates = (preferences, timeBucket, ratingOverride = '3.5', typeOverride = 'any', openNowOnly = false) => {
    const foodPreference = String(preferences.food_preferences[0] || '').toLowerCase();
    const purpose = String(preferences.purpose[0] || '').toLowerCase();
    const vibe = String(preferences.atmosphere[0] || '').toLowerCase();

    if (typeOverride === 'cafe' || purpose === 'coffee' || foodPreference === 'cafe') {
        return [
            {
                name: 'JJ Cafe',
                category: 'Cafe',
                categoryKey: 'cafe',
                distanceMeters: 850,
                googleRating: 4.4,
                address: 'A close-by cafe option around your current area',
                reason: `A calm ${timeBucket} cafe stop that matches your coffee preference.`,
            },
            {
                name: 'Cafe Coffee Day',
                category: 'Cafe',
                categoryKey: 'cafe',
                distanceMeters: 1400,
                googleRating: 4.3,
                address: 'A productive nearby coffee option',
                reason: `Good for a ${vibe || 'calm'} break with a short walk from your location.`,
            },
        ].filter((item) => item.googleRating >= Number(ratingOverride || '3.5'));
    }

    if (typeOverride !== 'restaurant' && purpose === 'sightseeing') {
        return [
            {
                name: 'Nearby Explore Stop',
                category: 'Explore',
                categoryKey: 'attraction',
                distanceMeters: 1200,
                googleRating: 4.5,
                address: 'A nearby place to explore around your current area',
                reason: `A close attraction-style pick for your ${timeBucket} free time.`,
            },
            {
                name: 'Relaxed Outdoor Pick',
                category: 'Park',
                categoryKey: 'park',
                distanceMeters: 1800,
                googleRating: 4.2,
                address: 'A calmer outdoor option close to you',
                reason: `Fits your ${vibe || 'explore'} preference and current free-time window.`,
            },
        ].filter((item) => item.googleRating >= Number(ratingOverride || '3.5'));
    }

    const defaults = [
        {
            name: foodPreference === 'south indian' ? 'Nearby South Indian Pick' : 'Nearby Food Pick',
            category: 'Restaurant',
            categoryKey: 'restaurant',
            distanceMeters: 900,
            googleRating: 4.4,
            address: 'A close food option around your current area',
            reason: `A short-hop ${timeBucket} recommendation based on your ${foodPreference || 'food'} preference.`,
        },
        {
            name: 'Quick Nearby Meal',
            category: 'Restaurant',
            categoryKey: 'restaurant',
            distanceMeters: 1600,
            googleRating: 4.2,
            address: 'A convenient nearby meal option',
            reason: `Recommended for your free-time window and nearby location.`,
        },
    ];

    return defaults.filter((item) => item.googleRating >= Number(ratingOverride || '3.5'));
};

const getTimeBucket = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'morning';
    if (hour < 17) return 'afternoon';
    if (hour < 22) return 'evening';
    return 'night';
};

const buildKeywordCandidates = (preferences, keyword) => {
    const candidates = [];
    const push = (value) => {
        const normalized = String(value || '').trim();
        if (normalized && !candidates.includes(normalized)) {
            candidates.push(normalized);
        }
    };

    push(keyword);

    preferences.food_preferences.forEach((value) => {
        push(value);
        if (value === 'south indian') push('south indian restaurant');
        if (value === 'quick bites') push('fast food');
        if (value === 'street food') push('street food');
        if (value === 'veg') push('vegetarian restaurant');
        if (value === 'cafe') push('cafe');
    });

    preferences.purpose.forEach((value) => {
        if (value === 'coffee') push('cafe');
        if (value === 'food') push('restaurant');
        if (value === 'work spot') push('coworking space');
        if (value === 'sightseeing') push('tourist attraction');
        if (value === 'explore') push('tourist attraction');
    });

    preferences.atmosphere.forEach((value) => {
        if (value === 'calm') push('quiet cafe');
        if (value === 'social') push('lively restaurant');
        if (value === 'productive') push('work cafe');
    });

    getGenericFallbackKeywords(preferences).forEach(push);

    return candidates.slice(0, 8);
};

const getGenericFallbackKeywords = (preferences) => {
    if (preferences.purpose.includes('sightseeing') || preferences.purpose.includes('explore')) {
        return ['tourist attraction', 'museum', 'park', 'cafe'];
    }
    if (preferences.purpose.includes('coffee') || preferences.food_preferences.includes('cafe')) {
        return ['cafe', 'bakery', 'coffee shop', 'restaurant'];
    }
    if (preferences.purpose.includes('work spot')) {
        return ['coworking space', 'cafe', 'library', 'restaurant'];
    }
    return ['restaurant', 'cafe', 'bakery', 'park'];
};

const filterPlaces = (places, preferences, { relaxed = false, ratingOverride = '3.5', typeOverride = 'any', openNowOnly = false } = {}) => {
    return places.filter((place) => {
        const rating = place.rating === 'N/A' ? 0 : Number(place.rating || 0);
        const businessStatus = String(place.businessStatus || place.business_status || 'OPERATIONAL').toUpperCase();
        const preferenceScore = getPreferenceMatchScore(place, preferences);
        const category = String(place.normalizedCategory || '').toLowerCase();
        const haystack = [
            place.name,
            place.address,
            place.vicinity,
            ...(Array.isArray(place.types) ? place.types : []),
            place.normalizedCategory,
        ]
            .filter(Boolean)
            .join(' ')
            .toLowerCase();

        const minimumRating = relaxed ? Math.max(3.0, Number(ratingOverride || '3.5') - 0.5) : Number(ratingOverride || '3.5');
        if (rating < minimumRating) return false;
        if (businessStatus && businessStatus !== 'OPERATIONAL') return false;
        if (openNowOnly && place.openNow === false) return false;
        if (typeOverride === 'cafe' && !(category.includes('cafe') || haystack.includes('cafe') || haystack.includes('coffee') || haystack.includes('bakery'))) return false;
        if (typeOverride === 'restaurant' && !(category.includes('restaurant') || haystack.includes('restaurant') || haystack.includes('food') || haystack.includes('street food'))) return false;
        if (!relaxed && preferenceScore < 1) return false;
        return true;
    });
};

const sortPlaces = (places, preferences, latitude, longitude) => {
    return [...places].sort((left, right) => {
        return getRankScore(right, preferences, latitude, longitude) - getRankScore(left, preferences, latitude, longitude);
    });
};

const getRankScore = (place, preferences, latitude, longitude) => {
    const preferenceMatch = getPreferenceMatchScore(place, preferences);
    const ratingScore = (place.rating === 'N/A' ? 0 : Number(place.rating || 0)) / 5;
    const distanceMeters = estimateMeters(place, latitude, longitude);
    const distanceScore = distanceMeters ? 1 / distanceMeters : 0;

    return (0.5 * preferenceMatch) + (0.3 * ratingScore) + (0.2 * distanceScore);
};

const buildImageUrl = (name, type) => {
    const query = encodeURIComponent(`${name} ${type || 'travel place'}`);
    return `https://source.unsplash.com/900x600/?${query}`;
};

const getPreferenceMatchScore = (place, preferences) => {
    const haystack = [
        place.name,
        place.address,
        place.vicinity,
        ...(Array.isArray(place.types) ? place.types : []),
        place.normalizedCategory,
    ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

    const tokens = [
        ...preferences.atmosphere,
        ...preferences.food_preferences,
        ...preferences.purpose,
    ].filter(Boolean);

    return tokens.reduce((score, token) => (haystack.includes(String(token).toLowerCase()) ? score + 1 : score), 0);
};

const buildReasonString = (place, preferences) => {
    const matches = [];
    const haystack = [
        place.name,
        place.address,
        place.vicinity,
        ...(Array.isArray(place.types) ? place.types : []),
        place.normalizedCategory,
    ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

    [...preferences.atmosphere, ...preferences.food_preferences, ...preferences.purpose].forEach((token) => {
        if (token && haystack.includes(token) && !matches.includes(token)) {
            matches.push(token);
        }
    });

    if (!matches.length) {
        return 'A nearby match that fits your current location and open-now preference.';
    }

    return `Matches your ${matches.join(' + ')} preference`;
};

const buildNearbyDistance = (item) => {
    if (item.walk_eta_minutes) return `${item.walk_eta_minutes} min walk`;
    if (item.drive_eta_minutes) return `${item.drive_eta_minutes} min drive`;
    if (item.distance_meters) return `${item.distance_meters} m away`;
    return 'Close by';
};

const categoryLabelFor = (category = '') => {
    const normalized = String(category).toLowerCase();
    if (normalized.includes('cafe')) return 'Cafe';
    if (normalized.includes('museum')) return 'Museum';
    if (normalized.includes('park')) return 'Park';
    if (normalized.includes('shop')) return 'Shopping';
    if (normalized.includes('street')) return 'Street food';
    if (normalized.includes('attraction') || normalized.includes('landmark')) return 'Explore';
    return 'Restaurant';
};

const estimateMeters = (item, userLat, userLng) => {
    if (item.lat == null || item.lng == null) return null;
    const toRad = (value) => (value * Math.PI) / 180;
    const earthRadius = 6371000;
    const dLat = toRad(item.lat - userLat);
    const dLng = toRad(item.lng - userLng);
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2)
        + Math.cos(toRad(userLat)) * Math.cos(toRad(item.lat)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return Math.round(earthRadius * c);
};

const estimateWalkEta = (item, userLat, userLng) => {
    const meters = estimateMeters(item, userLat, userLng);
    if (!meters) return null;
    return Math.max(1, Math.round(meters / 80));
};

const openMap = async (query) => {
    const url = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
    try {
        await Linking.openURL(url);
    } catch (error) {
        console.warn('Map open failed:', error);
    }
};

const mapSmartSuggestionsToSuggestions = (response) => {
    const nearbyMatches = Array.isArray(response?.nearby_matches) ? response.nearby_matches : [];
    const recommendations = Array.isArray(response?.recommendations) ? response.recommendations : [];

    if (nearbyMatches.length > 0) {
        return nearbyMatches.map((item, index) => ({
            id: `${item.name}-${item.address || index}`,
            name: item.name,
            google_rating: item.google_rating ?? null,
            address: item.address || '',
            category: item.category || 'Nearby',
            categoryKey: String(item.category || 'nearby').toLowerCase(),
            open_now: item.open_now ?? null,
            distance_meters: item.distance_meters ?? null,
            walk_eta_minutes: item.walk_eta_minutes ?? null,
            drive_eta_minutes: item.drive_eta_minutes ?? null,
            lat: null,
            lng: null,
            photo_url: buildImageUrl(item.name, item.category || 'nearby place'),
            reason: item.open_now === false
                ? 'A nearby option worth checking when it opens.'
                : 'A nearby option surfaced from your live smart suggestions.',
            score: typeof item.google_rating === 'number' ? item.google_rating : 0,
        }));
    }

    return recommendations.map((item, index) => ({
        id: `${item.title}-${item.place_address || index}`,
        name: item.title,
        google_rating: item.google_rating ?? null,
        address: item.place_address || '',
        category: item.type ? String(item.type).replace(/^\w/, (match) => match.toUpperCase()) : 'Nearby',
        categoryKey: String(item.type || 'nearby').toLowerCase(),
        open_now: null,
        distance_meters: null,
        walk_eta_minutes: null,
        drive_eta_minutes: null,
        lat: null,
        lng: null,
        photo_url: buildImageUrl(item.title, item.type || 'nearby place'),
        reason: item.reason || 'Suggested by your live recommendation engine.',
        score: typeof item.google_rating === 'number' ? item.google_rating : 0,
    }));
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
    loadingCard: {
        backgroundColor: '#FFFFFF',
        borderRadius: 28,
        padding: 22,
        borderWidth: 1,
        borderColor: '#ECE6F8',
        marginBottom: 16,
        shadowColor: 'rgba(60, 32, 122, 0.08)',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 1,
        shadowRadius: 18,
        elevation: 3,
    },
    loadingHeadline: {
        fontSize: 18,
        fontWeight: '800',
        color: '#1B1530',
        marginBottom: 8,
    },
    loadingSubtext: {
        fontSize: 15,
        color: '#7D7692',
        lineHeight: 22,
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
        paddingHorizontal: 20,
        paddingTop: 16,
        paddingBottom: 10,
        borderWidth: 1,
        borderColor: '#ECE6F8',
        shadowColor: 'rgba(60, 32, 122, 0.1)',
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 1,
        shadowRadius: 22,
        elevation: 4,
        marginBottom: 18,
    },
    primaryRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 10,
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
    filterBlock: {
        marginTop: 14,
    },
    filterLabel: {
        fontSize: 14,
        fontWeight: '700',
        color: '#6F6A82',
        marginBottom: 10,
    },
    filterRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 10,
    },
    filterChip: {
        backgroundColor: '#F4F5F9',
        borderRadius: 18,
        paddingVertical: 10,
        paddingHorizontal: 14,
        borderWidth: 1,
        borderColor: '#ECE6F8',
    },
    filterChipActive: {
        backgroundColor: '#6C3BFF',
        borderColor: '#6C3BFF',
    },
    filterChipText: {
        fontSize: 14,
        fontWeight: '700',
        color: '#4A5166',
    },
    filterChipTextActive: {
        color: '#FFFFFF',
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
    loadMoreButton: {
        marginTop: 10,
        backgroundColor: '#FFFFFF',
        borderRadius: 20,
        borderWidth: 1,
        borderColor: '#ECE6F8',
        alignItems: 'center',
        paddingVertical: 14,
        shadowColor: 'rgba(60, 32, 122, 0.08)',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 1,
        shadowRadius: 18,
        elevation: 3,
    },
    loadMoreButtonText: {
        fontSize: 15,
        fontWeight: '700',
        color: '#5E43FF',
    },
    skeletonCard: {
        backgroundColor: '#FFFFFF',
        borderRadius: 24,
        marginBottom: 16,
        borderWidth: 1,
        borderColor: '#ECE6F8',
        shadowColor: 'rgba(64, 37, 122, 0.1)',
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 1,
        shadowRadius: 24,
        elevation: 4,
        overflow: 'hidden',
    },
    skeletonImage: {
        height: 184,
        backgroundColor: '#ECECF1',
    },
    skeletonContent: {
        paddingHorizontal: 18,
        paddingTop: 16,
        paddingBottom: 16,
    },
    skeletonTitle: {
        height: 24,
        width: '58%',
        backgroundColor: '#E6E6ED',
        borderRadius: 10,
        marginBottom: 10,
    },
    skeletonSubtitle: {
        height: 16,
        width: '30%',
        backgroundColor: '#EEEFF4',
        borderRadius: 8,
        marginBottom: 14,
    },
    skeletonMetaRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        gap: 12,
        marginBottom: 14,
    },
    skeletonMetaLeft: {
        flex: 1,
        height: 16,
        borderRadius: 8,
        backgroundColor: '#EEEFF4',
    },
    skeletonMetaRight: {
        width: 110,
        height: 16,
        borderRadius: 8,
        backgroundColor: '#EAEAF2',
    },
    skeletonLineLong: {
        height: 14,
        width: '92%',
        borderRadius: 8,
        backgroundColor: '#F0F1F5',
        marginBottom: 10,
    },
    skeletonLineShort: {
        height: 14,
        width: '72%',
        borderRadius: 8,
        backgroundColor: '#F0F1F5',
        marginBottom: 18,
    },
    skeletonActionRow: {
        flexDirection: 'row',
        gap: 12,
    },
    skeletonPrimaryAction: {
        flex: 1,
        height: 52,
        borderRadius: 18,
        backgroundColor: '#E3E3EA',
    },
    skeletonSecondaryAction: {
        width: 120,
        height: 52,
        borderRadius: 18,
        backgroundColor: '#F0F1F5',
    },
    footerSpace: {
        height: 26,
    },
});

export default RecommendationScreen;
