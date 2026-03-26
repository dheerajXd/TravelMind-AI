import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

const SuggestionCard = ({ name, rating, address, helperText, badges = [], metaText }) => {
    return (
        <View style={styles.card}>
            <View style={styles.header}>
                <Text style={styles.name}>{name}</Text>
                {rating ? <Text style={styles.rating}>{rating}</Text> : null}
            </View>
            {helperText ? <Text style={styles.helperText}>{helperText}</Text> : null}
            {badges.length ? (
                <View style={styles.badgeRow}>
                    {badges.map((badge) => (
                        <View key={badge} style={styles.badge}>
                            <Text style={styles.badgeText}>{badge}</Text>
                        </View>
                    ))}
                </View>
            ) : null}
            {metaText ? <Text style={styles.metaText}>{metaText}</Text> : null}
            <Text style={styles.address}>{address}</Text>
        </View>
    );
};

const styles = StyleSheet.create({
    card: {
        backgroundColor: '#fff',
        padding: 16,
        borderRadius: 12,
        marginBottom: 12,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
        elevation: 2,
        borderWidth: 1,
        borderColor: '#f0f0f0',
    },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 8,
    },
    name: {
        fontSize: 16,
        fontWeight: 'bold',
        color: '#333',
        flex: 1,
    },
    rating: {
        fontSize: 14,
        fontWeight: '600',
        color: '#4a148c',
        marginLeft: 8,
    },
    helperText: {
        fontSize: 12,
        fontWeight: '700',
        color: '#5e35b1',
        marginBottom: 6,
        textTransform: 'uppercase',
        letterSpacing: 0.4,
    },
    badgeRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
        marginBottom: 10,
    },
    badge: {
        backgroundColor: '#f3e5f5',
        borderRadius: 999,
        paddingHorizontal: 10,
        paddingVertical: 5,
        borderWidth: 1,
        borderColor: '#e1bee7',
    },
    badgeText: {
        fontSize: 12,
        fontWeight: '600',
        color: '#6a1b9a',
    },
    metaText: {
        fontSize: 13,
        color: '#5f6368',
        marginBottom: 8,
        fontWeight: '600',
    },
    address: {
        fontSize: 14,
        color: '#666',
    },
});

export default SuggestionCard;
