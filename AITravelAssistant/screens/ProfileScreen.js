import React, { useEffect, useMemo, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Linking,
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    View,
} from 'react-native';
import TopInfoBar from '../components/TopInfoBar';
import {
    clearLocalProfileState,
    clearGoogleSessionId,
    fetchNotificationSettings,
    fetchGmailMessages,
    fetchGoogleProfile,
    getGoogleLoginUrlForRedirect,
    getWebOAuthReturnUrl,
    fetchUserContext,
    getGoogleSessionId,
    getOrCreateUserId,
    getNotificationsEnabled,
    setNotificationsEnabled,
    triggerLocationUpdate,
    triggerManualNotifications,
} from '../services/backendService';
import { useLiveContext } from '../context/LiveContext';
import { usePlan } from '../context/PlanContext';

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
    const [googleConnection, setGoogleConnection] = useState({
        connected: false,
        email: null,
        messageCount: 0,
    });

    const onboardingParams = route?.params ?? {};
    const { formattedTime, temperatureLabel, coordsLabel, locationLabel, latitude, longitude } = useLiveContext();
    const { plan, clearPlan } = usePlan();

    useEffect(() => {
        loadProfile();
        const unsubscribe = navigation.addListener('focus', loadProfile);
        return unsubscribe;
    }, [navigation, plan]);

    const loadProfile = async () => {
        setLoading(true);
        try {
            const userId = await getOrCreateUserId();
            const sessionId = await getGoogleSessionId();

            const [context, googleProfile, notificationSettings, gmailData] = await Promise.all([
                fetchUserContext(userId).catch(() => null),
                sessionId ? fetchGoogleProfile(sessionId).catch(() => null) : Promise.resolve(null),
                fetchNotificationSettings(userId).catch(() => null),
                sessionId ? fetchGmailMessages(sessionId, 5).catch(() => null) : Promise.resolve(null),
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
                places: String(plan.length || 0),
                countries: countryCount,
            });
            setNotificationsState(
                typeof notificationSettings?.notifications_enabled === 'boolean'
                    ? notificationSettings.notifications_enabled
                    : await getNotificationsEnabled().catch(() => true)
            );
            setGoogleConnection({
                connected: Boolean(sessionId && googleProfile),
                email: googleProfile?.email || null,
                messageCount: gmailData?.messages?.length || 0,
            });
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
            const userId = await getOrCreateUserId();
            await setNotificationsEnabled(nextValue, {
                userId,
                radiusKm: 2,
                maxPerDay: 3,
            });
            setNotificationsState(nextValue);
            if (nextValue) {
                try {
                    if (typeof latitude === 'number' && typeof longitude === 'number') {
                        await triggerLocationUpdate({ userId, lat: latitude, lng: longitude });
                    } else {
                        await triggerManualNotifications(userId);
                    }
                } catch (triggerError) {
                    console.warn('Notification trigger failed:', triggerError);
                }
            }
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

    const handleGoogleConnect = async () => {
        try {
            await clearGoogleSessionId().catch(() => null);
            setGoogleConnection({
                connected: false,
                email: null,
                messageCount: 0,
            });
            const redirectTarget =
                Platform.OS === 'web' && typeof window !== 'undefined'
                    ? getWebOAuthReturnUrl()
                    : null;
            const authUrl = getGoogleLoginUrlForRedirect(redirectTarget);
            if (Platform.OS === 'web' && typeof window !== 'undefined') {
                window.location.assign(authUrl);
                return;
            }
            await Linking.openURL(authUrl);
        } catch (error) {
            console.warn('Google connect failed:', error);
            Alert.alert('Google connection', 'Could not open the Google sign-in flow right now.');
        }
    };

    const handleGoogleDisconnect = () => {
        const runDisconnect = async () => {
            try {
                await clearGoogleSessionId();
                setGoogleConnection({
                    connected: false,
                    email: null,
                    messageCount: 0,
                });
                setProfile((current) => ({
                    ...current,
                    email: buildProfileSubtext(onboardingParams),
                }));
                await loadProfile();
            } catch (error) {
                console.warn('Google disconnect failed:', error);
                Alert.alert('Google connection', 'Could not disconnect the Google account right now.');
            }
        };

        if (Platform.OS === 'web' && typeof window !== 'undefined') {
            const confirmed = window.confirm('Do you want to disconnect your Google account from this app?');
            if (confirmed) {
                runDisconnect();
            }
            return;
        }

        Alert.alert('Disconnect Google', 'Do you want to disconnect your Google account from this app?', [
            { text: 'Cancel', style: 'cancel' },
            {
                text: 'Disconnect',
                style: 'destructive',
                onPress: runDisconnect,
            },
        ]);
    };

    const handleLogout = () => {
        const runLogout = async () => {
            try {
                await clearLocalProfileState();
                await clearPlan();
                navigation.reset({
                    index: 0,
                    routes: [{ name: 'Splash' }],
                });
            } catch (error) {
                console.warn('Logout failed:', error);
            }
        };

        if (Platform.OS === 'web' && typeof window !== 'undefined') {
            const confirmed = window.confirm('Do you want to sign out of this local profile session?');
            if (confirmed) {
                runLogout();
            }
            return;
        }

        Alert.alert('Log out', 'Do you want to sign out of this local profile session?', [
            { text: 'Cancel', style: 'cancel' },
            {
                text: 'Log Out',
                style: 'destructive',
                onPress: runLogout,
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

            <View style={styles.googleCard}>
                <View style={styles.googleHeaderRow}>
                    <View style={styles.googleContent}>
                        <Text style={styles.googleEyebrow}>GOOGLE SYNC</Text>
                        <Text style={styles.googleTitle}>
                            {googleConnection.connected ? 'Google account connected' : 'Connect Gmail and Calendar'}
                        </Text>
                        <Text style={styles.googleSubtitle}>
                            {googleConnection.connected
                                ? `${googleConnection.email || 'Google account linked'} · ${googleConnection.messageCount} recent inbox messages synced`
                                : 'Connect your Google account so the app can read Calendar and Gmail, build your schedule, and detect leisure time automatically.'}
                        </Text>
                    </View>
                    <View
                        style={[
                            styles.googleStatusChip,
                            googleConnection.connected ? styles.googleStatusChipConnected : styles.googleStatusChipDisconnected,
                        ]}
                    >
                        <Text
                            style={[
                                styles.googleStatusText,
                                googleConnection.connected ? styles.googleStatusTextConnected : styles.googleStatusTextDisconnected,
                            ]}
                        >
                            {googleConnection.connected ? 'Connected' : 'Not linked'}
                        </Text>
                    </View>
                </View>

                <View style={styles.googleActionsRow}>
                    <Pressable style={styles.googlePrimaryButton} onPress={handleGoogleConnect}>
                        <Text style={styles.googlePrimaryButtonText}>
                            {googleConnection.connected ? 'Reconnect Google' : 'Connect Google'}
                        </Text>
                    </Pressable>
                    {googleConnection.connected ? (
                        <Pressable style={styles.googleSecondaryButton} onPress={handleGoogleDisconnect}>
                            <Text style={styles.googleSecondaryButtonText}>Disconnect</Text>
                        </Pressable>
                    ) : null}
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
    googleCard: {
        marginTop: 18,
        backgroundColor: '#FFFFFF',
        borderRadius: 24,
        padding: 18,
        borderWidth: 1,
        borderColor: '#ECE6F8',
        shadowColor: 'rgba(60, 32, 122, 0.08)',
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 1,
        shadowRadius: 20,
        elevation: 3,
    },
    googleHeaderRow: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: 12,
        marginBottom: 16,
    },
    googleContent: {
        flex: 1,
    },
    googleEyebrow: {
        fontSize: 12,
        fontWeight: '800',
        color: '#7B57F6',
        letterSpacing: 1,
        marginBottom: 6,
    },
    googleTitle: {
        fontSize: 19,
        fontWeight: '800',
        color: '#171329',
        marginBottom: 6,
    },
    googleSubtitle: {
        fontSize: 14,
        lineHeight: 21,
        color: '#706A83',
    },
    googleStatusChip: {
        borderRadius: 999,
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderWidth: 1,
    },
    googleStatusChipConnected: {
        backgroundColor: '#EEF8F3',
        borderColor: '#D5F0E0',
    },
    googleStatusChipDisconnected: {
        backgroundColor: '#F4EEFF',
        borderColor: '#E4D7FF',
    },
    googleStatusText: {
        fontSize: 12,
        fontWeight: '800',
    },
    googleStatusTextConnected: {
        color: '#228B5F',
    },
    googleStatusTextDisconnected: {
        color: '#6B46C1',
    },
    googleActionsRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 12,
    },
    googlePrimaryButton: {
        flexGrow: 1,
        minWidth: 170,
        backgroundColor: '#6C3BFF',
        borderRadius: 18,
        paddingVertical: 14,
        paddingHorizontal: 18,
        alignItems: 'center',
        justifyContent: 'center',
    },
    googlePrimaryButtonText: {
        color: '#FFFFFF',
        fontSize: 15,
        fontWeight: '800',
    },
    googleSecondaryButton: {
        minWidth: 116,
        backgroundColor: '#F4EEFF',
        borderRadius: 18,
        paddingVertical: 14,
        paddingHorizontal: 18,
        alignItems: 'center',
        justifyContent: 'center',
    },
    googleSecondaryButtonText: {
        color: '#5D39D8',
        fontSize: 15,
        fontWeight: '700',
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
