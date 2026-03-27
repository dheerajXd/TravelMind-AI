import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';

import SplashScreen from '../screens/SplashScreen';
import OnboardingScreen from '../screens/OnboardingScreen';
import DashboardScreen from '../screens/DashboardScreen';
import ExploreScreen from '../screens/ExploreScreen';
import TripsScreen from '../screens/TripsScreen';
import ProfileScreen from '../screens/ProfileScreen';
import RecommendationScreen from '../screens/RecommendationScreen';

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

const TAB_ICONS = {
    Dashboard: { focused: 'compass', unfocused: 'compass-outline' },
    Explore: { focused: 'time', unfocused: 'time-outline' },
    Trips: { focused: 'airplane', unfocused: 'airplane-outline' },
    Profile: { focused: 'person', unfocused: 'person-outline' },
};

const MainTabs = ({ route }) => {
    const onboardingParams = route?.params ?? {};

    return (
        <Tab.Navigator
            screenOptions={({ route: tabRoute }) => ({
                headerShown: false,
                tabBarIcon: ({ focused, color, size }) => {
                    const icons = TAB_ICONS[tabRoute.name] || TAB_ICONS.Dashboard;
                    const iconName = focused ? icons.focused : icons.unfocused;
                    return <Ionicons name={iconName} size={size} color={color} />;
                },
                tabBarActiveTintColor: '#6C3BFF',
                tabBarInactiveTintColor: '#9E9BAE',
                tabBarStyle: {
                    backgroundColor: '#FFFFFF',
                    borderTopColor: '#EDE6F8',
                    paddingTop: 10,
                    height: 76,
                    paddingBottom: 8,
                    borderTopLeftRadius: 28,
                    borderTopRightRadius: 28,
                    position: 'absolute',
                    shadowColor: 'rgba(53, 31, 105, 0.14)',
                    shadowOffset: { width: 0, height: -8 },
                    shadowOpacity: 1,
                    shadowRadius: 18,
                    elevation: 8,
                },
                tabBarLabelStyle: {
                    fontSize: 12,
                    fontWeight: '600',
                    marginTop: 2,
                },
            })}
        >
            <Tab.Screen
                name="Dashboard"
                component={DashboardScreen}
                initialParams={onboardingParams}
            />
            <Tab.Screen name="Explore" component={ExploreScreen} initialParams={onboardingParams} />
            <Tab.Screen name="Trips" component={TripsScreen} initialParams={onboardingParams} />
            <Tab.Screen name="Profile" component={ProfileScreen} initialParams={onboardingParams} />
        </Tab.Navigator>
    );
};

const AppNavigator = () => {
    return (
        <Stack.Navigator initialRouteName="Splash">
            <Stack.Screen
                name="Splash"
                component={SplashScreen}
                options={{ headerShown: false }}
            />
            <Stack.Screen
                name="Onboarding"
                component={OnboardingScreen}
                options={{ headerShown: false }}
            />
            <Stack.Screen
                name="MainTabs"
                component={MainTabs}
                options={{ headerShown: false }}
            />
            <Stack.Screen
                name="Recommendations"
                component={RecommendationScreen}
                options={{ title: 'Suggestions' }}
            />
        </Stack.Navigator>
    );
};

export default AppNavigator;
