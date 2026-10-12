const express = require('express');
const { searchPlaces, reverseGeocode, getPhotoBytes } = require('../services/placesService');

const router = express.Router();

router.get('/search', async (req, res, next) => {
  try {
    const { location, lat, lng, type, radius = 2500 } = req.query;
    if (!type || type.length < 2) {
      return res.status(422).json({ detail: "type is required and must be valid" });
    }
    const hasCoordinates = lat !== undefined && lng !== undefined;
    if (!location && !hasCoordinates) {
      return res.status(422).json({ detail: "Provide either location or both lat and lng." });
    }
    
    const query = {
      location: location || null,
      lat: lat !== undefined ? parseFloat(lat) : null,
      lng: lng !== undefined ? parseFloat(lng) : null,
      type,
      radius: parseInt(radius),
    };

    const places = await searchPlaces(query);
    res.json({ places });
  } catch (error) {
    next(error);
  }
});

router.get('/reverse-geocode', async (req, res, next) => {
  try {
    const { lat, lng } = req.query;
    if (lat === undefined || lng === undefined) {
      return res.status(422).json({ detail: "lat and lng are required" });
    }

    const query = {
      lat: parseFloat(lat),
      lng: parseFloat(lng),
    };

    const result = await reverseGeocode(query);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.get('/photo', async (req, res, next) => {
  try {
    const { photo_reference, max_width = 400 } = req.query;
    if (!photo_reference || photo_reference.length < 8) {
      return res.status(422).json({ detail: "photo_reference is required" });
    }

    const { content, contentType } = await getPhotoBytes(photo_reference, parseInt(max_width));
    res.setHeader('Content-Type', contentType);
    res.send(content);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
