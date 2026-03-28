import React from 'react';
import {
    ActivityIndicator,
    Linking,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    View,
} from 'react-native';
import SuggestionCard from '../components/SuggestionCard';
import { usePlan } from '../context/PlanContext';

const SavedPlacesScreen = ({ navigation }) => {
    const { plan: items, loading, removeFromPlan } = usePlan();

    const handleRemove = async (item) => {
        try {
            await removeFromPlan(item, { toast: true });
        } catch (error) {
            console.warn('Saved place removal failed:', error);
        }
    };

    const handleOpenMap = async (item) => {
        if (!item.mapQuery) return;
        const url = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(item.mapQuery)}`;
        try {
            await Linking.openURL(url);
        } catch (error) {
            console.warn('Saved place map open failed:', error);
        }
    };

    return (
        <ScrollView style={styles.screen} contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
            <View style={styles.headerRow}>
                <Pressable style={styles.backButton} onPress={() => navigation.goBack()}>
                    <Text style={styles.backButtonText}>←</Text>
                </Pressable>
                <View style={styles.headerTextBlock}>
                    <Text style={styles.title}>Saved Places</Text>
                    <Text style={styles.subtitle}>Your planned stops appear here for easy access later.</Text>
                </View>
            </View>

            {loading ? (
                <View style={styles.loadingWrap}>
                    <ActivityIndicator size="large" color="#6C3BFF" />
                    <Text style={styles.loadingText}>Loading saved places…</Text>
                </View>
            ) : null}

            {!loading && items.length === 0 ? (
                <View style={styles.emptyCard}>
                    <Text style={styles.emptyTitle}>No saved places yet</Text>
                    <Text style={styles.emptyText}>Use Add to Plan from suggestions to keep nearby spots here.</Text>
                </View>
            ) : null}

            {!loading && items.length > 0 ? (
                <View style={styles.listWrap}>
                    {items.map((item) => (
                        <SuggestionCard
                            key={item.id}
                            name={item.name}
                            subtitle={item.subtitle}
                            description={item.description}
                            rating={item.rating}
                            distanceLabel={item.distanceLabel}
                            imageUrl={item.imageUrl}
                            metaText={item.metaText}
                            primaryActionLabel="Remove"
                            secondaryActionLabel="Map"
                            onPrimaryAction={() => handleRemove(item)}
                            onSecondaryAction={() => handleOpenMap(item)}
                        />
                    ))}
                </View>
            ) : null}
        </ScrollView>
    );
};

const styles = StyleSheet.create({
    screen: {
        flex: 1,
        backgroundColor: '#F8F9FB',
    },
    container: {
        paddingHorizontal: 18,
        paddingTop: 18,
        paddingBottom: 36,
    },
    headerRow: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 14,
        marginBottom: 20,
    },
    backButton: {
        width: 48,
        height: 48,
        borderRadius: 24,
        backgroundColor: '#FFFFFF',
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1,
        borderColor: '#ECE6F8',
    },
    backButtonText: {
        fontSize: 24,
        color: '#1B1530',
    },
    headerTextBlock: {
        flex: 1,
    },
    title: {
        fontSize: 24,
        fontWeight: '800',
        color: '#171329',
        marginBottom: 6,
    },
    subtitle: {
        fontSize: 15,
        color: '#706A83',
        lineHeight: 22,
    },
    loadingWrap: {
        alignItems: 'center',
        paddingVertical: 48,
    },
    loadingText: {
        marginTop: 12,
        fontSize: 16,
        color: '#6B6480',
    },
    emptyCard: {
        backgroundColor: '#FFFFFF',
        borderRadius: 24,
        padding: 20,
        borderWidth: 1,
        borderColor: '#ECE6F8',
    },
    emptyTitle: {
        fontSize: 18,
        fontWeight: '800',
        color: '#171329',
        marginBottom: 8,
    },
    emptyText: {
        fontSize: 15,
        color: '#706A83',
        lineHeight: 22,
    },
    listWrap: {
        gap: 16,
    },
});

export default SavedPlacesScreen;
