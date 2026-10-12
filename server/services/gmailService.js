const axios = require('axios');
const config = require('../config/config');
const googleOauthService = require('./googleOauthService');

const raiseUpstreamError = (provider, detail, statusCode = 502) => {
  const error = new Error(`${provider} error: ${detail}`);
  error.statusCode = statusCode;
  throw error;
};

const getMessage = async (messageId, headers) => {
  try {
    const response = await axios.get(`${config.gmailBaseUrl}/users/me/messages/${messageId}`, {
      headers,
      params: { format: 'metadata', metadataHeaders: ['Subject', 'From'] },
      timeout: config.requestTimeoutSeconds * 1000,
    });
    const payload = response.data;
    const headersMap = {};
    if (payload.payload && payload.payload.headers) {
      payload.payload.headers.forEach(header => {
        headersMap[header.name.toLowerCase()] = header.value;
      });
    }

    let internalDate = null;
    if (payload.internalDate) {
      internalDate = new Date(parseInt(payload.internalDate));
    }

    return {
      id: payload.id,
      thread_id: payload.threadId,
      subject: headersMap['subject'] || null,
      from_email: headersMap['from'] || null,
      snippet: payload.snippet || null,
      internal_date: internalDate,
    };
  } catch (error) {
    if (error.code === 'ECONNABORTED') raiseUpstreamError('Gmail', 'message detail timed out.', 504);
    if (error.response) raiseUpstreamError('Gmail', `message detail HTTP ${error.response.status}`);
    raiseUpstreamError('Gmail', 'network error while fetching message detail.');
  }
};

const listMessages = async ({ sessionId, maxResults = 10, query = null, unreadOnly = false }) => {
  const session = await googleOauthService.getSession(sessionId);
  let q = query || '';
  if (unreadOnly) {
    q = `${q} is:unread`.trim();
  }

  const headers = { Authorization: `Bearer ${session.accessToken}` };
  const params = { maxResults };
  if (q) params.q = q;

  let listResponse;
  try {
    listResponse = await axios.get(`${config.gmailBaseUrl}/users/me/messages`, {
      headers,
      params,
      timeout: config.requestTimeoutSeconds * 1000,
    });
  } catch (error) {
    if (error.code === 'ECONNABORTED') raiseUpstreamError('Gmail', 'message listing timed out.', 504);
    if (error.response) raiseUpstreamError('Gmail', `message listing HTTP ${error.response.status}`);
    raiseUpstreamError('Gmail', 'network error while listing messages.');
  }

  const data = listResponse.data;
  const messages = [];
  
  if (data.messages && data.messages.length > 0) {
    for (const item of data.messages) {
      const details = await getMessage(item.id, headers);
      messages.push(details);
    }
  }

  return {
    messages,
    result_size_estimate: data.resultSizeEstimate || null,
  };
};

module.exports = { listMessages };
