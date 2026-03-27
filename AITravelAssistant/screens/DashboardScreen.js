import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    Animated,
    Alert,
  ImageBackground,
  Linking,
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
  fetchGmailMessages,
  getGoogleSessionId,
  getOrCreateUserId,
  getPlannedItems,
  togglePlannedItem,
} from '../services/backendService';
import { fetchOpenClawUserBrief, fetchOpenClawUserPreview } from '../services/openclawService';
import { fetchNearbyPlaces } from '../services/placesService';
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

const normalizeCalendarDate = (rawValue, fallbackTime = '00:00:00') => {
  if (!rawValue) return null;
  if (rawValue.includes('T')) {
    return new Date(rawValue);
  }
  return new Date(`${rawValue}T${fallbackTime}`);
};

const isNoisyAllDayEvent = (title = '') =>
  /birthday|anniversary|holiday/i.test(title);

const mapActivityToNearbyKeyword = (activityPreference, cuisinePreference) => {
  const cuisine = (cuisinePreference || '').toLowerCase();
  if (activityPreference === 'coffee' || cuisine === 'cafe') return 'cafe';
  if (activityPreference === 'sightseeing') return 'tourist attraction';
  if (activityPreference === 'work spot') return 'coworking';
  if (cuisine === 'italian') return 'italian restaurant';
  if (cuisine === 'chinese') return 'chinese restaurant';
  if (cuisine === 'street food') return 'street food';
  return 'restaurant';
};

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
    const evEnd = new Date(ev.endTime);

    if (evEnd <= cursor) {
      continue;
    }

    if (evStart > cursor) {
      const gapMs = evStart - cursor;
      if (gapMs >= 30 * 60 * 1000) {
        slots.push({
          id: `free-${cursor.toISOString()}-${evStart.toISOString()}`,
          sortTime: cursor.getTime(),
          time: `${fmtAMPM(cursor)} \u2013 ${fmtAMPM(evStart)}`,
          title: 'Free Time',
          subtitle: 'Explore nearby spots tailored to your preferences.',
          tone: 'highlight',
        });
      }
    }
    cursor = evEnd > cursor ? evEnd : cursor;
  }

  // free time after last event until end of day
  if (cursor < endOfDay) {
    const gapMs = endOfDay - cursor;
    if (gapMs >= 30 * 60 * 1000) {
      slots.push({
        id: `free-${cursor.toISOString()}-${endOfDay.toISOString()}`,
        sortTime: cursor.getTime(),
        time: `${fmtAMPM(cursor)} \u2013 ${fmtAMPM(endOfDay)}`,
        title: 'Free Time',
        subtitle: 'You have the rest of the evening free.',
        tone: 'highlight',
      });
    }
  }

  return slots;
};

const buildPlannedSummary = (plannedItems) => {
  if (!plannedItems?.length) {
    return null;
  }

  if (plannedItems.length === 1) {
    return `Planned stop: ${plannedItems[0].name}`;
  }

  return `Planned stop: ${plannedItems[0].name} +${plannedItems.length - 1} more`;
};

/**
 * Convert raw backend calendar events into a unified timeline
 * sorted chronologically with free-time gaps.
 */
