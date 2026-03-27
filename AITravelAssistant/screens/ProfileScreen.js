import React, { useEffect, useMemo, useState } from 'react';
import {
    ActivityIndicator,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    View,
} from 'react-native';
import TopInfoBar from '../components/TopInfoBar';
import {
    fetchGoogleProfile,
    getPlannedItems,
    fetchUserContext,
    getGoogleSessionId,
    getOrCreateUserId,
} from '../services/backendService';
import { useLiveContext } from '../context/LiveContext';

const SETTINGS_ITEMS = [
    { icon: '⚙️', label: 'Settings' },
    { icon: '🔔', label: 'Notifications' },
    { icon: '♡', label: 'Saved Places' },
    { icon: '❓', label: 'Help & Support' },
];

const ProfileScreen = ({ route }) => {
    const [loading, setLoading] = useState(true);
    const [profile, setProfile] = useState({
        name: 'Traveler',
        email: 'Sign in with Google to personalize this profile',
        avatarLetter: 'T',
    });
    const [stats, setStats] = useState({
        trips: '—',
        places: '—',
        countries: '—',
    });

    const onboardingParams = route?.params ?? {};
    const { formattedTime, temperatureLabel, coordsLabel, locationLabel } = useLiveContext();

    useEffect(() => {
        loadProfile();
    }, []);

    const loadProfile = async () => {
        setLoading(true);
        try {
            const userId = await getOrCreateUserId();
            const sessionId = await getGoogleSessionId();

            const [context, googleProfile, plannedItems] = await Promise.all([
                fetchUserContext(userId).catch(() => null),
                sessionId ? fetchGoogleProfile(sessionId).catch(() => null) : Promise.resolve(null),
                getPlannedItems().catch(() => []),
            ]);

            const resolvedName = googleProfile?.name || 'Traveler';
            const resolvedEmail = googleProfile?.email || buildProfileSubtext(onboardingParams);
            const destination = context?.trip_details?.destination || '';
            const countryCount = destination ? inferCountryCount(destination) : '—';

            setProfile({
                name: resolvedName,
                email: resolvedEmail,
                avatarLetter: resolvedName.slice(0, 1).toUpperCase(),
            });

            setStats({
                trips: context?.trip_details ? '1' : '—',
                places: String(plannedItems.length || 0),
                countries: countryCount,
            });
        } catch (error) {
            console.warn('Profile screen failed:', error);
        } finally {
            setLoading(false);
        }
    };

    const profileTitle = useMemo(() => profile.name, [profile.name]);

    if (loading) {
        return (
            <View style={styles.center}>
                <ActivityIndicator size="large" color="#6C3BFF" />
                <Text style={styles.loadingText}>Loading your profile…</Text>
            </View>
        );
    }

    return (
        <ScrollView style={styles.screen} contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
            <Text style={styles.title}>Profile</Text>

            <TopInfoBar
                timeLabel={formattedTime}
                temperatureLabel={temperatureLabel}
                coordsLabel={coordsLabel}
                locationLabel={locationLabel}
            />

            <View style={styles.profileCard}>
                <View style={styles.profileRow}>
                    <View style={styles.avatarWrap}>
                        <Text style={styles.avatarText}>{profile.avatarLetter}</Text>
                    </View>
                    <View style={styles.profileInfo}>
                        <Text style={styles.profileName}>{profileTitle}</Text>
                        <Text style={styles.profileEmail}>{profile.email}</Text>
                    </View>
                    <Pressable style={styles.profileAction}>
                        <Text style={styles.profileActionIcon}>⚙️</Text>
                    </Pressable>
                </View>

                <View style={styles.statsRow}>
                    <StatBlock value={stats.trips} label="Trips" />
                    <StatBlock value={stats.places} label="Places Visited" />
                    <StatBlock value={stats.countries} label="Countries" />
                </View>
            </View>

            {SETTINGS_ITEMS.map((item) => (
                <View key={item.label} style={styles.settingsCard}>
                    <Text style={styles.settingsIcon}>{item.icon}</Text>
                    <Text style={styles.settingsLabel}>{item.label}</Text>
                    <Text style={styles.settingsArrow}>›</Text>
                </View>
            ))}

            <View style={styles.logoutCard}>
                <Text style={styles.logoutText}>⇢ Log Out</Text>
            </View>

            <View style={styles.footerSpace} />
        </ScrollView>
    );
};

