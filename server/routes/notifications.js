const express = require('express');
const User = require('../models/User');
const Notification = require('../models/Notification');
const { processPendingNotifications } = require('../services/notificationService');

const router = express.Router();

router.get('/settings/:user_id', async (req, res, next) => {
  try {
    const { user_id } = req.params;
    let user = await User.findById(user_id);
    if (!user) {
      user = await User.create({ _id: user_id });
    }
    const settings = user.notificationSettings || {};
    res.json({
      user_id,
      notifications_enabled: settings.notificationsEnabled ?? true,
      radius_km: settings.radiusKm || 2.0,
      quiet_hours_start: settings.quietHoursStart || null,
      quiet_hours_end: settings.quietHoursEnd || null,
      max_per_day: settings.maxPerDay || 3,
      updated_at: settings.updatedAt || new Date()
    });
  } catch (error) {
    next(error);
  }
});

router.put('/settings/:user_id', async (req, res, next) => {
  try {
    const { user_id } = req.params;
    const { notifications_enabled, radius_km, quiet_hours_start, quiet_hours_end, max_per_day } = req.body;
    
    let user = await User.findById(user_id);
    if (!user) {
      user = new User({ _id: user_id });
    }

    user.notificationSettings = {
      ...user.notificationSettings,
      notificationsEnabled: notifications_enabled,
      radiusKm: radius_km,
      quietHoursStart: quiet_hours_start,
      quietHoursEnd: quiet_hours_end,
      maxPerDay: max_per_day,
      updatedAt: new Date()
    };
    await user.save();

    res.json({
      user_id,
      notifications_enabled: user.notificationSettings.notificationsEnabled,
      radius_km: user.notificationSettings.radiusKm,
      quiet_hours_start: user.notificationSettings.quietHoursStart,
      quiet_hours_end: user.notificationSettings.quietHoursEnd,
      max_per_day: user.notificationSettings.maxPerDay,
      updated_at: user.notificationSettings.updatedAt
    });
  } catch (error) {
    next(error);
  }
});

router.post('/device-token', async (req, res, next) => {
  try {
    const { user_id, token } = req.body;
    if (!user_id || !token) {
      return res.status(400).json({ detail: "Invalid token or user_id" });
    }

    let user = await User.findById(user_id);
    if (!user) {
      user = new User({ _id: user_id });
    }

    const tokens = user.deviceTokens || [];
    if (!tokens.some(dt => dt.token === token)) {
      tokens.push({ token, createdAt: new Date() });
      user.deviceTokens = tokens;
      await user.save();
    }
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

const buildNotificationList = async (userId) => {
  const notifications = await Notification.find({ userId }).sort({ sentAt: -1 }).lean();
  return {
    notifications: notifications.map(item => ({
      id: item._id, // the React Native frontend might expect integer IDs if it used Postgres, but it probably handles strings. Mongoose IDs are strings.
      place_id: item.placeId,
      type: item.type,
      title: item.title,
      message: item.message,
      sent_at: item.sentAt,
      clicked: item.clicked
    }))
  };
};

router.get('', async (req, res, next) => {
  try {
    const { user_id } = req.query;
    if (!user_id) return res.status(422).json({ detail: "user_id is required" });
    const result = await buildNotificationList(user_id);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.get('/:user_id', async (req, res, next) => {
  try {
    const result = await buildNotificationList(req.params.user_id);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post('/process-queue', async (req, res, next) => {
  try {
    const limit = parseInt(req.query.limit || req.body.limit || 20);
    const result = await processPendingNotifications(limit);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
