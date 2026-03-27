import React, { useEffect, useMemo, useState } from 'react';
import {
    ActivityIndicator,
    ImageBackground,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    View,
} from 'react-native';
import TopInfoBar from '../components/TopInfoBar';
import {
    fetchNearbyHeroPlace,
    fetchUserContext,
    getOrCreateUserId,
} from '../services/backendService';
import { useLiveContext } from '../context/LiveContext';

const FILTERS = ['All', 'Active', 'Upcoming', 'Past'];

const TripsScreen = ({ route }) => {
    const [loading, setLoading] = useState(true);
    const [activeFilter, setActiveFilter] = useState('All');
    const [tripCard, setTripCard] = useState(null);

    const onboardingParams = route?.params ?? {};
    const { formattedTime, temperatureLabel, coordsLabel, locationLabel, latitude, longitude } = useLiveContext();

    useEffect(() => {
        if (latitude != null && longitude != null) {
            loadTrips();
        }
    }, [latitude, longitude]);

    const loadTrips = async () => {
        setLoading(true);
        try {
            const userId = await getOrCreateUserId();

            const [context, heroPlace] = await Promise.all([
                fetchUserContext(userId).catch(() => null),
                fetchNearbyHeroPlace(latitude, longitude).catch(() => null),
            ]);

            const tripDetails = context?.trip_details || {};
            const destination = tripDetails.destination || locationLabel || heroPlace?.name || 'Current trip';
            const startDate = tripDetails.start_date ? new Date(tripDetails.start_date) : null;
            const endDate = tripDetails.end_date ? new Date(tripDetails.end_date) : null;

            setTripCard({
                destination,
                startDate,
                endDate,
                status: getTripStatus(startDate, endDate),
                imageUrl: heroPlace?.photo_url || buildFallbackTripImage(destination),
                note: tripDetails.notes || 'Your live travel context will appear here as your plans come together.',
            });
        } catch (error) {
            console.warn('Trips screen failed:', error);
        } finally {
            setLoading(false);
        }
    };

    const visibleTrips = useMemo(() => {
        if (!tripCard) return [];
        if (activeFilter === 'All') return [tripCard];
        return tripCard.status === activeFilter ? [tripCard] : [];
    }, [activeFilter, tripCard]);

    if (loading) {
        return (
            <View style={styles.center}>
                <ActivityIndicator size="large" color="#6C3BFF" />
                <Text style={styles.loadingText}>Organizing your trips…</Text>
            </View>
        );
    }

    return (
        <ScrollView style={styles.screen} contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
            <View style={styles.titleRow}>
                <View>
                    <Text style={styles.title}>My Trips</Text>
                    <Text style={styles.subtitle}>Manage your travel plans</Text>
                </View>
                <Pressable style={styles.addButton}>
                    <Text style={styles.addButtonText}>＋</Text>
                </Pressable>
            </View>

            <TopInfoBar
                timeLabel={formattedTime}
                temperatureLabel={temperatureLabel}
                coordsLabel={coordsLabel}
                locationLabel={locationLabel}
            />

            <View style={styles.filterRow}>
                {FILTERS.map((item) => {
                    const isActive = activeFilter === item;
                    return (
                        <Pressable
                            key={item}
                            style={[styles.filterChip, isActive && styles.filterChipActive]}
                            onPress={() => setActiveFilter(item)}
                        >
                            <Text style={[styles.filterChipText, isActive && styles.filterChipTextActive]}>
                                {item}
                            </Text>
                        </Pressable>
                    );
                })}
            </View>

            {visibleTrips.map((trip) => (
                <View key={trip.destination} style={styles.tripCard}>
                    <ImageBackground source={{ uri: trip.imageUrl }} style={styles.tripImage} imageStyle={styles.tripImageInner}>
                        <View style={styles.tripStatusBadge}>
                            <Text style={styles.tripStatusText}>{trip.status}</Text>
                        </View>
                    </ImageBackground>
                    <View style={styles.tripBody}>
                        <View style={styles.tripHeadingRow}>
                            <View style={styles.tripHeadingText}>
                                <Text style={styles.tripDestination}>{trip.destination}</Text>
                                <Text style={styles.tripDate}>{formatDateRange(trip.startDate, trip.endDate, onboardingParams)}</Text>
                            </View>
                            <Text style={styles.tripPin}>⌖</Text>
                        </View>
                        <Text style={styles.tripNote}>{trip.note}</Text>
                    </View>
                </View>
            ))}

            {visibleTrips.length === 0 ? (
                <View style={styles.emptyCard}>
                    <Text style={styles.emptyTitle}>No trips in this filter yet</Text>
                    <Text style={styles.emptyText}>
                        When trip dates and destinations are available in your live context, they will appear here.
                    </Text>
                </View>
            ) : null}

            <View style={styles.footerSpace} />
        </ScrollView>
    );
};

