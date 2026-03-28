import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import AppNavigator from './navigation/AppNavigator';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { LiveContextProvider } from './context/LiveContext';
import { PlanProvider } from './context/PlanContext';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { getOrCreateUserId, registerDeviceToken, saveGoogleSessionId } from './services/backendService';

const GOOGLE_OAUTH_COMPLETED_KEY = 'google_oauth_completed_at';

const PushTokenBootstrap = () => {
  React.useEffect(() => {
    let cancelled = false;

    const bootstrapPushToken = async () => {
      if (Platform.OS === 'web') {
        return;
      }

      try {
        const permissionResult = await Notifications.requestPermissionsAsync();
        const granted =
          permissionResult.granted ||
          permissionResult.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL;
        if (!granted) {
          console.log('Push permission not granted.');
          return;
        }

        if (Platform.OS === 'android') {
          await Notifications.setNotificationChannelAsync('default', {
            name: 'default',
            importance: Notifications.AndroidImportance.DEFAULT,
          });
        }

        const tokenResponse = await Notifications.getDevicePushTokenAsync();
        const nativeToken = typeof tokenResponse?.data === 'string' ? tokenResponse.data.trim() : '';
        console.log('DEVICE PUSH TOKEN:', nativeToken);
        if (!nativeToken || cancelled) {
          return;
        }

        const userId = await getOrCreateUserId();
        if (cancelled) {
          return;
        }

        await registerDeviceToken(userId, nativeToken);
        console.log('Device token registered for user:', userId);
      } catch (error) {
        console.warn('Device token bootstrap failed:', error);
      }
    };

    bootstrapPushToken();

    return () => {
      cancelled = true;
    };
  }, []);

  return null;
};

const GoogleOAuthBootstrap = () => {
  React.useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') {
      return;
    }

    const params = new URLSearchParams(window.location.search);
    const sessionId = params.get('google_session_id');
    const connected = params.get('google_connected');
    if (!sessionId || connected !== '1') {
      return;
    }

    saveGoogleSessionId(sessionId)
      .then(() => {
        window.localStorage.setItem(GOOGLE_OAUTH_COMPLETED_KEY, String(Date.now()));
        window.dispatchEvent(new CustomEvent('google-oauth-complete', { detail: { sessionId } }));
        params.delete('google_session_id');
        params.delete('google_connected');
        const cleanedQuery = params.toString();
        const cleanedUrl = `${window.location.pathname}${cleanedQuery ? `?${cleanedQuery}` : ''}${window.location.hash || ''}`;
        window.history.replaceState({}, '', cleanedUrl);
      })
      .catch((error) => {
        console.warn('Google OAuth bootstrap failed:', error);
      });
  }, []);

  return null;
};

export default function App() {
  return (
    <SafeAreaProvider>
      <LiveContextProvider>
        <PlanProvider>
          <GoogleOAuthBootstrap />
          <PushTokenBootstrap />
          <NavigationContainer>
            <AppNavigator />
          </NavigationContainer>
        </PlanProvider>
      </LiveContextProvider>
    </SafeAreaProvider>
  );
}
