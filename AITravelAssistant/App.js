import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import AppNavigator from './navigation/AppNavigator';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { LiveContextProvider } from './context/LiveContext';
import { Platform } from 'react-native';
import { saveGoogleSessionId } from './services/backendService';

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
        <GoogleOAuthBootstrap />
        <NavigationContainer>
          <AppNavigator />
        </NavigationContainer>
      </LiveContextProvider>
    </SafeAreaProvider>
  );
}
