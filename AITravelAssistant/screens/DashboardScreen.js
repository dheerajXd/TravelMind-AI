import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  ImageBackground,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import TopInfoBar from '../components/TopInfoBar';
import {
  fetchNearbyHeroPlace,
  fetchCalendarEvents,
  getGoogleSessionId,
  getOrCreateUserId,
} from '../services/backendService';
import { useLiveContext } from '../context/LiveContext';

// ---------- Helpers ----------

const WEATHER_EMOJI = {
  Clear: '☀️', 'Mostly Clear': '🌤️', 'Partly Cloudy': '⛅', Cloudy: '☁️',
  Fog: '🌫️', 'Rime Fog': '🌫️',
  'Light Drizzle': '🌦️', Drizzle: '🌧️', 'Heavy Drizzle': '🌧️',
  'Light Rain': '🌦️', Rain: '🌧️', 'Heavy Rain': '🌧️',
  'Rain Showers': '🌦️', 'Heavy Showers': '🌧️',
  'Light Snow': '🌨️', Snow: '❄️', 'Heavy Snow': '❄️',
  Thunderstorm: '⛈️',
};

const weatherEmoji = (condition) => WEATHER_EMOJI[condition] || '🌤️';

const fmtAMPM = (date) =>
  date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

// Image cache: location -> URL (prevents repeated fetches)
const imageCache = {};

/**
 * Given a sorted list of calendar events, detect free-time gaps (>= 30 min)
 * between them and after the last event (until midnight).
 */
const detectFreeTimeSlots = (events) => {
  const now = new Date();
  const endOfDay = new Date(now);
  endOfDay.setHours(23, 59, 59, 999);

  const slots = [];
  let cursor = now;

  for (const ev of events) {
    const evStart = new Date(ev.startTime);
    if (evStart > cursor) {
      const gapMs = evStart - cursor;
      if (gapMs >= 30 * 60 * 1000) {
        slots.push({
          time: `${fmtAMPM(cursor)} \u2013 ${fmtAMPM(evStart)}`,
          title: 'Free Time',
          subtitle: 'Explore nearby spots tailored to your preferences.',
          tone: 'highlight',
        });
      }
    }
    cursor = new Date(ev.endTime) > cursor ? new Date(ev.endTime) : cursor;
  }

  // free time after last event until end of day
  if (cursor < endOfDay) {
    const gapMs = endOfDay - cursor;
    if (gapMs >= 30 * 60 * 1000) {
      slots.push({
        time: `${fmtAMPM(cursor)} \u2013 ${fmtAMPM(endOfDay)}`,
        title: 'Free Time',
        subtitle: 'You have the rest of the evening free.',
        tone: 'highlight',
      });
    }
  }

  return slots;
};

/**
 * Convert raw backend calendar events into a unified timeline
 * sorted chronologically with free-time gaps.
 */
const buildTimeline = (rawEvents) => {
  const now = new Date();

  const parsed = rawEvents
    .map((ev) => {
      const startRaw = ev.start?.dateTime || ev.start?.date;
      const endRaw = ev.end?.dateTime || ev.end?.date;
      if (!startRaw) return null;
      return {
        id: ev.id,
        title: ev.summary || 'Untitled event',
        location: ev.location || null,
        startTime: startRaw,
        endTime: endRaw || startRaw,
      };
    })
    .filter(Boolean)
    .sort((a, b) => new Date(a.startTime) - new Date(b.startTime));

  const items = [];

  for (const ev of parsed) {
    const start = new Date(ev.startTime);
    const end = new Date(ev.endTime);
    const isPast = end < now;
    items.push({
      time: fmtAMPM(start),
      title: ev.title,
      subtitle: ev.location || `Ends at ${fmtAMPM(end)}`,
      tone: isPast ? 'done' : 'soft',
    });
  }

  const freeSlots = detectFreeTimeSlots(parsed);
  items.push(...freeSlots);

  // Sort final list by time string so free slots interleave properly
  // (a simple approach; works for same-day items)
  return items;
};

