const express = require('express');
const geminiService = require('../services/geminiService');

const router = express.Router();

router.post('/recommendations', async (req, res, next) => {
  try {
    const response = await geminiService.generateRecommendations(req.body);
    res.json(response);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
