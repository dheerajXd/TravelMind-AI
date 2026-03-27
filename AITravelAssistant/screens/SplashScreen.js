import React, { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

const SplashScreen = ({ navigation }) => {
  useEffect(() => {
    const timer = setTimeout(() => {
      navigation.replace('Onboarding');
    }, 1800);
    return () => clearTimeout(timer);
  }, [navigation]);

  return (
    <Pressable style={styles.screen} onPress={() => navigation.replace('Onboarding')}>
      <View style={styles.glowOne} />
      <View style={styles.glowTwo} />

      <View style={styles.logoShell}>
        <View style={styles.logoPoint} />
        <View style={styles.logoCore}>
          <Text style={styles.logoSpark}>✦</Text>
          <View style={styles.pinCutout} />
        </View>
      </View>

      <Text style={styles.brand}>
        <Text style={styles.brandPrimary}>TravelMind</Text>
        <Text style={styles.brandAccent}> AI</Text>
      </Text>
      <Text style={styles.tagline}>Smart travel, powered by context</Text>
      <Text style={styles.cta}>Tap anywhere to continue</Text>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#F6F2FF',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    overflow: 'hidden',
  },
  glowOne: {
    position: 'absolute',
    width: 280,
    height: 280,
    borderRadius: 140,
    backgroundColor: 'rgba(120, 76, 255, 0.14)',
    top: 120,
    left: -40,
  },
  glowTwo: {
    position: 'absolute',
    width: 260,
    height: 260,
    borderRadius: 130,
    backgroundColor: 'rgba(255, 52, 143, 0.08)',
    bottom: 140,
    right: -30,
  },
  logoShell: {
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 28,
  },
  logoPoint: {
    width: 28,
    height: 28,
    backgroundColor: '#7A35FF',
    transform: [{ rotate: '45deg' }],
    position: 'absolute',
    bottom: -6,
    borderBottomLeftRadius: 6,
  },
  logoCore: {
    width: 112,
    height: 112,
    borderRadius: 36,
    backgroundColor: '#7A35FF',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#7A35FF',
    shadowOpacity: 0.3,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: 12 },
    elevation: 8,
  },
  logoSpark: {
    fontSize: 40,
    color: '#FFFFFF',
    zIndex: 2,
    marginTop: -4,
  },
  pinCutout: {
    position: 'absolute',
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.16)',
    top: 20,
    right: 20,
  },
  brand: {
    fontSize: 44,
    fontWeight: '800',
    letterSpacing: -1.2,
    marginBottom: 12,
  },
  brandPrimary: {
    color: '#563BFF',
  },
  brandAccent: {
    color: '#E91E8F',
  },
  tagline: {
    fontSize: 22,
    color: '#596173',
    textAlign: 'center',
    marginBottom: 70,
  },
  cta: {
    position: 'absolute',
    bottom: 86,
    fontSize: 16,
    color: '#9AA2B1',
    fontWeight: '500',
  },
});

export default SplashScreen;
