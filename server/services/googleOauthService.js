const crypto = require('crypto');
const axios = require('axios');
const config = require('../config/config');
const OAuthSession = require('../models/OAuthSession');

const SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/calendar.readonly",
];

const ensureConfigured = () => {
  if (!config.googleOauthClientId || !config.googleOauthClientSecret || !config.googleOauthRedirectUri) {
    const error = new Error("Google OAuth client configuration is missing.");
    error.statusCode = 500;
    throw error;
  }
};

const raiseUpstreamError = (provider, detail, statusCode = 502) => {
  const error = new Error(`${provider} error: ${detail}`);
  error.statusCode = statusCode;
  throw error;
};

const buildAuthorizationUrl = () => {
  ensureConfigured();
  const state = crypto.randomBytes(24).toString('base64url');
  
  const params = new URLSearchParams({
    client_id: config.googleOauthClientId,
    redirect_uri: config.googleOauthRedirectUri,
    response_type: 'code',
    scope: SCOPES.join(' '),
    access_type: 'offline',
    include_granted_scopes: 'true',
    prompt: 'select_account consent',
    state: state,
  });

  return { authorizationUrl: `${config.googleOauthAuthorizeUrl}?${params.toString()}`, state };
};

const fetchUserProfile = async (accessToken) => {
  try {
    const response = await axios.get(config.googleUserinfoUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
      timeout: config.requestTimeoutSeconds * 1000,
    });
    
    const payload = response.data;
    const allowedFields = ['sub', 'email', 'email_verified', 'name', 'given_name', 'family_name', 'picture', 'locale'];
    const normalizedPayload = {};
    for (const field of allowedFields) {
      if (payload[field] !== undefined) {
        normalizedPayload[field] = payload[field];
      }
    }
    return normalizedPayload;
  } catch (error) {
    if (error.code === 'ECONNABORTED') raiseUpstreamError("Google OAuth", "userinfo request timed out.", 504);
    if (error.response) raiseUpstreamError("Google OAuth", `userinfo HTTP ${error.response.status}`);
    raiseUpstreamError("Google OAuth", "network error while fetching user profile.");
  }
};

const exchangeCodeForSession = async (code, state) => {
  ensureConfigured();
  let tokenResponse;
  try {
    const params = new URLSearchParams({
      code,
      client_id: config.googleOauthClientId,
      client_secret: config.googleOauthClientSecret,
      redirect_uri: config.googleOauthRedirectUri,
      grant_type: 'authorization_code',
    });

    tokenResponse = await axios.post(config.googleOauthTokenUrl, params.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: config.requestTimeoutSeconds * 1000,
    });
  } catch (error) {
    if (error.code === 'ECONNABORTED') raiseUpstreamError("Google OAuth", "token exchange timed out.", 504);
    if (error.response) {
      const payload = error.response.data || {};
      let detail = `token exchange HTTP ${error.response.status}`;
      if (payload.error || payload.error_description) {
        detail += `: ${payload.error || 'error'}`;
        if (payload.error_description) detail += ` (${payload.error_description})`;
      }
      raiseUpstreamError("Google OAuth", detail, 502);
    }
    raiseUpstreamError("Google OAuth", "network error during token exchange.");
  }

  const tokenPayload = tokenResponse.data;
  const user = await fetchUserProfile(tokenPayload.access_token);
  
  const sessionId = crypto.randomBytes(24).toString('base64url');
  const expiresIn = tokenPayload.expires_in || 3600;
  const expiresAt = new Date(Date.now() + expiresIn * 1000);

  const session = new OAuthSession({
    sessionId,
    user,
    accessToken: tokenPayload.access_token,
    refreshToken: tokenPayload.refresh_token,
    expiresAt,
    scope: tokenPayload.scope || '',
    tokenType: tokenPayload.token_type || 'Bearer',
  });
  
  await session.save();

  return {
    sessionId,
    user,
    grantedScopes: (tokenPayload.scope || '').split(' '),
    expiresAt,
  };
};

const refreshAccessToken = async (refreshToken) => {
  try {
    const params = new URLSearchParams({
      client_id: config.googleOauthClientId,
      client_secret: config.googleOauthClientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    });

    const response = await axios.post(config.googleOauthTokenUrl, params.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: config.requestTimeoutSeconds * 1000,
    });
    return response.data;
  } catch (error) {
    if (error.code === 'ECONNABORTED') raiseUpstreamError("Google OAuth", "token refresh timed out.", 504);
    if (error.response) raiseUpstreamError("Google OAuth", `token refresh HTTP ${error.response.status}`);
    raiseUpstreamError("Google OAuth", "network error during token refresh.");
  }
};

const getSession = async (sessionId) => {
  const session = await OAuthSession.findOne({ sessionId });
  if (!session) {
    const error = new Error("Invalid or expired session.");
    error.statusCode = 401;
    throw error;
  }

  // Check expiration, refresh if < 30 seconds
  if (session.expiresAt.getTime() <= Date.now() + 30000) {
    if (!session.refreshToken) {
      const error = new Error("Google session expired and cannot be refreshed.");
      error.statusCode = 401;
      throw error;
    }
    const refreshed = await refreshAccessToken(session.refreshToken);
    session.accessToken = refreshed.access_token;
    session.expiresAt = new Date(Date.now() + (refreshed.expires_in || 3600) * 1000);
    if (refreshed.scope) session.scope = refreshed.scope;
    if (refreshed.token_type) session.tokenType = refreshed.token_type;
    await session.save();
  }
  return session;
};

const getUserProfileFromSession = async (sessionId) => {
  const session = await getSession(sessionId);
  return session.user;
};

module.exports = {
  buildAuthorizationUrl,
  exchangeCodeForSession,
  getSession,
  getUserProfileFromSession,
};
