import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import HomeScreen from '../screens/HomeScreen';
import RecommendationScreen from '../screens/RecommendationScreen';

const Stack = createNativeStackNavigator();

const AppNavigator = () => {
    return (
        <Stack.Navigator initialRouteName="Home">
            <Stack.Screen
                name="Home"
                component={HomeScreen}
                options={{ title: 'AI Travel Assistant' }}
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
