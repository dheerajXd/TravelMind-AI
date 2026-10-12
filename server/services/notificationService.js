const User = require('../models/User');
const Place = require('../models/Place');
const Notification = require('../models/Notification');
const NotificationQueue = require('../models/NotificationQueue');
const config = require('../config/config');
const { searchPlaces } = require('./placesService');
const crypto = require('crypto');
const redis = require('redis');
let admin = require('firebase-admin');

// Resilient in-memory fallback store for notifications and rate tracking
const memoryCache = new Map();
const memoryExpiry = new Map();

const memoryStore = {
  async get(key) {
    const exp = memoryExpiry.get(key);
    if (exp && Date.now() > exp) {
      memoryCache.delete(key);
      memoryExpiry.delete(key);
      return null;
    }
    return memoryCache.has(key) ? memoryCache.get(key) : null;
  },
  async setEx(key, ttl, value) {
    memoryCache.set(key, String(value));
    memoryExpiry.set(key, Date.now() + ttl * 1000);
    return 'OK';
  },
  async incr(key) {
    let current = parseInt((await this.get(key)) || '0', 10);
    current += 1;
    memoryCache.set(key, String(current));
    return current;
  },
  async expire(key, ttl) {
    if (memoryCache.has(key)) {
      memoryExpiry.set(key, Date.now() + ttl * 1000);
      return 1;
    }
    return 0;
  }
};

let actualRedisClient = null;
let isRedisConnected = false;

if (config.redisUrl) {
  try {
    actualRedisClient = redis.createClient({ url: config.redisUrl });
    actualRedisClient.on('error', (err) => {
      if (isRedisConnected) {
        console.warn('Redis error, using in-memory fallback:', err.message);
      }
    });
    actualRedisClient.connect()
      .then(() => {
        isRedisConnected = true;
        console.log('Connected to Redis');
      })
      .catch((err) => {
        console.warn('Could not connect to Redis, fallback to in-memory store:', err.message);
      });
  } catch (err) {
    console.warn('Failed to initialize Redis client, fallback to in-memory store:', err.message);
  }
}

const redisClient = {
  async get(key) {
    if (isRedisConnected && actualRedisClient) {
      try { return await actualRedisClient.get(key); } catch (_) {}
    }
    return memoryStore.get(key);
  },
  async setEx(key, ttl, val) {
    if (isRedisConnected && actualRedisClient) {
      try { return await actualRedisClient.setEx(key, ttl, val); } catch (_) {}
    }
    return memoryStore.setEx(key, ttl, val);
  },
  async incr(key) {
    if (isRedisConnected && actualRedisClient) {
      try { return await actualRedisClient.incr(key); } catch (_) {}
    }
    return memoryStore.incr(key);
  },
  async expire(key, ttl) {
    if (isRedisConnected && actualRedisClient) {
      try { return await actualRedisClient.expire(key, ttl); } catch (_) {}
    }
    return memoryStore.expire(key, ttl);
  }
};

let messaging = null;
if (config.fcmServiceAccountPath) {
  try {
    const serviceAccount = require(config.fcmServiceAccountPath);
    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
      });
    }
    messaging = admin.messaging();
  } catch (err) {
    console.warn("FCM initialization failed:", err.message);
  }
}

const DEFAULT_RADIUS_KM = 2.0;
const MAX_DAILY_NOTIFICATIONS = 3;
const NOTIFICATION_TYPE = "proximity";

const haversineKm = (lat1, lng1, lat2, lng2) => {
  const R = 6371.0;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLng/2) * Math.sin(dLng/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
};