const DashboardScreen = ({ navigation, route }) => {
  const onboardingParams = route?.params ?? {};
  const tripPurpose = onboardingParams.tripPurpose || null;
  const userPreferences = onboardingParams.preferences || ['food'];
  const {
    currentTime,
    formattedTime,
    weather,
    temperatureLabel,
    locationLabel,
    shortLocation,
    latitude,
    longitude,
    coordsLabel,
  } = useLiveContext();

  const [heroPlace, setHeroPlace] = useState(null);
  const [calendarEvents, setCalendarEvents] = useState(null); // null = not loaded
  const [tripImageUrl, setTripImageUrl] = useState(null);
  const imageOpacity = useRef(new Animated.Value(0)).current;

  // Hero place + calendar on mount
  useEffect(() => {
    let active = true;

    const bootstrap = async () => {
      if (latitude == null || longitude == null) return;

      const place = await fetchNearbyHeroPlace(latitude, longitude).catch(() => null);

      if (!active) return;
      if (place) setHeroPlace(place);

      // Try to load calendar events if we have a Google session
      try {
        const sessionId = await getGoogleSessionId();
        if (sessionId) {
          const calData = await fetchCalendarEvents(sessionId);
          if (active && calData?.events) setCalendarEvents(calData.events);
        }
      } catch (_) {
        // Calendar not available — schedule will use context-aware fallback
      }
    };

    bootstrap();
    return () => { active = false; };
  }, [latitude, longitude]);

  const greeting = useMemo(() => {
    const hour = currentTime.getHours();
    if (hour < 12) return 'Good Morning';
    if (hour < 17) return 'Good Afternoon';
    return 'Good Evening';
  }, [currentTime]);

  const topStripTemperature = temperatureLabel;

  const heroTitle = heroPlace?.name || shortLocation;
  const heroSubtitle = heroPlace?.address || locationLabel;
  const heroImage = tripImageUrl || heroPlace?.photo_url || null;

  // Fetch dynamic trip image from Unsplash when location changes
  useEffect(() => {
    if (!shortLocation || shortLocation === 'Fetching location' || shortLocation === 'Your destination') return;

    // Check cache first
    if (imageCache[shortLocation]) {
      setTripImageUrl(imageCache[shortLocation]);
      return;
    }

    let active = true;
    const query = encodeURIComponent(`${shortLocation} city skyline travel`);
    const unsplashUrl = `https://source.unsplash.com/800x600/?${query}`;

    // Fetch the redirect URL to get the actual image
    fetch(unsplashUrl, { method: 'HEAD', redirect: 'follow' })
      .then((res) => {
        if (active && res.url) {
          imageCache[shortLocation] = res.url;
          setTripImageUrl(res.url);
          // Fade in the image smoothly
          Animated.timing(imageOpacity, {
            toValue: 1,
            duration: 600,
            useNativeDriver: true,
          }).start();
        }
      })
      .catch(() => {
        // Fallback — keep existing image or null
        if (active) {
          imageOpacity.setValue(1);
        }
      });

    return () => { active = false; };
  }, [shortLocation, imageOpacity]);

  const budget = onboardingParams.budget || 'medium';
  const vibe =
    onboardingParams.vibe ||
    (tripPurpose === 'business' ? 'productive' : 'calm');
  const activityPreference =
    onboardingParams.activityPreference ||
    userPreferences.find((item) => ['food', 'coffee', 'work spot', 'sightseeing'].includes(item)) ||
    'food';
  const cuisinePreference =
    onboardingParams.cuisinePreference ||
    userPreferences.find((item) =>
      ['South Indian', 'Cafe', 'Italian', 'Chinese', 'Street Food'].includes(item)
    ) ||
    'South Indian';
  const inferredTripType =
    tripPurpose ||
    (activityPreference === 'work spot' ? 'business' : 'leisure');

  const statusChips = [
    `${capitalize(vibe)} vibe`,
    `${capitalize(budget)} budget`,
    cuisinePreference,
  ];

  // Dynamic schedule: try real calendar events, fall back to context-aware items
  const scheduleItems = useMemo(() => {
    if (calendarEvents && calendarEvents.length > 0) {
      return buildTimeline(calendarEvents);
    }
    // Context-aware fallback schedule
    const now = new Date();
    const laterTime = new Date(now.getTime() + 2 * 60 * 60 * 1000);
    const eveningStart = new Date(now);
    eveningStart.setHours(17, 30, 0, 0);
    const eveningEnd = new Date(now);
    eveningEnd.setHours(20, 0, 0, 0);

    return [
      {
        time: formattedTime,
        title: `You\u2019re currently here`,
        subtitle: `${shortLocation} is active and ready for live suggestions.`,
        tone: 'done',
      },
      {
        time: fmtAMPM(laterTime),
        title: 'Explore nearby',
        subtitle: `Check out ${activityPreference} spots around ${shortLocation}.`,
        tone: 'soft',
      },
      {
        time: `${fmtAMPM(eveningStart)} \u2013 ${fmtAMPM(eveningEnd)}`,
        title: 'Free Time',
        subtitle: 'Explore nearby spots tailored to your preferences.',
        tone: 'highlight',
      },
    ];
  }, [calendarEvents, formattedTime, shortLocation, activityPreference]);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
      {/* Header */}
      <View style={styles.headerRow}>
        <View>
          <Text style={styles.greeting}>{greeting}</Text>
          <Text style={styles.subGreeting}>Your trip is going smoothly</Text>
        </View>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{(shortLocation || 'T').slice(0, 1).toUpperCase()}</Text>
        </View>
      </View>

      <TopInfoBar
        timeLabel={formattedTime}
        temperatureLabel={topStripTemperature}
        coordsLabel={coordsLabel}
        locationLabel={locationLabel}
      />

      {/* Hero Card */}
      <ImageBackground
        source={heroImage ? { uri: heroImage } : null}
        style={styles.heroCard}
        imageStyle={styles.heroImage}
      >
        <Animated.View style={[StyleSheet.absoluteFill, { opacity: imageOpacity }]} />
        <LinearGradient
          colors={['transparent', 'rgba(30, 15, 60, 0.75)', 'rgba(20, 10, 45, 0.92)']}
          locations={[0, 0.55, 1]}
          style={StyleSheet.absoluteFill}
        />
        <View style={styles.heroContent}>
          <View style={styles.heroHeadingRow}>
            <View style={styles.heroHeadingText}>
              <Text style={styles.heroTitle}>{heroTitle}</Text>
              <Text style={styles.heroDates}>{heroSubtitle}</Text>
            </View>
            <View style={styles.trackChip}>
              <Text style={styles.trackChipText}>On Track</Text>
            </View>
          </View>
          <View style={styles.heroMetaRow}>
            {statusChips.map((chip) => (
              <View key={chip} style={styles.heroMetaChip}>
                <Text style={styles.heroMetaChipText}>{chip}</Text>
              </View>
            ))}
          </View>
        </View>
      </ImageBackground>

      <View style={styles.quickChipRow}>
        <View style={styles.quickChip}>
          <Text style={styles.quickChipIcon}>📍</Text>
          <Text style={styles.quickChipText}>{shortLocation}</Text>
        </View>
        <View style={styles.quickChip}>
          <Text style={styles.quickChipIcon}>☕</Text>
          <Text style={styles.quickChipText}>{activityPreference}</Text>
        </View>
        <View style={styles.quickChip}>
          <Text style={styles.quickChipIcon}>💸</Text>
          <Text style={styles.quickChipText}>{capitalize(budget)}</Text>
        </View>
      </View>

      {/* Schedule */}
      <View style={styles.scheduleCard}>
        <Text style={styles.sectionTitle}>Today&apos;s Schedule</Text>
        {scheduleItems.map((item, index) => (
          <View key={`${item.time}-${item.title}`} style={styles.timelineRow}>
            <View style={styles.timelineRail}>
              <View
                style={[
                  styles.timelineDot,
                  item.tone === 'highlight' && styles.timelineDotHighlight,
                  item.tone === 'soft' && styles.timelineDotSoft,
                ]}
              />
              {index < scheduleItems.length - 1 ? <View style={styles.timelineLine} /> : null}
            </View>
            <View style={styles.timelineTextBlock}>
              <Text
                style={[
                  styles.timelineTime,
                  item.tone === 'highlight' && styles.timelineTimeHighlight,
                ]}
              >
                {item.time}
              </Text>
              <Text style={styles.timelineTitle}>{item.title}</Text>
              <Text style={styles.timelineSubtitle}>{item.subtitle}</Text>
            </View>
          </View>
        ))}
      </View>

      {/* Free Time Banner */}
      <Pressable
        style={styles.freeTimeBanner}
        onPress={async () => {
          const userId = await getOrCreateUserId();
          navigation.navigate('Recommendations', {
            userId,
            inferredTripType,
            activityPreference,
            cuisinePreference,
          });
        }}
      >
        <View style={styles.freeTimeIconWrap}>
          <Text style={styles.freeTimeIcon}>📍</Text>
        </View>
        <View style={styles.freeTimeTextWrap}>
          <Text style={styles.freeTimeTitle}>You have free time this evening</Text>
          <Text style={styles.freeTimeSubtitle}>Explore suggestions</Text>
        </View>
        <Text style={styles.freeTimeArrow}>›</Text>
      </Pressable>

      <View style={{ height: 30 }} />
    </ScrollView>
  );
};

