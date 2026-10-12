const express = require('express');
const { listMessages } = require('../services/gmailService');

const router = express.Router();

router.get('/messages', async (req, res, next) => {
  try {
    const { session_id, max_results = 10, query, unread_only = 'false' } = req.query;

    if (!session_id || session_id.length < 10) {
      return res.status(422).json({ detail: "session_id is required" });
    }

    const unreadOnlyBool = unread_only === 'true';
    const maxResultsInt = parseInt(max_results);

    const messages = await listMessages({
      sessionId: session_id,
      maxResults: maxResultsInt,
      query: query || null,
      unreadOnly: unreadOnlyBool
    });

    res.json(messages);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