const triggerLocationUpdate = async (userId, lat, lng) => {
  const now = new Date();
  let user = await User.findById(userId);
  if (!user) {
    user = new User({ _id: userId });
  }

  const previousLat = user.session?.lastLocationLat;
  const previousLng = user.session?.lastLocationLng;
  const previousActive = user.session?.lastActive;

  let movedKm = null;
  if (previousLat && previousLng) {
    movedKm = haversineKm(previousLat, previousLng, lat, lng);
  }

  let activityState = "moving";
  if (previousLat && previousLng && previousActive) {
    const minutesSinceLast = (now - previousActive) / 60000;
    if (minutesSinceLast >= (config.idleMinutesThreshold || 5) && movedKm < 0.15) {
      activityState = "idle";
    }
  }

  let storedActive = now;
  if (movedKm !== null && movedKm < 0.15 && previousActive) {
    storedActive = previousActive;
  }

  user.session = {
    ...user.session,
    lastLocationLat: lat,
    lastLocationLng: lng,
    lastActive: storedActive,
    updatedAt: now
  };
  await user.save();

  if (activityState !== "idle") {
    return {
      user_id: userId,
      activity_state: activityState,
      triggered: false,
      queued: 0,
      reason: "User is not idle yet.",
      sources: { mode: "location-update" }
    };
  }

  const queued = await enqueueNotifications(user);
  return {
    user_id: userId,
    activity_state: activityState,
    triggered: true,
    queued,
    reason: "Notification engine evaluated nearby places.",
    sources: { mode: "location-update" }
  };
};

const triggerManual = async (userId) => {
  const user = await User.findById(userId);
  if (!user) return { user_id: userId, activity_state: "unknown", triggered: false, queued: 0, reason: "User not found", sources: {} };
  
  const queued = await enqueueNotifications(user, true);
  return {
    user_id: userId,
    activity_state: "manual",
    triggered: true,
    queued,
    reason: "Manual notification evaluation completed.",
    sources: { mode: "manual" }
  };
};

const isQuietHours = (startVal, endVal) => {
  if (!startVal || !endVal) return false;
  const now = new Date();
  const currentStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  
  if (startVal <= endVal) {
    return currentStr >= startVal && currentStr <= endVal;
  }
  return currentStr >= startVal || currentStr <= endVal;
};

const enqueueNotifications = async (user, force = false) => {
  const settings = user.notificationSettings || {};
  if (!settings.notificationsEnabled) return 0;
  if (!force && isQuietHours(settings.quietHoursStart, settings.quietHoursEnd)) return 0;

  const session = user.session || {};
  if (!session.lastLocationLat || !session.lastLocationLng) return 0;

  const lat = session.lastLocationLat;
  const lng = session.lastLocationLng;
  const radiusKm = settings.radiusKm || DEFAULT_RADIUS_KM;

  const profileScores = {};
  for (const p of user.profile || []) {
    profileScores[p.category] = p.score;
  }

  await syncPlaces(lat, lng, radiusKm, profileScores, session.currentIntent);

  const places = await Place.find({
    openNow: true,
    latitude: { $exists: true, $ne: null },
    longitude: { $exists: true, $ne: null }
  });

  const candidates = [];
  for (const place of places) {
    const distanceKm = haversineKm(lat, lng, place.latitude, place.longitude);
    if (distanceKm > radiusKm) continue;

    const profileScore = profileScores[place.type] || 0.25;
    if (profileScore < 0.25) continue;

    const distanceScore = Math.max(0.0, 1.0 - Math.min(distanceKm / Math.max(radiusKm, 0.1), 1.0));
    const ratingScore = (place.rating || 0.0) / 5.0;
    const score = (profileScore * 0.5) + (distanceScore * 0.3) + (ratingScore * 0.2);

    candidates.push({ id: place._id, score });
  }

  candidates.sort((a, b) => b.score - a.score);

  let queued = 0;
  for (const candidate of candidates) {
    if (candidate.score < (config.notificationScoreThreshold || 0.5)) continue;
    
    const notified = await redisClient.get(`notified:${user._id}:${candidate.id}`);
    if (notified) continue;

    const pending = await NotificationQueue.findOne({ userId: user._id, placeId: candidate.id, status: 'pending' });
    if (pending) continue;

    await NotificationQueue.create({
      userId: user._id,
      placeId: candidate.id,
      type: NOTIFICATION_TYPE,
      score: candidate.score
    });
    queued += 1;
  }
  return queued;
};

const keywordFromProfile = (val) => {
  const mapping = {
    "food": "restaurant", "south indian": "restaurant", "italian": "restaurant",
    "coffee": "cafe", "bakery": "cafe", "work spot": "coworking",
    "sightseeing": "attraction", "relax": "park", "shopping": "shopping mall"
  };
  return mapping[val] || val;
};

