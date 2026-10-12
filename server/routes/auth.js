const express = require('express');
const { URL } = require('url');
const OAuthState = require('../models/OAuthState');
const googleOauthService = require('../services/googleOauthService');
const config = require('../config/config');

const router = express.Router();

const resolveRedirectTarget = (redirectTo) => {
  const fallback = config.frontendWebUrl;
  if (!redirectTo) return fallback;

  try {
    const url = new URL(redirectTo);
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) {
      return fallback;
    }
    if (['127.0.0.1', 'localhost'].includes(url.hostname) && !url.port) {
      const fallbackUrl = new URL(fallback);
      url.host = fallbackUrl.host || url.host;
      url.pathname = url.pathname === '/' ? (fallbackUrl.pathname || '/') : url.pathname;
      return url.toString();
    }
    return redirectTo;
  } catch (error) {
    return fallback;
  }
};

const appendRedirectQuery = (baseUrl, params) => {
  const url = new URL(baseUrl);
  Object.keys(params).forEach(key => {
    url.searchParams.append(key, params[key]);
  });
  return url.toString();
};

router.get('/login', async (req, res, next) => {
  try {
    const redirectTo = req.query.redirect_to;
    const { authorizationUrl, state } = googleOauthService.buildAuthorizationUrl();
    const resolvedRedirectTo = resolveRedirectTarget(redirectTo);

    await OAuthState.create({
      state,
      payload: { redirect_to: resolvedRedirectTo },
    });

    res.cookie('google_oauth_state', state, { httpOnly: true, sameSite: 'lax', secure: false, maxAge: 1800000 });
    if (resolvedRedirectTo) {
      res.cookie('google_oauth_redirect_to', resolvedRedirectTo, { httpOnly: true, sameSite: 'lax', secure: false, maxAge: 1800000 });
    }

    res.redirect(307, authorizationUrl);
  } catch (error) {
    next(error);
  }
});

router.get('/callback', async (req, res, next) => {
  try {
    const { code, state } = req.query;
    if (!code || !state) {
      return res.status(400).json({ detail: "Missing code or state" });
    }

    const cookieState = req.cookies?.google_oauth_state || (req.headers.cookie && req.headers.cookie.includes(`google_oauth_state=${state}`) ? state : null);
    
    // Simplification for missing cookie parser, manually parsing cookies:
    const parseCookies = (cookieHeader) => {
      if (!cookieHeader) return {};
      return cookieHeader.split(';').reduce((acc, cookie) => {
        const [name, ...rest] = cookie.trim().split('=');
        acc[name] = rest.join('=');
        return acc;
      }, {});
    };
    
    const cookies = req.cookies || parseCookies(req.headers.cookie);
    if (!cookies.google_oauth_state || cookies.google_oauth_state !== state) {
      return res.status(400).json({ detail: "Invalid or expired OAuth state." });
    }

    const session = await googleOauthService.exchangeCodeForSession(code, state);
    
    const stateRecord = await OAuthState.findOneAndDelete({ state });
    const redirectTo = (stateRecord && stateRecord.payload && stateRecord.payload.redirect_to) || cookies.google_oauth_redirect_to;

    if (!redirectTo) {
      return res.status(200).json(session);
    }

    const redirectUrl = appendRedirectQuery(redirectTo, {
      google_session_id: session.sessionId,
      google_connected: '1',
    });

    res.clearCookie('google_oauth_state');
    res.clearCookie('google_oauth_redirect_to');
    res.redirect(303, redirectUrl);
  } catch (error) {
    next(error);
  }
});

router.get('/me', async (req, res, next) => {
  try {
    const sessionId = req.query.session_id;
    if (!sessionId || sessionId.length < 10) {
      return res.status(422).json({ detail: "session_id parameter is required and must be valid." });
    }
    const userProfile = await googleOauthService.getUserProfileFromSession(sessionId);
    res.status(200).json(userProfile);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
