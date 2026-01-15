/**
 * OIDC Authentication Routes (openid-client v6.x)
 */
const express = require('express');
const { randomState, randomNonce } = require('openid-client');
const oidcClient = require('./oidc-client');
const sessionStore = require('./session-store');

const router = express.Router();

// Temporary state storage (in-memory, cleaned up after 10 min)
const pendingAuth = new Map();

function setup(config) {
  const authConfig = config.auth;

  // GET /auth/login - Initiate OIDC flow
  router.get('/login', (req, res) => {
    const oidcConfig = oidcClient.getConfig();
    if (!oidcConfig) {
      return res.status(503).json({ error: 'OIDC not configured' });
    }

    const state = randomState();
    const nonce = randomNonce();

    // Store state for callback validation
    pendingAuth.set(state, {
      nonce,
      returnTo: req.query.returnTo || '/'
    });

    // Cleanup after 10 minutes
    setTimeout(() => pendingAuth.delete(state), 600000);

    const authUrl = oidcClient.buildAuthUrl(state, nonce);
    res.redirect(authUrl.href);
  });

  // GET /auth/callback - Handle OIDC callback
  router.get('/callback', async (req, res) => {
    const oidcConfig = oidcClient.getConfig();
    if (!oidcConfig) {
      return res.status(503).json({ error: 'OIDC not configured' });
    }

    try {
      const state = req.query.state;
      const pending = pendingAuth.get(state);

      if (!pending) {
        return res.status(400).send('Invalid or expired state parameter');
      }

      pendingAuth.delete(state);

      // Build current URL for callback validation
      const currentUrl = new URL(req.originalUrl, authConfig.baseUrl);
      console.log('OIDC callback URL:', currentUrl.href);

      // Exchange code for tokens
      const tokens = await oidcClient.handleCallback(currentUrl, state, pending.nonce);
      console.log('OIDC tokens received');

      // Extract sub and sid from id_token claims
      const claims = tokens.claims();
      const sub = claims.sub;
      const oidcSid = claims.sid; // OIDC session ID for back-channel logout

      // Get user info
      const userInfo = await oidcClient.getUserInfo(tokens.access_token, sub);

      // Create session with OIDC sid for back-channel logout support
      const sid = sessionStore.create(
        userInfo.sub,
        userInfo,
        { id_token: tokens.id_token },
        oidcSid,
        authConfig.session.maxAge
      );

      // Set cookie
      res.cookie(authConfig.session.name, sid, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: authConfig.session.maxAge
      });

      res.redirect(pending.returnTo);
    } catch (err) {
      console.error('OIDC callback error:', err.message);
      console.error('OIDC callback error details:', err);
      res.status(500).send('Authentication failed: ' + err.message);
    }
  });

  // GET /auth/logout - Front-channel logout
  router.get('/logout', (req, res) => {
    const sid = req.cookies[authConfig.session.name];

    // Delete local session and get id_token
    let idToken = null;
    if (sid) {
      idToken = sessionStore.remove(sid);
    }

    // Clear cookie
    res.clearCookie(authConfig.session.name);

    // Redirect to OP end_session_endpoint if available
    const logoutUrl = oidcClient.getEndSessionUrl(idToken);
    if (logoutUrl) {
      return res.redirect(logoutUrl.href);
    }

    res.redirect('/');
  });

  return router;
}

// POST /logout/backchannel - Back-channel logout (called by OP)
async function backChannelLogout(req, res, config) {
  const oidcConfig = oidcClient.getConfig();
  if (!oidcConfig) {
    return res.status(501).send('OIDC not configured');
  }

  try {
    const { logout_token } = req.body;

    if (!logout_token) {
      return res.status(400).send('logout_token required');
    }

    // Decode logout token (JWT)
    // TODO: Add proper JWT signature verification
    const parts = logout_token.split('.');
    if (parts.length !== 3) {
      return res.status(400).send('Invalid logout token format');
    }

    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString());

    // Back-channel logout spec: must have either sub or sid (or both)
    if (!claims.sub && !claims.sid) {
      return res.status(400).send('logout_token must contain sub or sid');
    }

    let deleted = 0;

    // Prefer sid-based logout (more specific - single session)
    if (claims.sid) {
      deleted = sessionStore.deleteByOidcSid(claims.sid);
      console.log(`Back-channel logout: deleted ${deleted} session(s) for sid=${claims.sid}`);
    }

    // If no sessions found by sid, or no sid provided, try sub (all user sessions)
    if (deleted === 0 && claims.sub) {
      deleted = sessionStore.deleteByUserId(claims.sub);
      console.log(`Back-channel logout: deleted ${deleted} session(s) for sub=${claims.sub}`);
    }

    // Return 200 OK per spec (even if no sessions deleted)
    res.status(200).send('OK');
  } catch (err) {
    console.error('Back-channel logout error:', err.message);
    res.status(400).send('Invalid logout token');
  }
}

module.exports = {
  setup,
  backChannelLogout
};