const syncPlaces = async (lat, lng, radiusKm, profileScores, currentIntent) => {
  let keywords = [];
  const sortedProfile = Object.entries(profileScores).sort((a, b) => b[1] - a[1]);
  for (const [cat, _] of sortedProfile) {
    const base = cat.split(":").pop().trim().toLowerCase();
    const mapped = keywordFromProfile(base);
    if (mapped && !keywords.includes(mapped)) keywords.push(mapped);
  }
  if (currentIntent) {
    const mapped = keywordFromProfile(currentIntent.trim().toLowerCase());
    if (mapped && !keywords.includes(mapped)) keywords.push(mapped);
  }
  for (const fallback of ["restaurant", "cafe", "park"]) {
    if (!keywords.includes(fallback)) keywords.push(fallback);
  }

  let allPlaces = [];
  for (const keyword of keywords.slice(0, 5)) {
    try {
      const places = await searchPlaces({ lat, lng, type: keyword, radius: parseInt(radiusKm * 1000) });
      allPlaces.push(...places);
    } catch (e) {
      console.warn("Notification place sync failed for keyword", keyword);
    }
  }

  const deduped = {};
  for (const place of allPlaces) {
    const id = place.id || `derived_${crypto.createHash('sha1').update(`${place.name}|${place.address}|${place.lat}|${place.lng}`).digest('hex').slice(0, 24)}`;
    if (!deduped[id]) deduped[id] = place;
  }

  const now = new Date();
  for (const [id, p] of Object.entries(deduped)) {
    const primaryType = p.types[0] || 'generic';
    await Place.findByIdAndUpdate(id, {
      name: p.name,
      type: primaryType,
      latitude: p.lat,
      longitude: p.lng,
      rating: p.rating,
      openNow: p.open_now,
      updatedAt: now
    }, { upsert: true });
  }
};

const processPendingNotifications = async (limit = 20) => {
  let sent = 0, failed = 0, skipped = 0;
  
  const pendingQueue = await NotificationQueue.find({ status: 'pending' }).sort({ createdAt: 1 }).limit(limit);
  
  for (const item of pendingQueue) {
    const user = await User.findById(item.userId);
    if (!user || !user.notificationSettings?.notificationsEnabled) {
      item.status = 'failed';
      await item.save();
      failed++;
      continue;
    }
    
    const settings = user.notificationSettings;
    if (isQuietHours(settings.quietHoursStart, settings.quietHoursEnd)) {
      skipped++;
      continue;
    }

    const todayCountStr = await redisClient.get(`notify_count:${user._id}`);
    const todayCount = todayCountStr ? parseInt(todayCountStr) : 0;
    if (todayCount >= (settings.maxPerDay || MAX_DAILY_NOTIFICATIONS)) {
      skipped++;
      continue;
    }

    const place = await Place.findById(item.placeId);
    if (!place) {
      item.status = 'failed';
      await item.save();
      failed++;
      continue;
    }

    const distanceText = (place.latitude && place.longitude) ? 'a short walk away' : 'nearby';
    const body = place.rating 
      ? `${place.name} is highly rated and ${distanceText}.`
      : `${place.name} looks like a strong nearby fit right now.`;
    const payload = { title: "Nearby place for you", body, data: { place_id: place._id, action: "open_place" } };

    let success = false;
    if (messaging && user.deviceTokens && user.deviceTokens.length > 0) {
      const tokens = user.deviceTokens.map(dt => dt.token);
      for (const token of tokens) {
        try {
          await messaging.send({ token, notification: { title: payload.title, body: payload.body }, data: payload.data });
          success = true;
        } catch (e) {
          console.warn("FCM send failed", e);
        }
      }
    }

    if (success) {
      await Notification.create({
        userId: user._id,
        placeId: place._id,
        type: item.type,
        title: payload.title,
        message: payload.body
      });
      item.status = 'sent';
      await item.save();
      await redisClient.setEx(`notified:${user._id}:${place._id}`, 86400, "1");
      await redisClient.setEx(`notify_count:${user._id}`, 86400, (todayCount + 1).toString());
      sent++;
    } else {
      const retryKey = `notify_retry:${item._id}`;
      const attemptCount = await redisClient.incr(retryKey);
      await redisClient.expire(retryKey, 86400);
      if (attemptCount >= 3) {
        item.status = 'failed';
        failed++;
      } else {
        skipped++;
      }
      await item.save();
    }
  }

  return { sent, failed, skipped };
};

module.exports = { triggerLocationUpdate, triggerManual, processPendingNotifications };
