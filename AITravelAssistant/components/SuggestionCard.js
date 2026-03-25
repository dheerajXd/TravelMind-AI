import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

const SuggestionCard = ({ name, rating, address }) => {
    return (
        <View style={styles.card}>
            <View style={styles.header}>
                <Text style={styles.name}>{name}</Text>
                <Text style={styles.rating}>⭐ {rating}</Text>
            </View>
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
        color: '#ff9800',
        marginLeft: 8,
    },
    address: {
        fontSize: 14,
        color: '#666',
    },
});

export default SuggestionCard;
