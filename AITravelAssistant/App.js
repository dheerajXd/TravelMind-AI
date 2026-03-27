import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import AppNavigator from './navigation/AppNavigator';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { LiveContextProvider } from './context/LiveContext';

export default function App() {
  return (
    <SafeAreaProvider>
      <LiveContextProvider>
        <NavigationContainer>
          <AppNavigator />
        </NavigationContainer>
      </LiveContextProvider>
    </SafeAreaProvider>
  );
}
