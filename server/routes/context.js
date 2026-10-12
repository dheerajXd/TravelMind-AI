const express = require('express');
const { saveContext, getContext } = require('../services/contextService');

const router = express.Router();

router.post('/', async (req, res, next) => {
  try {
    const payload = req.body; // Normally we'd validate with Zod here
    const stored = await saveContext(payload);
    res.status(201).json({
      message: 'Context stored successfully.',
      context: stored,
    });
  } catch (error) {
    next(error);
  }
});

router.get('/:user_id', async (req, res, next) => {
  try {
    const userId = req.params.user_id;
    const stored = await getContext(userId);
    if (!stored) {
      return res.status(404).json({ detail: 'Context not found for user.' });
    }
    res.status(200).json(stored);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