const StatBlock = ({ value, label }) => (
    <View style={styles.statBlock}>
        <Text style={styles.statValue}>{value}</Text>
        <Text style={styles.statLabel}>{label}</Text>
    </View>
);

const inferCountryCount = (destination) => {
    if (!destination) return '—';
    return destination.includes(',') ? '1' : '—';
};

const buildProfileSubtext = (params) => {
    if (params?.cuisinePreference || params?.activityPreference) {
        return `${params.cuisinePreference || 'Travel'} • ${params.activityPreference || 'Explore'}`;
    }
    return 'Connect your Google account to personalize this profile';
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
        marginBottom: 18,
    },
    profileCard: {
        marginTop: 18,
        backgroundColor: '#FFFFFF',
        borderRadius: 28,
        padding: 18,
        borderWidth: 1,
        borderColor: '#ECE6F8',
        shadowColor: 'rgba(60, 32, 122, 0.1)',
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 1,
        shadowRadius: 22,
        elevation: 4,
    },
    profileRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 16,
    },
    avatarWrap: {
        width: 88,
        height: 88,
        borderRadius: 44,
        backgroundColor: '#6C3BFF',
        alignItems: 'center',
        justifyContent: 'center',
        shadowColor: 'rgba(94, 58, 255, 0.28)',
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 1,
        shadowRadius: 18,
        elevation: 5,
    },
    avatarText: {
        color: '#FFFFFF',
        fontSize: 36,
        fontWeight: '800',
    },
    profileInfo: {
        flex: 1,
    },
    profileName: {
        fontSize: 20,
        fontWeight: '800',
        color: '#171329',
        marginBottom: 6,
    },
    profileEmail: {
        fontSize: 15,
        color: '#706A83',
        lineHeight: 22,
    },
    profileAction: {
        width: 46,
        height: 46,
        borderRadius: 23,
        backgroundColor: '#F4F5F9',
        alignItems: 'center',
        justifyContent: 'center',
    },
    profileActionIcon: {
        fontSize: 18,
    },
    statsRow: {
        marginTop: 22,
        flexDirection: 'row',
        justifyContent: 'space-between',
        gap: 12,
    },
    statBlock: {
        flex: 1,
        alignItems: 'center',
    },
    statValue: {
        fontSize: 24,
        fontWeight: '800',
        color: '#6C3BFF',
        marginBottom: 4,
    },
    statLabel: {
        fontSize: 14,
        fontWeight: '600',
        color: '#7B748F',
        textAlign: 'center',
    },
    settingsCard: {
        marginTop: 16,
        backgroundColor: '#FFFFFF',
        borderRadius: 24,
        paddingHorizontal: 18,
        paddingVertical: 22,
        borderWidth: 1,
        borderColor: '#ECE6F8',
        flexDirection: 'row',
        alignItems: 'center',
        shadowColor: 'rgba(60, 32, 122, 0.08)',
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 1,
        shadowRadius: 20,
        elevation: 3,
    },
    settingsIcon: {
        fontSize: 20,
        color: '#5E43FF',
        width: 40,
    },
    settingsLabel: {
        flex: 1,
        fontSize: 18,
        fontWeight: '700',
        color: '#171329',
    },
    settingsArrow: {
        fontSize: 30,
        color: '#B0A9C2',
        lineHeight: 30,
    },
    logoutCard: {
        marginTop: 18,
        backgroundColor: '#FFFFFF',
        borderRadius: 24,
        paddingVertical: 22,
        alignItems: 'center',
        borderWidth: 1,
        borderColor: '#ECE6F8',
    },
    logoutText: {
        color: '#F63C3C',
        fontSize: 18,
        fontWeight: '700',
    },
    footerSpace: {
        height: 24,
    },
});

export default ProfileScreen;