const buildTimeline = (rawEvents) => {
  const now = new Date();

  const seen = new Set();
  const parsed = rawEvents
    .map((ev) => {
      const title = ev.summary || 'Untitled event';
      if (isNoisyAllDayEvent(title)) return null;

      const isAllDay = Boolean(ev.start?.date && !ev.start?.dateTime);
      const start = normalizeCalendarDate(
        ev.start?.dateTime || ev.start?.date,
        isAllDay ? '00:00:00' : '00:00:00'
      );
      const end = normalizeCalendarDate(
        ev.end?.dateTime || ev.end?.date || ev.start?.dateTime || ev.start?.date,
        isAllDay ? '23:59:00' : '00:00:00'
      );
      if (!start || !end) return null;
      const dedupeKey =
        ev.id ||
        `${title}|${start.toISOString()}|${end.toISOString()}|${ev.location || ''}`;
      if (seen.has(dedupeKey)) {
        return null;
      }
      seen.add(dedupeKey);

      return {
        id: dedupeKey,
        title,
        location: ev.location || null,
        startTime: start.toISOString(),
        endTime: end.toISOString(),
        sortTime: start.getTime(),
        isAllDay,
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
      id: ev.id,
      sortTime: ev.sortTime,
      time: ev.isAllDay ? 'All day' : fmtAMPM(start),
      title: ev.title,
      subtitle: ev.location || `Ends at ${fmtAMPM(end)}`,
      tone: isPast ? 'done' : 'soft',
    });
  }

  const futureTimedEvents = parsed.filter((ev) => !ev.isAllDay);
  const freeSlots = detectFreeTimeSlots(futureTimedEvents);
  items.push(...freeSlots);

  return items
    .sort((a, b) => (a.sortTime || 0) - (b.sortTime || 0))
    .map(({ sortTime, ...item }) => item);
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
  const [gmailMessages, setGmailMessages] = useState([]);
  const [tripImageUrl, setTripImageUrl] = useState(null);
  const [plannedItems, setPlannedItems] = useState([]);
  const [assistantPreviewLoading, setAssistantPreviewLoading] = useState(false);
  const [assistantBrief, setAssistantBrief] = useState(null);
  const [assistantMeta, setAssistantMeta] = useState(null);
  const [assistantCandidates, setAssistantCandidates] = useState([]);
  const [assistantCandidateIndex, setAssistantCandidateIndex] = useState(0);
  const imageOpacity = useRef(new Animated.Value(0)).current;
  const assistantAutoloadedRef = useRef(false);

  const bootstrapDashboard = useCallback(async () => {
    if (latitude == null || longitude == null) return;

    const place = await fetchNearbyHeroPlace(latitude, longitude).catch(() => null);
    if (place) {
      setHeroPlace(place);
    }

    try {
      const sessionId = await getGoogleSessionId();
      if (!sessionId) {
        setCalendarEvents(null);
        setGmailMessages([]);
        return;
      }

      const [calData, gmailData] = await Promise.all([
        fetchCalendarEvents(sessionId).catch(() => null),
        fetchGmailMessages(sessionId, 5).catch(() => null),
      ]);
      setCalendarEvents(calData?.events || null);
      setGmailMessages(gmailData?.messages || []);
    } catch (_) {
      setCalendarEvents(null);
      setGmailMessages([]);
    }
  }, [latitude, longitude]);

  // Hero place + Google data on mount / focus
  useEffect(() => {
    bootstrapDashboard();
    const unsubscribe = navigation.addListener('focus', bootstrapDashboard);
    return unsubscribe;
  }, [bootstrapDashboard, navigation]);

  useEffect(() => {
    const loadPlannedItems = async () => {
      try {
        const items = await getPlannedItems();
        setPlannedItems(items);
      } catch (error) {
        console.warn('Dashboard planned items load failed:', error);
      }
    };

    loadPlannedItems();
    const unsubscribe = navigation.addListener('focus', loadPlannedItems);
    return unsubscribe;
  }, [navigation]);

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

  const loadAssistantCandidates = useCallback(async () => {
    if (latitude == null || longitude == null) {
      return [];
    }

    try {
      const keyword = mapActivityToNearbyKeyword(activityPreference, cuisinePreference);
      const places = await fetchNearbyPlaces(latitude, longitude, keyword, 4000);
      const normalized = (places || []).slice(0, 5).map((place) => ({
        id: `candidate-${place.id}`,
        name: place.name,
        subtitle: 'Assistant nearby fit',
        description: place.vicinity || `Suggested near ${shortLocation}`,
        rating: typeof place.rating === 'number' ? `⭐ ${place.rating.toFixed(1)}` : null,
        distanceLabel: shortLocation,
        imageUrl: place.photoUrl || null,
        metaText: place.vicinity || null,
        mapQuery: `${place.name} ${place.vicinity || ''}`.trim(),
      }));
      setAssistantCandidates(normalized);
      setAssistantCandidateIndex((currentIndex) => {
        if (normalized.length === 0) return 0;
        return Math.min(currentIndex, normalized.length - 1);
      });
      return normalized;
    } catch (error) {
      console.warn('Assistant candidate load failed:', error);
      setAssistantCandidates([]);
      setAssistantCandidateIndex(0);
      return [];
    }
  }, [activityPreference, cuisinePreference, latitude, longitude, shortLocation]);

  useEffect(() => {
    loadAssistantCandidates();
  }, [loadAssistantCandidates]);

  const statusChips = [
    `${capitalize(vibe)} vibe`,
    `${capitalize(budget)} budget`,
    cuisinePreference,
  ];

  const plannedSummary = useMemo(() => buildPlannedSummary(plannedItems), [plannedItems]);

  // Dynamic schedule: try real calendar events, fall back to context-aware items
  const scheduleItems = useMemo(() => {
    if (calendarEvents && calendarEvents.length > 0) {
      const timeline = buildTimeline(calendarEvents);
      if (!plannedSummary) {
        return timeline;
      }
      return timeline.map((item) =>
        item.tone === 'highlight'
          ? {
              ...item,
              subtitle: `${item.subtitle} ${plannedSummary}`,
            }
          : item
      );
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
        subtitle: plannedSummary || 'Explore nearby spots tailored to your preferences.',
        tone: 'highlight',
      },
    ];
  }, [calendarEvents, formattedTime, shortLocation, activityPreference, plannedSummary]);

  const freeTimeBannerSubtitle = plannedSummary || 'Explore suggestions';
  const hasFreeTimeSlot = useMemo(
    () => scheduleItems.some((item) => item.title === 'Free Time'),
    [scheduleItems]
  );
  const plannedHeroItem = useMemo(() => {
    if (assistantCandidates.length > 0) {
      return assistantCandidates[assistantCandidateIndex] || assistantCandidates[0];
    }
    if (heroPlace) {
      return {
        id: `hero-${heroPlace.name}-${heroPlace.address || shortLocation}`,
        name: heroPlace.name,
        subtitle: 'Saved from dashboard assistant',
        description: heroPlace.address || `Suggested near ${shortLocation}`,
        rating: null,
        distanceLabel: shortLocation,
        imageUrl: heroImage,
        metaText: 'Dashboard suggestion',
        mapQuery: heroPlace.address || heroPlace.name,
      };
    }
    if (!shortLocation) return null;
    return {
      id: `fallback-${shortLocation}-${coordsLabel || 'current-location'}`,
      name: shortLocation,
      subtitle: 'Saved from dashboard assistant',
      description: `Current area around ${shortLocation}`,
      rating: null,
      distanceLabel: shortLocation,
      imageUrl: heroImage || null,
      metaText: coordsLabel || 'Current location',
      mapQuery: coordsLabel ? `${shortLocation} ${coordsLabel}` : shortLocation,
    };
  }, [assistantCandidateIndex, assistantCandidates, coordsLabel, heroImage, heroPlace, shortLocation]);
  const isHeroPlanned = useMemo(
    () => Boolean(plannedHeroItem && plannedItems.some((item) => item.id === plannedHeroItem.id)),
    [plannedHeroItem, plannedItems]
  );
  const displayedAssistantBrief = useMemo(() => {
    return (
      assistantBrief ||
      'Tap “Ask AI assistant” to generate a context-aware travel brief from your current plan, weather, and schedule.'
    );
  }, [assistantBrief]);

  const buildLocalAssistantBrief = (selectedPlace = plannedHeroItem, options = {}) => {
    const { refreshedAt = null, announceRefresh = false } = options;
    const placeName = selectedPlace?.name || shortLocation;
    const placeContext =
      selectedPlace?.description ||
      selectedPlace?.metaText ||
      `Suggested near ${shortLocation}`;
    const weatherContext = weather?.condition ? `${temperatureLabel} and ${weather.condition}` : temperatureLabel;
    const freeTimeContext = hasFreeTimeSlot
      ? 'You currently have a free-time window to use well.'
      : 'This looks like a good moment to prepare your next move.';
    const refreshContext =
      announceRefresh && refreshedAt
        ? ` Refreshed at ${refreshedAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} using your latest nearby context.`
        : '';
    const inboxContext = gmailMessages?.[0]?.subject
      ? ` Recent inbox update: ${gmailMessages[0].subject}.`
      : '';
    const isAreaFallback =
      selectedPlace?.id?.startsWith('fallback-') || placeName === shortLocation;

    if (isAreaFallback) {
      return `${freeTimeContext} I’m still narrowing down the best nearby match around ${shortLocation} for ${activityPreference}. Current conditions are ${weatherContext}, so this is a good moment to explore options close by.${inboxContext}${refreshContext}`;
    }

    return `${freeTimeContext} ${placeName} looks like a strong nearby fit for ${activityPreference}. Current conditions are ${weatherContext}. ${placeContext}.${inboxContext}${refreshContext}`;
  };

  const handleAssistantPreview = async ({ silent = false, selectedPlace = plannedHeroItem, announceRefresh = false } = {}) => {
    try {
      setAssistantPreviewLoading(true);
      const userId = await getOrCreateUserId();
      const sessionId = await getGoogleSessionId();
      let preview;

      try {
        preview = await fetchOpenClawUserBrief({
          userId,
          googleSessionId: sessionId,
        });
      } catch (briefError) {
        console.warn('OpenClaw brief call failed, falling back to preview:', briefError);
        preview = await fetchOpenClawUserPreview({
          userId,
          googleSessionId: sessionId,
        });
      }

      const previewText = preview.assistant_response || preview.note || 'Assistant preview is ready.';
      const refreshedAt = new Date();
      const briefText =
        preview.executed || !isGenericAssistantNote(previewText)
          ? previewText
          : buildLocalAssistantBrief(selectedPlace, { refreshedAt, announceRefresh });
      setAssistantBrief(briefText);
      setAssistantMeta({
        executed: Boolean(preview.executed),
        updatedAt: refreshedAt,
      });
      if (!silent) {
        Alert.alert(
          preview.executed ? 'AI Assistant Brief' : 'AI Brief Preview',
          briefText
        );
      }
      console.log('OpenClaw dashboard response:', preview);
    } catch (error) {
      console.warn('OpenClaw preview failed:', error);
      setAssistantBrief('Could not prepare the assistant brief right now. Try again in a moment.');
      setAssistantMeta({
        executed: false,
        updatedAt: new Date(),
      });
      if (!silent) {
        Alert.alert('AI Brief Preview', 'Could not prepare the assistant brief right now.');
      }
    } finally {
      setAssistantPreviewLoading(false);
    }
  };

  const handleAssistantRefresh = async () => {
    try {
      setAssistantPreviewLoading(true);
      const refreshedCandidates = await loadAssistantCandidates();
      const nextCandidates = refreshedCandidates.length > 0 ? refreshedCandidates : assistantCandidates;
      let nextIndex = assistantCandidateIndex;

      if (nextCandidates.length > 1) {
        nextIndex = (assistantCandidateIndex + 1) % nextCandidates.length;
        setAssistantCandidateIndex(nextIndex);
      }

      const nextPlace = nextCandidates[nextIndex] || plannedHeroItem;
      await handleAssistantPreview({
        silent: true,
        selectedPlace: nextPlace,
        announceRefresh: true,
      });
    } catch (error) {
      console.warn('Assistant refresh failed:', error);
      setAssistantBrief('Could not refresh the assistant brief right now. Please try again.');
      setAssistantMeta({
        executed: false,
        updatedAt: new Date(),
      });
    } finally {
      setAssistantPreviewLoading(false);
    }
  };

  useEffect(() => {
    if (!hasFreeTimeSlot) {
      return;
    }
    if (assistantAutoloadedRef.current || assistantPreviewLoading || assistantBrief) {
      return;
    }

    assistantAutoloadedRef.current = true;
    handleAssistantPreview({ silent: true });
  }, [hasFreeTimeSlot, assistantPreviewLoading, assistantBrief]);

  const handleAssistantAddToPlan = async () => {
    if (!plannedHeroItem) {
      Alert.alert('No place available', 'There is no nearby place ready to add yet.');
      return;
    }

    try {
      const result = await togglePlannedItem(plannedHeroItem);
      setPlannedItems(result.items);
      Alert.alert(
        result.saved ? 'Added to plan' : 'Removed from plan',
        result.saved
          ? `${plannedHeroItem.name} is now attached to your free-time plan.`
          : `${plannedHeroItem.name} was removed from your plan.`
      );
    } catch (error) {
      console.warn('Assistant add to plan failed:', error);
      Alert.alert('Plan update failed', 'Could not update your plan right now.');
    }
  };

  const handleAssistantOpenMap = async () => {
    const query =
      plannedHeroItem?.mapQuery ||
      plannedHeroItem?.name ||
      heroPlace?.address ||
      heroPlace?.name ||
      locationLabel;
    if (!query) {
      Alert.alert('Map unavailable', 'There is no location available to open right now.');
      return;
    }

    const url = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
    try {
      await Linking.openURL(url);
    } catch (error) {
      console.warn('Assistant map open failed:', error);
      Alert.alert('Map unavailable', 'Could not open the map right now.');
    }
  };

  const handleAssistantOpenSuggestions = async () => {
    const userId = await getOrCreateUserId();
    navigation.navigate('Recommendations', {
      userId,
      inferredTripType,
      activityPreference,
      cuisinePreference,
    });
  };

  const handleAssistantNextPlace = () => {
    if (assistantCandidates.length <= 1) {
      return;
    }
    setAssistantCandidateIndex((current) => (current + 1) % assistantCandidates.length);
  };

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
          colors={['rgba(109, 93, 246, 0.28)', 'rgba(109, 93, 246, 0.88)', 'rgba(124, 58, 237, 0.96)']}
          locations={[0, 0.45, 1]}
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
        <View style={styles.scheduleHeaderRow}>
          <Text style={styles.sectionTitle}>Today&apos;s Schedule</Text>
          <View style={styles.scheduleSyncRow}>
            {calendarEvents?.length ? (
              <View style={styles.scheduleSyncIconChip}>
                <Text style={styles.scheduleSyncIcon}>🗓️</Text>
              </View>
            ) : null}
            {gmailMessages?.length ? (
              <View style={styles.scheduleSyncIconChip}>
                <Text style={styles.scheduleSyncIcon}>✉️</Text>
              </View>
            ) : null}
          </View>
        </View>
        {scheduleItems.map((item, index) => (
          <View key={item.id || `${item.time}-${item.title}-${index}`} style={styles.timelineRow}>
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
          <Text style={styles.freeTimeSubtitle}>{freeTimeBannerSubtitle}</Text>
        </View>
        <Text style={styles.freeTimeArrow}>›</Text>
      </Pressable>

      <Pressable style={styles.assistantPreviewButton} onPress={() => handleAssistantPreview()}>
        <Text style={styles.assistantPreviewText}>
          {assistantPreviewLoading ? 'Preparing AI brief…' : 'Ask AI assistant'}
        </Text>
      </Pressable>

      <View style={styles.assistantCard}>
        <View style={styles.assistantHeaderRow}>
          <View style={styles.assistantTitleBlock}>
            <Text style={styles.assistantEyebrow}>AI ASSISTANT</Text>
            <Text style={styles.assistantTitle}>Travel brief</Text>
          </View>
          <View
            style={[
              styles.assistantStatusChip,
              assistantMeta?.executed
                ? styles.assistantStatusChipActive
                : styles.assistantStatusChipPreview,
            ]}
          >
            <Text
              style={[
                styles.assistantStatusText,
                assistantMeta?.executed
                  ? styles.assistantStatusTextActive
                  : styles.assistantStatusTextPreview,
              ]}
            >
              {assistantMeta?.executed ? 'Live' : 'Preview'}
            </Text>
          </View>
        </View>

        {plannedHeroItem ? (
          <View style={styles.assistantTargetCard}>
            <View style={styles.assistantTargetTextBlock}>
              <Text style={styles.assistantTargetLabel}>Suggested place</Text>
              <Text style={styles.assistantTargetName}>{plannedHeroItem.name}</Text>
              <Text style={styles.assistantTargetMeta}>
                {plannedHeroItem.description || heroPlace?.address || `Near ${shortLocation}`}
              </Text>
            </View>
            <View
              style={[
                styles.assistantTargetBadge,
                isHeroPlanned ? styles.assistantTargetBadgeSaved : styles.assistantTargetBadgeReady,
              ]}
            >
              <Text
                style={[
                  styles.assistantTargetBadgeText,
                  isHeroPlanned ? styles.assistantTargetBadgeTextSaved : styles.assistantTargetBadgeTextReady,
                ]}
              >
                {isHeroPlanned ? 'In plan' : 'Ready'}
              </Text>
            </View>
          </View>
        ) : null}

        <Text style={styles.assistantBody}>
          {displayedAssistantBrief}
        </Text>

        <View style={styles.assistantFooterRow}>
          <Text style={styles.assistantFooterText}>
            {assistantMeta?.updatedAt
              ? `Updated ${assistantMeta.updatedAt.toLocaleTimeString([], {
                  hour: 'numeric',
                  minute: '2-digit',
                })}`
              : 'No brief generated yet'}
          </Text>
          <Pressable style={styles.assistantInlineButton} onPress={handleAssistantRefresh}>
            <Text style={styles.assistantInlineButtonText}>
              {assistantPreviewLoading ? 'Refreshing…' : 'Refresh'}
            </Text>
          </Pressable>
        </View>

        {assistantCandidates.length > 1 ? (
          <Pressable style={styles.assistantSwapButton} onPress={handleAssistantNextPlace}>
            <Text style={styles.assistantSwapButtonText}>
              Try another nearby fit ({assistantCandidateIndex + 1}/{assistantCandidates.length})
            </Text>
          </Pressable>
        ) : null}

        <View style={styles.assistantActionsRow}>
          <Pressable
            disabled={!plannedHeroItem}
            style={[
              styles.assistantPrimaryAction,
              !plannedHeroItem && styles.assistantActionDisabled,
            ]}
            onPress={handleAssistantAddToPlan}
          >
            <Text style={styles.assistantPrimaryActionText}>
              {isHeroPlanned ? 'Added to Plan' : 'Add to Plan'}
            </Text>
          </Pressable>
          <Pressable
            style={styles.assistantSecondaryAction}
            onPress={handleAssistantOpenSuggestions}
          >
            <Text style={styles.assistantSecondaryActionText}>Suggestions</Text>
          </Pressable>
          <Pressable
            style={[
              styles.assistantSecondaryAction,
              !plannedHeroItem && styles.assistantActionDisabled,
            ]}
            disabled={!plannedHeroItem}
            onPress={handleAssistantOpenMap}
          >
            <Text style={styles.assistantSecondaryActionText}>Map</Text>
          </Pressable>
        </View>
      </View>

      <View style={{ height: 30 }} />
    </ScrollView>
  );
};

const capitalize = (value) => {
  if (!value) return '';
  return value.charAt(0).toUpperCase() + value.slice(1);
};

const isGenericAssistantNote = (text) => {
  if (!text) return true;
  const normalized = String(text).trim().toLowerCase();
  return (
    normalized.startsWith('travel context prepared for') ||
    normalized === 'assistant preview is ready.'
  );
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
  scheduleHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 18,
  },
  scheduleSyncRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  scheduleSyncIconChip: {
    minWidth: 38,
    height: 38,
    paddingHorizontal: 10,
    borderRadius: 19,
    backgroundColor: '#F4EEFF',
    borderWidth: 1,
    borderColor: '#E5D9FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  scheduleSyncIcon: {
    fontSize: 18,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#1D1733',
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
  assistantPreviewButton: {
    marginTop: 12,
    alignSelf: 'center',
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  assistantPreviewText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#6C46FF',
  },
  assistantCard: {
    marginTop: 8,
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    padding: 18,
    borderWidth: 1,
    borderColor: '#ECE5FA',
    shadowColor: '#9A83E5',
    shadowOpacity: 0.08,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
  },
  assistantHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 12,
  },
  assistantTitleBlock: {
    flex: 1,
  },
  assistantEyebrow: {
    fontSize: 12,
    fontWeight: '800',
    color: '#7B57F6',
    letterSpacing: 1.1,
    marginBottom: 4,
  },
  assistantTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#1D1733',
  },
  assistantStatusChip: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
  },
  assistantStatusChipActive: {
    backgroundColor: '#EEF8F3',
    borderColor: '#D5F0E0',
  },
  assistantStatusChipPreview: {
    backgroundColor: '#F4EEFF',
    borderColor: '#E4D7FF',
  },
  assistantStatusText: {
    fontSize: 12,
    fontWeight: '800',
  },
  assistantStatusTextActive: {
    color: '#228B5F',
  },
  assistantStatusTextPreview: {
    color: '#6B46C1',
  },
  assistantBody: {
    fontSize: 15,
    lineHeight: 24,
    color: '#5A5372',
    marginBottom: 14,
  },
  assistantTargetCard: {
    borderRadius: 18,
    padding: 14,
    backgroundColor: '#F8F5FF',
    borderWidth: 1,
    borderColor: '#ECE5FA',
    marginBottom: 14,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  assistantTargetTextBlock: {
    flex: 1,
  },
  assistantTargetLabel: {
    fontSize: 12,
    fontWeight: '800',
    color: '#7B57F6',
    letterSpacing: 0.8,
    marginBottom: 6,
    textTransform: 'uppercase',
  },
  assistantTargetName: {
    fontSize: 17,
    fontWeight: '800',
    color: '#1D1733',
    marginBottom: 6,
  },
  assistantTargetMeta: {
    fontSize: 13,
    lineHeight: 20,
    color: '#7E7894',
  },
  assistantTargetBadge: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
  },
  assistantTargetBadgeReady: {
    backgroundColor: '#F4EEFF',
    borderColor: '#E4D7FF',
  },
  assistantTargetBadgeSaved: {
    backgroundColor: '#EEF8F3',
    borderColor: '#D5F0E0',
  },
  assistantTargetBadgeText: {
    fontSize: 12,
    fontWeight: '800',
  },
  assistantTargetBadgeTextReady: {
    color: '#6B46C1',
  },
  assistantTargetBadgeTextSaved: {
    color: '#228B5F',
  },
  assistantFooterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  assistantFooterText: {
    flex: 1,
    fontSize: 13,
    color: '#8A82A5',
    fontWeight: '600',
  },
  assistantInlineButton: {
    backgroundColor: '#F4EEFF',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  assistantInlineButtonText: {
    color: '#5C31F4',
    fontSize: 14,
    fontWeight: '800',
  },
  assistantSwapButton: {
    marginTop: 12,
    marginBottom: 2,
    alignSelf: 'flex-start',
    backgroundColor: '#F8F5FF',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: '#ECE5FA',
  },
  assistantSwapButtonText: {
    color: '#6B46C1',
    fontSize: 13,
    fontWeight: '800',
  },
  assistantActionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 14,
  },
  assistantPrimaryAction: {
    flexGrow: 1,
    minWidth: 140,
    backgroundColor: '#6C46FF',
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  assistantPrimaryActionText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '800',
  },
  assistantSecondaryAction: {
    backgroundColor: '#F4EEFF',
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 96,
  },
  assistantSecondaryActionText: {
    color: '#5C31F4',
    fontSize: 14,
    fontWeight: '800',
  },
  assistantActionDisabled: {
    opacity: 0.55,
  },
});

export default DashboardScreen;
