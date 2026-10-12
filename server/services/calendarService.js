const axios = require('axios');
const config = require('../config/config');
const googleOauthService = require('./googleOauthService');

const raiseUpstreamError = (provider, detail, statusCode = 502) => {
  const error = new Error(`${provider} error: ${detail}`);
  error.statusCode = statusCode;
  throw error;
};

const listUpcomingEvents = async ({ sessionId, maxResults = 10, calendarId = 'primary' }) => {
  const session = await googleOauthService.getSession(sessionId);
  const headers = { Authorization: `Bearer ${session.accessToken}` };

  let response;
  try {
    response = await axios.get(`${config.calendarBaseUrl}/calendars/${calendarId}/events`, {
      headers,
      params: {
        maxResults,
        singleEvents: 'true',
        orderBy: 'startTime',
        timeMin: new Date().toISOString(),
      },
      timeout: config.requestTimeoutSeconds * 1000,
    });
  } catch (error) {
    if (error.code === 'ECONNABORTED') raiseUpstreamError('Google Calendar', 'event listing timed out.', 504);
    if (error.response) raiseUpstreamError('Google Calendar', `event listing HTTP ${error.response.status}`);
    raiseUpstreamError('Google Calendar', 'network error while listing events.');
  }

  const events = [];
  const items = response.data.items || [];
  
  for (const item of items) {
    events.push({
      id: item.id,
      status: item.status || null,
      summary: item.summary || null,
      description: item.description || null,
      location: item.location || null,
      htmlLink: item.htmlLink || null,
      start: item.start || {},
      end: item.end || {},
      organizer_email: (item.organizer && item.organizer.email) ? item.organizer.email : null,
    });
  }

  return { events };
};

module.exports = { listUpcomingEvents };
