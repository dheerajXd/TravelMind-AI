import React, { useEffect, useMemo, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Linking,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    View,
} from 'react-native';
import TopInfoBar from '../components/TopInfoBar';
import {
    clearLocalProfileState,
    fetchGoogleProfile,
    getPlannedItems,
    fetchUserContext,
    getGoogleSessionId,
    getOrCreateUserId,
    getNotificationsEnabled,
    setNotificationsEnabled,
} from '../services/backendService';
import { useLiveContext } from '../context/LiveContext';

const ProfileScreen = ({ route, navigation }) => {
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
    const [notificationsEnabled, setNotificationsState] = useState(true);

    const onboardingParams = route?.params ?? {};
    const { formattedTime, temperatureLabel, coordsLabel, locationLabel } = useLiveContext();

    useEffect(() => {
        loadProfile();
        const unsubscribe = navigation.addListener('focus', loadProfile);
        return unsubscribe;
    }, [navigation]);

    const loadProfile = async () => {
        setLoading(true);
        try {
            const userId = await getOrCreateUserId();
            const sessionId = await getGoogleSessionId();

            const [context, googleProfile, plannedItems, notificationsState] = await Promise.all([
                fetchUserContext(userId).catch(() => null),
                sessionId ? fetchGoogleProfile(sessionId).catch(() => null) : Promise.resolve(null),
                getPlannedItems().catch(() => []),
                getNotificationsEnabled().catch(() => true),
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
            setNotificationsState(notificationsState);
        } catch (error) {
            console.warn('Profile screen failed:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleUpdatePreferences = () => {
        navigation.navigate('Onboarding', {
            mode: 'edit',
            currentPreferences: {
                budget: onboardingParams.budget,
                vibe: onboardingParams.vibe,
                cuisinePreference: onboardingParams.cuisinePreference,
                activityPreference: onboardingParams.activityPreference,
            },
        });
    };

    const handleNotificationsPress = async () => {
        const nextValue = !notificationsEnabled;
        try {
            await setNotificationsEnabled(nextValue);
            setNotificationsState(nextValue);
            Alert.alert(
                'Notifications updated',
                nextValue ? 'Proactive trip alerts are now enabled.' : 'Trip alerts are now paused.'
            );
        } catch (error) {
            console.warn('Notifications update failed:', error);
        }
    };

    const handleSavedPlacesPress = () => {
        navigation.navigate('SavedPlaces');
    };

    const handleHelpPress = async () => {
        const helpUrl = 'mailto:support@travelmind.ai?subject=TravelMind%20Support';
        try {
            await Linking.openURL(helpUrl);
        } catch (error) {
            console.warn('Help link open failed:', error);
            Alert.alert('Help & Support', 'Reach us at support@travelmind.ai');
        }
    };

    const handleLogout = () => {
        Alert.alert('Log out', 'Do you want to sign out of this local profile session?', [
            { text: 'Cancel', style: 'cancel' },
            {
                text: 'Log Out',
                style: 'destructive',
                onPress: async () => {
                    try {
                        await clearLocalProfileState();
                        navigation.reset({
                            index: 0,
                            routes: [{ name: 'Splash' }],
                        });
                    } catch (error) {
                        console.warn('Logout failed:', error);
                    }
                },
            },
        ]);
    };

    const profileTitle = useMemo(() => profile.name, [profile.name]);
    const settingsItems = useMemo(() => ([
        { icon: '✨', label: 'Update Preferences', onPress: handleUpdatePreferences },
        {
            icon: notificationsEnabled ? '🔔' : '🔕',
            label: `Notifications ${notificationsEnabled ? 'On' : 'Off'}`,
            onPress: handleNotificationsPress,
        },
        { icon: '♡', label: 'Saved Places', onPress: handleSavedPlacesPress },
        { icon: '❓', label: 'Help & Support', onPress: handleHelpPress },
    ]), [notificationsEnabled]);

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
                    <Pressable style={styles.profileAction} onPress={handleUpdatePreferences}>
                        <Text style={styles.profileActionIcon}>⚙️</Text>
                    </Pressable>
                </View>

                <View style={styles.statsRow}>
                    <StatBlock value={stats.trips} label="Trips" />
                    <StatBlock value={stats.places} label="Places Visited" />
                    <StatBlock value={stats.countries} label="Countries" />
                </View>
            </View>

            {settingsItems.map((item) => (
                <Pressable key={item.label} style={styles.settingsCard} onPress={item.onPress}>
                    <Text style={styles.settingsIcon}>{item.icon}</Text>
                    <Text style={styles.settingsLabel}>{item.label}</Text>
                    <Text style={styles.settingsArrow}>›</Text>
                </Pressable>
            ))}

            <Pressable style={styles.logoutCard} onPress={handleLogout}>
                <Text style={styles.logoutText}>⇢ Log Out</Text>
            </Pressable>

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