const capitalize = (value) => {
  if (!value) return '';
  return value.charAt(0).toUpperCase() + value.slice(1);
};

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#F7F3FF',
  },
  container: {
    paddingHorizontal: 18,
    paddingTop: 22,
    paddingBottom: 36,
    maxWidth: 860,
    width: '100%',
    alignSelf: 'center',
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 18,
  },
  greeting: {
    fontSize: 26,
    fontWeight: '800',
    color: '#171329',
    letterSpacing: -0.7,
  },
  subGreeting: {
    marginTop: 6,
    fontSize: 15,
    color: '#6B6480',
  },
  avatar: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: '#7C3BFF',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#7C3BFF',
    shadowOpacity: 0.28,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
  },
  avatarText: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '800',
  },
  summaryStrip: {
    backgroundColor: '#FFFFFF',
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingVertical: 14,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 14,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#ECE5FA',
    shadowColor: '#9A83E5',
    shadowOpacity: 0.08,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
  },
  summaryItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  summaryItemGrow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexShrink: 1,
  },
  summaryIcon: {
    fontSize: 16,
  },
  summaryText: {
    fontSize: 15,
    color: '#4F4965',
    fontWeight: '700',
  },
  coordsText: {
    fontSize: 10,
    color: '#9A93AB',
    marginTop: 2,
  },
  heroCard: {
    minHeight: 210,
    borderRadius: 28,
    overflow: 'hidden',
    marginBottom: 16,
    backgroundColor: '#6D46B9',
    justifyContent: 'space-between',
  },
  heroImage: {
    borderRadius: 28,
  },
  heroOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(73, 38, 125, 0.46)',
  },
  heroContent: {
    flex: 1,
    padding: 20,
    justifyContent: 'space-between',
  },
  heroHeadingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
  },
  heroHeadingText: {
    flex: 1,
  },
  heroTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#FFFFFF',
    marginBottom: 8,
  },
  heroDates: {
    fontSize: 15,
    color: 'rgba(255,255,255,0.92)',
    lineHeight: 22,
    maxWidth: '92%',
  },
  trackChip: {
    backgroundColor: 'rgba(255,255,255,0.22)',
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.28)',
  },
  trackChipText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 15,
  },
  heroMetaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 16,
  },
  heroMetaChip: {
    backgroundColor: 'rgba(255,255,255,0.14)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
  },
  heroMetaChipText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  quickChipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 18,
  },
  quickChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#ECE5FA',
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 14,
    shadowColor: '#9A83E5',
    shadowOpacity: 0.08,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
  },
  quickChipIcon: {
    fontSize: 16,
  },
  quickChipText: {
    fontSize: 16,
    color: '#27213F',
    fontWeight: '700',
  },
  scheduleCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 28,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 12,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#ECE5FA',
    shadowColor: '#9A83E5',
    shadowOpacity: 0.08,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#1D1733',
    marginBottom: 18,
  },
  timelineRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 14,
    paddingBottom: 18,
  },
  timelineRail: {
    width: 34,
    alignItems: 'center',
  },
  timelineDot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#D9F6E9',
    borderWidth: 4,
    borderColor: '#EBFBF3',
    marginTop: 4,
  },
  timelineDotSoft: {
    backgroundColor: '#EAE7F7',
    borderColor: '#F4F1FB',
  },
  timelineDotHighlight: {
    backgroundColor: '#5E49FF',
    borderColor: '#E2E0FF',
  },
  timelineLine: {
    width: 2,
    flex: 1,
    backgroundColor: '#ECE8F7',
    marginTop: 8,
  },
  timelineTextBlock: {
    flex: 1,
    paddingBottom: 4,
  },
  timelineTime: {
    fontSize: 15,
    color: '#A29CB6',
    fontWeight: '600',
    marginBottom: 4,
  },
  timelineTimeHighlight: {
    color: '#5649FF',
  },
  timelineTitle: {
    fontSize: 18,
    color: '#241D3A',
    fontWeight: '800',
    marginBottom: 6,
  },
  timelineSubtitle: {
    fontSize: 15,
    color: '#837C99',
    lineHeight: 22,
  },
  freeTimeBanner: {
    backgroundColor: '#6C46FF',
    borderRadius: 28,
    paddingHorizontal: 18,
    paddingVertical: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    shadowColor: '#7C54FF',
    shadowOpacity: 0.28,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 14 },
  },
  freeTimeIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.16)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  freeTimeIcon: {
    fontSize: 20,
  },
  freeTimeTextWrap: {
    flex: 1,
  },
  freeTimeTitle: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '800',
    marginBottom: 4,
  },
  freeTimeSubtitle: {
    color: 'rgba(255,255,255,0.86)',
    fontSize: 16,
    fontWeight: '600',
  },
  freeTimeArrow: {
    color: '#FFFFFF',
    fontSize: 36,
    lineHeight: 36,
    marginTop: -2,
  },
});

export default DashboardScreen;