const getTripStatus = (startDate, endDate) => {
    const now = new Date();
    if (startDate && startDate > now) return 'Upcoming';
    if (endDate && endDate < now) return 'Past';
    return 'Active';
};

const formatDateRange = (startDate, endDate, onboardingParams) => {
    if (!startDate && !endDate) {
        return onboardingParams?.cuisinePreference
            ? `Tailored for ${onboardingParams.cuisinePreference}`
            : 'Dates will appear here when available';
    }

    const formatOne = (date) =>
        date?.toLocaleDateString([], {
            month: 'short',
            day: 'numeric',
        });

    if (startDate && endDate) {
        return `${formatOne(startDate)} – ${formatOne(endDate)}`;
    }
    return formatOne(startDate || endDate);
};

const buildFallbackTripImage = (destination) => {
    const query = encodeURIComponent(destination || 'travel destination');
    return `https://source.unsplash.com/900x600/?${query}`;
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
    titleRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 18,
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
    },
    addButton: {
        width: 58,
        height: 58,
        borderRadius: 29,
        backgroundColor: '#6C3BFF',
        alignItems: 'center',
        justifyContent: 'center',
        shadowColor: 'rgba(94, 58, 255, 0.28)',
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 1,
        shadowRadius: 18,
        elevation: 5,
    },
    addButtonText: {
        color: '#FFFFFF',
        fontSize: 26,
        fontWeight: '600',
    },
    filterRow: {
        marginTop: 18,
        marginBottom: 18,
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 12,
    },
    filterChip: {
        backgroundColor: '#FFFFFF',
        borderRadius: 18,
        paddingHorizontal: 20,
        paddingVertical: 14,
        borderWidth: 1,
        borderColor: '#ECE6F8',
    },
    filterChipActive: {
        backgroundColor: '#6C3BFF',
        borderColor: '#6C3BFF',
    },
    filterChipText: {
        color: '#4C4F63',
        fontSize: 15,
        fontWeight: '700',
    },
    filterChipTextActive: {
        color: '#FFFFFF',
    },
    tripCard: {
        backgroundColor: '#FFFFFF',
        borderRadius: 28,
        overflow: 'hidden',
        borderWidth: 1,
        borderColor: '#ECE6F8',
        marginBottom: 20,
        shadowColor: 'rgba(60, 32, 122, 0.1)',
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 1,
        shadowRadius: 22,
        elevation: 4,
    },
    tripImage: {
        height: 220,
        justifyContent: 'flex-start',
        alignItems: 'flex-end',
        padding: 16,
        backgroundColor: '#DDD2FF',
    },
    tripImageInner: {
        resizeMode: 'cover',
    },
    tripStatusBadge: {
        backgroundColor: 'rgba(126, 167, 198, 0.86)',
        borderRadius: 999,
        paddingHorizontal: 16,
        paddingVertical: 9,
    },
    tripStatusText: {
        color: '#FFFFFF',
        fontSize: 15,
        fontWeight: '700',
    },
    tripBody: {
        paddingHorizontal: 18,
        paddingVertical: 16,
    },
    tripHeadingRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        gap: 12,
    },
    tripHeadingText: {
        flex: 1,
    },
    tripDestination: {
        fontSize: 18,
        fontWeight: '800',
        color: '#1B1530',
        marginBottom: 8,
    },
    tripDate: {
        fontSize: 14,
        color: '#767087',
        fontWeight: '700',
    },
    tripPin: {
        fontSize: 22,
        color: '#5E43FF',
    },
    tripNote: {
        marginTop: 14,
        fontSize: 15,
        color: '#6C6780',
        lineHeight: 22,
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
        height: 24,
    },
});

export default TripsScreen;
