const express = require('express');
const { getWeather } = require('../services/weatherService');

const router = express.Router();

router.get('/weather', async (req, res, next) => {
  try {
    const { location, lat, lng } = req.query;
    const hasCoordinates = lat !== undefined && lng !== undefined;
    
    if (!location && !hasCoordinates) {
      return res.status(422).json({ detail: "Provide either location or both lat and lng." });
    }

    const query = {
      location: location || null,
      lat: lat !== undefined ? parseFloat(lat) : null,
      lng: lng !== undefined ? parseFloat(lng) : null,
    };

    const weather = await getWeather(query);
    res.json(weather);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
