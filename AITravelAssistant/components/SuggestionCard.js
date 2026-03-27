import React from 'react';
import {
    Image,
    Pressable,
    StyleSheet,
    Text,
    View,
} from 'react-native';

const SuggestionCard = ({
    name,
    rating,
    address,
    helperText,
    badges = [],
    metaText,
    imageUrl,
    subtitle,
    description,
    distanceLabel,
    primaryActionLabel,
    secondaryActionLabel,
    onPrimaryAction,
    onSecondaryAction,
    compact = false,
    trailingIcon = '📍',
}) => {
    if (compact) {
        return (
            <View style={styles.compactCard}>
                <View style={styles.compactThumbWrap}>
                    {imageUrl ? (
                        <Image source={{ uri: imageUrl }} style={styles.compactThumb} />
                    ) : (
                        <View style={[styles.compactThumb, styles.compactThumbFallback]}>
                            <Text style={styles.compactThumbFallbackText}>✦</Text>
                        </View>
                    )}
                </View>
                <View style={styles.compactContent}>
                    <Text style={styles.compactName} numberOfLines={1}>{name}</Text>
                    {subtitle ? <Text style={styles.compactSubtitle}>{subtitle}</Text> : null}
                    <View style={styles.compactMetaRow}>
                        {rating ? <Text style={styles.compactRating}>★ {rating}</Text> : null}
                        {metaText ? <Text style={styles.compactMeta}>{metaText}</Text> : null}
                    </View>
                </View>
                <Text style={styles.compactTrailing}>{trailingIcon}</Text>
            </View>
        );
    }

    const isRich = Boolean(imageUrl || primaryActionLabel || secondaryActionLabel || distanceLabel);

    return (
        <View style={[styles.card, isRich && styles.cardRich]}>
            {imageUrl ? (
                <View style={styles.imageWrap}>
                    <Image source={{ uri: imageUrl }} style={styles.image} />
                    {rating ? (
                        <View style={styles.ratingPill}>
                            <Text style={styles.ratingPillText}>{rating}</Text>
                        </View>
                    ) : null}
                </View>
            ) : null}

            <View style={styles.content}>
                <View style={styles.header}>
                    <View style={styles.headerText}>
                        <Text style={styles.name}>{name}</Text>
                        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
                    </View>
                    {!imageUrl && rating ? <Text style={styles.rating}>{rating}</Text> : null}
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

                {metaText || distanceLabel ? (
                    <View style={styles.metaRow}>
                        {metaText ? <Text style={styles.metaText}>{metaText}</Text> : null}
                        {distanceLabel ? <Text style={styles.distanceText}>{distanceLabel}</Text> : null}
                    </View>
                ) : null}

                {description ? <Text style={styles.description}>{description}</Text> : null}
                {!description && address ? <Text style={styles.address}>{address}</Text> : null}
                {description && address ? <Text style={styles.address}>{address}</Text> : null}

                {primaryActionLabel || secondaryActionLabel ? (
                    <View style={styles.actionsRow}>
                        {primaryActionLabel ? (
                            <Pressable style={styles.primaryAction} onPress={onPrimaryAction}>
                                <Text style={styles.primaryActionText}>{primaryActionLabel}</Text>
                            </Pressable>
                        ) : null}
                        {secondaryActionLabel ? (
                            <Pressable style={styles.secondaryAction} onPress={onSecondaryAction}>
                                <Text style={styles.secondaryActionText}>{secondaryActionLabel}</Text>
                            </Pressable>
                        ) : null}
                    </View>
                ) : null}
            </View>
        </View>
    );
};

