import React, { useMemo, useState } from 'react';
import {
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    View,
} from 'react-native';

const BUDGET_OPTIONS = ['low', 'medium', 'high'];
const ATMOSPHERE_OPTIONS = ['calm', 'social', 'productive'];
const FOOD_OPTIONS = ['South Indian', 'Cafe', 'Italian', 'Chinese', 'Street Food'];
const FREE_TIME_OPTIONS = ['food', 'coffee', 'work spot', 'sightseeing'];

const OnboardingScreen = ({ navigation }) => {
    const [budget, setBudget] = useState('medium');
    const [vibe, setVibe] = useState('calm');
    const [cuisinePreference, setCuisinePreference] = useState('South Indian');
    const [activityPreference, setActivityPreference] = useState('food');

    const continueParams = useMemo(() => ({
        budget,
        vibe,
        cuisinePreference,
        activityPreference,
        preferences: [activityPreference, cuisinePreference, vibe],
    }), [activityPreference, budget, cuisinePreference, vibe]);

    const handleContinue = () => {
        navigation.replace('MainTabs', continueParams);
    };

    return (
        <ScrollView
            style={styles.screen}
            contentContainerStyle={styles.container}
            showsVerticalScrollIndicator={false}
        >
            <View style={styles.headerBlock}>
                <Text style={styles.heading}>Plan your experience</Text>
                <Text style={styles.subheading}>
                    Set a few standing preferences so the assistant can personalize nearby suggestions without
                    asking the same questions every time.
                </Text>
            </View>

            <View style={styles.card}>
                <PreferenceSection
                    title="Your Usual Budget"
                    options={BUDGET_OPTIONS}
                    value={budget}
                    onSelect={setBudget}
                />

                <PreferenceSection
                    title="Preferred Atmosphere"
                    options={ATMOSPHERE_OPTIONS}
                    value={vibe}
                    onSelect={setVibe}
                />

                <PreferenceSection
                    title="Food You Usually Enjoy"
                    options={FOOD_OPTIONS}
                    value={cuisinePreference}
                    onSelect={setCuisinePreference}
                    compact
                />

                <PreferenceSection
                    title="How You Like Spending Free Time"
                    options={FREE_TIME_OPTIONS}
                    value={activityPreference}
                    onSelect={setActivityPreference}
                    compact
                    last
                />
            </View>

            <Pressable style={styles.continueBtn} onPress={handleContinue}>
                <Text style={styles.continueBtnText}>Continue</Text>
            </Pressable>

            <Text style={styles.hint}>
                You can change these later from your profile.
            </Text>
        </ScrollView>
    );
};

const PreferenceSection = ({ title, options, value, onSelect, compact = false, last = false }) => {
    return (
        <View style={[styles.section, last && styles.sectionLast]}>
            <Text style={styles.sectionTitle}>{title}</Text>
            <View style={[styles.optionRow, compact && styles.optionRowCompact]}>
                {options.map((option) => {
                    const isSelected = value === option;
                    return (
                        <Pressable
                            key={option}
                            style={[styles.optionChip, compact && styles.optionChipCompact, isSelected && styles.optionChipSelected]}
                            onPress={() => onSelect(option)}
                        >
                            <Text style={[styles.optionLabel, isSelected && styles.optionLabelSelected]}>
                                {option}
                            </Text>
                        </Pressable>
                    );
                })}
            </View>
        </View>
    );
};

const styles = StyleSheet.create({
    screen: {
        flex: 1,
        backgroundColor: '#F8F5FF',
    },
    container: {
        paddingHorizontal: 20,
        paddingTop: 60,
        paddingBottom: 48,
        maxWidth: 520,
        width: '100%',
        alignSelf: 'center',
    },
    headerBlock: {
        marginBottom: 28,
    },
    heading: {
        fontSize: 30,
        fontWeight: '800',
        color: '#1B1530',
        letterSpacing: -0.8,
        marginBottom: 10,
    },
    subheading: {
        fontSize: 16,
        color: '#6E6781',
        lineHeight: 25,
    },
    card: {
        backgroundColor: '#FFFFFF',
        borderRadius: 28,
        paddingVertical: 22,
        paddingHorizontal: 18,
        marginBottom: 22,
        borderWidth: 1,
        borderColor: '#EDE6FA',
        shadowColor: '#8F72F4',
        shadowOpacity: 0.08,
        shadowRadius: 18,
        shadowOffset: { width: 0, height: 10 },
        elevation: 4,
    },
    section: {
        paddingBottom: 24,
        marginBottom: 24,
        borderBottomWidth: 1,
        borderBottomColor: '#F1ECFA',
    },
    sectionLast: {
        paddingBottom: 0,
        marginBottom: 0,
        borderBottomWidth: 0,
    },
    sectionTitle: {
        fontSize: 18,
        fontWeight: '700',
        color: '#201935',
        marginBottom: 16,
    },
    optionRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 12,
    },
    optionRowCompact: {
        gap: 10,
    },
    optionChip: {
        minWidth: 94,
        paddingVertical: 14,
        paddingHorizontal: 18,
        borderRadius: 18,
        backgroundColor: '#F4F1FB',
        borderWidth: 1,
        borderColor: '#E8E1F7',
        alignItems: 'center',
        justifyContent: 'center',
    },
    optionChipCompact: {
        minWidth: 0,
        paddingVertical: 12,
        paddingHorizontal: 16,
    },
    optionChipSelected: {
        backgroundColor: '#6C3BFF',
        borderColor: '#6C3BFF',
        shadowColor: '#6C3BFF',
        shadowOpacity: 0.22,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 6 },
        elevation: 4,
    },
    optionLabel: {
        color: '#4D4663',
        fontSize: 15,
        fontWeight: '700',
    },
    optionLabelSelected: {
        color: '#FFFFFF',
    },
    continueBtn: {
        backgroundColor: '#6C3BFF',
        paddingVertical: 18,
        borderRadius: 22,
        alignItems: 'center',
        shadowColor: '#6C3BFF',
        shadowOpacity: 0.28,
        shadowRadius: 18,
        shadowOffset: { width: 0, height: 10 },
        elevation: 5,
    },
    continueBtnText: {
        color: '#FFFFFF',
        fontSize: 17,
        fontWeight: '700',
    },
    hint: {
        textAlign: 'center',
        color: '#9A93AB',
        fontSize: 13,
        marginTop: 14,
    },
});

export default OnboardingScreen;
