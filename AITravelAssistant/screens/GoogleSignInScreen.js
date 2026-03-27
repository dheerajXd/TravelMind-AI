import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  checkBackendHealth,
  clearGoogleSessionId,
  fetchGoogleProfile,
  getGoogleLoginUrlForRedirect,
  getGoogleSessionId,
} from '../services/backendService';

const GoogleSignInScreen = ({ navigation }) => {
  const [checking, setChecking] = useState(true);
  const [connectedProfile, setConnectedProfile] = useState(null);
  const [autoContinuing, setAutoContinuing] = useState(false);
  const [openingGoogle, setOpeningGoogle] = useState(false);

  useEffect(() => {
    let active = true;

    const loadGoogleState = async () => {
      try {
        const sessionId = await getGoogleSessionId();
        if (!sessionId) {
          if (active) {
            setConnectedProfile(null);
          }
          return;
        }

        const profile = await fetchGoogleProfile(sessionId).catch(() => null);
        if (!active) return;

        if (profile) {
          setConnectedProfile(profile);
        } else {
          await clearGoogleSessionId().catch(() => null);
          setConnectedProfile(null);
        }
      } finally {
        if (active) {
          setChecking(false);
        }
      }
    };

    loadGoogleState();
    const unsubscribe = navigation.addListener('focus', loadGoogleState);
    return () => {
      active = false;
      unsubscribe();
    };
  }, [navigation]);

  useEffect(() => {
    if (!connectedProfile) {
      setAutoContinuing(false);
      return;
    }

    setAutoContinuing(true);
    const timer = setTimeout(() => {
      navigation.replace('Onboarding');
    }, 900);

    return () => clearTimeout(timer);
  }, [connectedProfile, navigation]);

  const handleConnectGoogle = async () => {
    try {
      setOpeningGoogle(true);
      await checkBackendHealth();
      await clearGoogleSessionId().catch(() => null);
      setConnectedProfile(null);
      const redirectTarget =
        Platform.OS === 'web' && typeof window !== 'undefined'
          ? `${window.location.origin}${window.location.pathname}`
          : null;
      const authUrl = getGoogleLoginUrlForRedirect(redirectTarget);
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        window.location.assign(authUrl);
        return;
      }
      await Linking.openURL(authUrl);
    } catch (error) {
      console.warn('Google sign-in launch failed:', error);
      const detail = error?.message?.includes('Failed to fetch') || error?.message?.includes('Network')
        ? 'The backend is not reachable right now. Start the FastAPI server first, then try again.'
        : 'Could not open the Google sign-in flow right now.';
      Alert.alert('Google sign-in', detail);
      setOpeningGoogle(false);
    }
  };

  const handleContinue = () => {
    navigation.replace('Onboarding');
  };

  if (checking) {
    return (
      <View style={styles.loadingScreen}>
        <ActivityIndicator size="large" color="#6C3BFF" />
        <Text style={styles.loadingText}>Checking Google connection…</Text>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <View style={styles.glowOne} />
      <View style={styles.glowTwo} />

      <View style={styles.heroCard}>
        <View style={styles.logoWrap}>
          <View style={styles.logoShell}>
            <Text style={styles.logoPin}>⌖</Text>
          </View>
        </View>

        <Text style={styles.eyebrow}>GOOGLE SYNC</Text>
        <Text style={styles.title}>Connect Google to make your trip smarter</Text>
        <Text style={styles.subtitle}>
          We’ll use Gmail and Calendar to understand your day and spot free time automatically.
        </Text>

        <View style={styles.benefitsCard}>
          <BenefitRow icon="✈️" text="Find travel emails" />
          <BenefitRow icon="🗓️" text="Build your schedule" />
          <BenefitRow icon="✨" text="Spot free time" />
        </View>

        <View
          style={[
            styles.statusCard,
            connectedProfile ? styles.statusCardConnected : styles.statusCardPending,
          ]}
        >
          <Text style={styles.statusTitle}>
            {connectedProfile ? 'Google connected' : 'Google not connected yet'}
          </Text>
          <Text style={styles.statusText}>
            {connectedProfile
              ? `${connectedProfile.email || connectedProfile.name || 'Google account'} is ready to sync with your travel assistant.${autoContinuing ? ' Taking you to preferences…' : ''}`
              : 'You can also skip this for now and connect later.'}
          </Text>
        </View>

        <Pressable style={[styles.primaryButton, openingGoogle && styles.primaryButtonDisabled]} onPress={handleConnectGoogle} disabled={openingGoogle}>
          <Text style={styles.primaryButtonText}>
            {openingGoogle ? 'Opening Google…' : connectedProfile ? 'Reconnect Google' : 'Continue with Google'}
          </Text>
        </Pressable>

        <Pressable
          style={[styles.secondaryButton, !connectedProfile && styles.secondaryButtonMuted]}
          onPress={handleContinue}
        >
          <Text style={[styles.secondaryButtonText, !connectedProfile && styles.secondaryButtonTextMuted]}>
            {connectedProfile ? 'Continue to preferences' : 'Skip for now'}
          </Text>
        </Pressable>
      </View>
    </View>
  );
};

