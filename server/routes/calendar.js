const express = require('express');
const { listUpcomingEvents } = require('../services/calendarService');

const router = express.Router();

router.get('/events', async (req, res, next) => {
  try {
    const { session_id, max_results = 10, calendar_id = 'primary' } = req.query;

    if (!session_id || session_id.length < 10) {
      return res.status(422).json({ detail: "session_id is required" });
    }

    const maxResultsInt = parseInt(max_results);

    const events = await listUpcomingEvents({
      sessionId: session_id,
      maxResults: maxResultsInt,
      calendarId: calendar_id
    });

    res.json(events);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
