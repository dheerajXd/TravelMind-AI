const express = require('express');
const { triggerLocationUpdate, triggerManual } = require('../services/notificationService');

const router = express.Router();

router.post('/location-update', async (req, res, next) => {
  try {
    const { user_id, lat, lng } = req.body;
    if (!user_id || lat === undefined || lng === undefined) {
      return res.status(422).json({ detail: "user_id, lat, and lng are required" });
    }
    const result = await triggerLocationUpdate(user_id, parseFloat(lat), parseFloat(lng));
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post('/manual', async (req, res, next) => {
  try {
    const { user_id } = req.body;
    if (!user_id) {
      return res.status(422).json({ detail: "user_id is required" });
    }
    const result = await triggerManual(user_id);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
