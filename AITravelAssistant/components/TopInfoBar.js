import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

const TopInfoBar = ({ timeLabel, temperatureLabel, coordsLabel, locationLabel }) => {
    return (
        <View style={styles.container}>
            <View style={styles.item}>
                <Text style={styles.icon}>🕒</Text>
                <Text style={styles.text}>{timeLabel}</Text>
            </View>
            <View style={styles.item}>
                <Text style={styles.icon}>☀️</Text>
                <Text style={styles.text}>{temperatureLabel}</Text>
            </View>
            <View style={styles.locationWrap}>
                <Text style={styles.icon}>📍</Text>
                <View style={styles.locationTextWrap}>
                    <Text style={styles.text} numberOfLines={1}>{locationLabel}</Text>
                    {coordsLabel ? <Text style={styles.coords}>{coordsLabel}</Text> : null}
                </View>
            </View>
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        backgroundColor: '#FFFFFF',
        borderRadius: 22,
        paddingHorizontal: 16,
        paddingVertical: 14,
        marginBottom: 20,
        flexDirection: 'row',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 14,
        borderWidth: 1,
        borderColor: '#ECE5FA',
        shadowColor: 'rgba(60, 32, 122, 0.1)',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 1,
        shadowRadius: 20,
        elevation: 4,
    },
    item: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    icon: {
        fontSize: 15,
    },
    text: {
        fontSize: 15,
        fontWeight: '700',
        color: '#40405C',
    },
    locationWrap: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        flexShrink: 1,
    },
    locationTextWrap: {
        flexShrink: 1,
    },
    coords: {
        marginTop: 2,
        fontSize: 11,
        color: '#A09AAF',
        fontWeight: '600',
    },
});

export default TopInfoBar;