const BenefitRow = ({ icon, text }) => (
  <View style={styles.benefitRow}>
    <Text style={styles.benefitIcon}>{icon}</Text>
    <Text style={styles.benefitText}>{text}</Text>
  </View>
);

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#F8F5FF',
    justifyContent: 'center',
    paddingHorizontal: 22,
    overflow: 'hidden',
  },
  loadingScreen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F8F5FF',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 16,
    color: '#6B6480',
  },
  glowOne: {
    position: 'absolute',
    width: 280,
    height: 280,
    borderRadius: 140,
    backgroundColor: 'rgba(99, 102, 241, 0.10)',
    top: 90,
    left: -40,
  },
  glowTwo: {
    position: 'absolute',
    width: 260,
    height: 260,
    borderRadius: 130,
    backgroundColor: 'rgba(236, 72, 153, 0.08)',
    bottom: 80,
    right: -40,
  },
  heroCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 30,
    paddingHorizontal: 22,
    paddingTop: 28,
    paddingBottom: 24,
    borderWidth: 1,
    borderColor: '#ECE6F8',
    shadowColor: 'rgba(60, 32, 122, 0.10)',
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 1,
    shadowRadius: 28,
    elevation: 6,
  },
  logoWrap: {
    alignItems: 'center',
    marginBottom: 18,
  },
  logoShell: {
    width: 72,
    height: 72,
    borderRadius: 24,
    backgroundColor: '#6C3BFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoPin: {
    fontSize: 30,
    color: '#FFFFFF',
    fontWeight: '800',
  },
  eyebrow: {
    fontSize: 12,
    fontWeight: '800',
    color: '#7B57F6',
    letterSpacing: 1.1,
    marginBottom: 8,
    textAlign: 'center',
  },
  title: {
    fontSize: 28,
    lineHeight: 36,
    fontWeight: '800',
    color: '#171329',
    textAlign: 'center',
    marginBottom: 12,
  },
  subtitle: {
    fontSize: 16,
    lineHeight: 24,
    color: '#6F6882',
    textAlign: 'center',
    marginBottom: 20,
  },
  benefitsCard: {
    backgroundColor: '#F8F5FF',
    borderRadius: 22,
    padding: 16,
    borderWidth: 1,
    borderColor: '#EEE6FB',
    marginBottom: 16,
    gap: 12,
  },
  benefitRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  benefitIcon: {
    fontSize: 18,
    marginTop: 1,
  },
  benefitText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
    color: '#504A66',
    fontWeight: '600',
  },
  statusCard: {
    borderRadius: 20,
    padding: 16,
    marginBottom: 18,
    borderWidth: 1,
  },
  statusCardConnected: {
    backgroundColor: '#EEF8F3',
    borderColor: '#D5F0E0',
  },
  statusCardPending: {
    backgroundColor: '#F4EEFF',
    borderColor: '#E4D7FF',
  },
  statusTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#1D1733',
    marginBottom: 6,
  },
  statusText: {
    fontSize: 14,
    lineHeight: 21,
    color: '#6E6781',
  },
  primaryButton: {
    backgroundColor: '#6C3BFF',
    borderRadius: 20,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  primaryButtonDisabled: {
    opacity: 0.72,
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '800',
  },
  secondaryButton: {
    borderRadius: 20,
    paddingVertical: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F4EEFF',
  },
  secondaryButtonMuted: {
    backgroundColor: '#F6F1FB',
  },
  secondaryButtonText: {
    color: '#5D39D8',
    fontSize: 15,
    fontWeight: '700',
  },
  secondaryButtonTextMuted: {
    color: '#847C99',
  },
});

export default GoogleSignInScreen;