const styles = StyleSheet.create({
    card: {
        backgroundColor: '#FFFFFF',
        borderRadius: 24,
        marginBottom: 16,
        borderWidth: 1,
        borderColor: '#ECE6F8',
        shadowColor: 'rgba(64, 37, 122, 0.14)',
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 1,
        shadowRadius: 24,
        elevation: 5,
        overflow: 'hidden',
    },
    cardRich: {
        paddingBottom: 6,
    },
    imageWrap: {
        height: 184,
        backgroundColor: '#EEE8FA',
        position: 'relative',
    },
    image: {
        width: '100%',
        height: '100%',
    },
    ratingPill: {
        position: 'absolute',
        top: 14,
        right: 14,
        backgroundColor: '#FFFFFF',
        borderRadius: 999,
        paddingVertical: 8,
        paddingHorizontal: 14,
        shadowColor: 'rgba(27, 21, 48, 0.12)',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 1,
        shadowRadius: 18,
        elevation: 4,
    },
    ratingPillText: {
        fontSize: 18,
        fontWeight: '800',
        color: '#30294A',
    },
    content: {
        paddingHorizontal: 18,
        paddingTop: 16,
        paddingBottom: 16,
    },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        gap: 10,
        marginBottom: 8,
    },
    headerText: {
        flex: 1,
    },
    name: {
        fontSize: 18,
        fontWeight: '800',
        color: '#1B1530',
        lineHeight: 24,
    },
    subtitle: {
        fontSize: 15,
        color: '#7D7692',
        marginTop: 4,
        fontWeight: '600',
    },
    rating: {
        fontSize: 14,
        fontWeight: '700',
        color: '#563BFF',
    },
    helperText: {
        fontSize: 12,
        fontWeight: '800',
        color: '#5E35FF',
        marginBottom: 10,
        textTransform: 'uppercase',
        letterSpacing: 0.6,
    },
    badgeRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
        marginBottom: 12,
    },
    badge: {
        backgroundColor: '#F3EEFF',
        borderRadius: 999,
        paddingHorizontal: 12,
        paddingVertical: 7,
        borderWidth: 1,
        borderColor: '#E6DDFC',
    },
    badgeText: {
        fontSize: 12,
        fontWeight: '700',
        color: '#6B3FFF',
    },
    metaRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 12,
        marginBottom: 10,
    },
    metaText: {
        flex: 1,
        fontSize: 13,
        color: '#7D7692',
        fontWeight: '600',
    },
    distanceText: {
        fontSize: 14,
        color: '#563BFF',
        fontWeight: '700',
    },
    description: {
        fontSize: 15,
        color: '#615A76',
        lineHeight: 23,
        marginBottom: 8,
    },
    address: {
        fontSize: 14,
        color: '#8C86A0',
        lineHeight: 21,
    },
    actionsRow: {
        flexDirection: 'row',
        gap: 12,
        marginTop: 16,
    },
    primaryAction: {
        flex: 1,
        minHeight: 48,
        borderRadius: 18,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#6C3BFF',
    },
    primaryActionText: {
        color: '#FFFFFF',
        fontSize: 16,
        fontWeight: '800',
    },
    secondaryAction: {
        minWidth: 104,
        minHeight: 48,
        borderRadius: 18,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#F4F5F9',
    },
    secondaryActionText: {
        color: '#44506A',
        fontSize: 16,
        fontWeight: '700',
    },
    compactCard: {
        backgroundColor: '#FFFFFF',
        borderRadius: 24,
        borderWidth: 1,
        borderColor: '#ECE6F8',
        marginBottom: 16,
        padding: 12,
        flexDirection: 'row',
        alignItems: 'center',
        shadowColor: 'rgba(64, 37, 122, 0.12)',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 1,
        shadowRadius: 18,
        elevation: 4,
    },
    compactThumbWrap: {
        marginRight: 14,
    },
    compactThumb: {
        width: 92,
        height: 92,
        borderRadius: 20,
        backgroundColor: '#EBE6F6',
    },
    compactThumbFallback: {
        alignItems: 'center',
        justifyContent: 'center',
    },
    compactThumbFallbackText: {
        fontSize: 28,
        color: '#6C3BFF',
    },
    compactContent: {
        flex: 1,
        gap: 4,
    },
    compactName: {
        fontSize: 18,
        fontWeight: '800',
        color: '#1B1530',
    },
    compactSubtitle: {
        fontSize: 15,
        color: '#78718B',
        fontWeight: '600',
    },
    compactMetaRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        marginTop: 4,
    },
    compactRating: {
        fontSize: 16,
        color: '#27213F',
        fontWeight: '800',
    },
    compactMeta: {
        fontSize: 14,
        color: '#7D7692',
        fontWeight: '600',
    },
    compactTrailing: {
        fontSize: 22,
        color: '#5E43FF',
        marginLeft: 10,
    },
});

export default SuggestionCard;
