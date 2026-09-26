/**
 * OIDC Authentication Routes (openid-client v6.x)
 */
const express = require('express');
const {
  randomState,
  randomNonce,
  randomPKCECodeVerifier,
  calculatePKCECodeChallenge,
} = require('openid-client');
const oidcClient = require('./oidc-client');
const sessionStore = require('./session-store');
const { safeReturnTo } = require('./return-to');
const { sessionCookieOptions, signValue, unsignValue } = require('./session-cookie');
const {
  LOGIN_MAX_AGE_MS,
  encodeLoginState,
  readLoginState,
  loginCookie,
} = require('./login-state');
const { sessionsToEnd } = require('./logout-token');

const router = express.Router();

// What a failed sign-in answers: the details go to the log only
const SIGN_IN_REFUSED = 'Sign-in failed, please sign in again.';
const SIGN_IN_FAILED = 'Sign-in failed.';

// The routes run once the provider is discovered: awaitDiscovery answers 503
// until then
function setup(config) {
  const authConfig = config.auth;

  // GET /auth/login - Initiate OIDC flow
  router.get('/login', async (req, res) => {
    try {
      const state = randomState();
      const nonce = randomNonce();
      // PKCE: the token request must prove that it comes from this sign-in
      const codeVerifier = randomPKCECodeVerifier();
      const codeChallenge = await calculatePKCECodeChallenge(codeVerifier);

      // Bind the sign-in to this browser: the callback accepts its state only
      // with the cookie of that state. returnTo: a path of this site only, or
      // the callback would redirect to any site
      const pending = { state, nonce, codeVerifier, returnTo: safeReturnTo(req.query.returnTo) };
      const cookie = loginCookie(req, authConfig, state);
      res.cookie(cookie.name, encodeLoginState(pending, authConfig.session.secret), {
        ...cookie.options,
        maxAge: LOGIN_MAX_AGE_MS,
      });

      const authUrl = oidcClient.buildAuthUrl(state, nonce, codeChallenge);
      res.redirect(authUrl.href);
    } catch (err) {
      console.error('OIDC login error:', err);
      res.status(500).type('text/plain').send(SIGN_IN_FAILED);
    }
  });

  // GET /auth/callback - Handle OIDC callback
  router.get('/callback', async (req, res) => {
    // The sign-in that this browser started, from the cookie of the state: a
    // callback URL opened in another browser is refused
    const state = req.query.state;
    const cookie = loginCookie(req, authConfig, state);
    const pending = cookie
      && readLoginState(req.cookies?.[cookie.name], state, authConfig.session.secret);
    if (!pending) {
      console.warn('OIDC callback: no valid sign-in cookie for its state');
      return res.status(400).type('text/plain').send(SIGN_IN_REFUSED);
    }
    // The cookie serves once; the other sign-ins in progress keep theirs
    res.clearCookie(cookie.name, cookie.options);

    try {
      // Build current URL for callback validation
      const currentUrl = new URL(req.originalUrl, authConfig.baseUrl);
      console.log('OIDC callback URL:', currentUrl.href);

      // Exchange code for tokens, proving the sign-in with the PKCE code_verifier
      const tokens = await oidcClient.handleCallback(
        currentUrl,
        state,
        pending.nonce,
        pending.codeVerifier
      );
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

      // Set cookie, signed: Secure over HTTPS, unless COOKIE_SECURE says otherwise
      res.cookie(authConfig.session.name, signValue(sid, authConfig.session.secret, 'session'), {
        ...sessionCookieOptions(req, authConfig),
        maxAge: authConfig.session.maxAge,
      });

      // Checked again: the redirect follows the cookie, which /auth/login set
      res.redirect(safeReturnTo(pending.returnTo));
    } catch (err) {
      // Refused by the provider, or its answer failed a check, as for a
      // replayed callback, a denied consent or another nonce: the user can
      // sign in again. Anything else failed on the server's side
      const refused = oidcClient.isRefusedSignIn(err);
      console.error(`OIDC callback: sign-in ${refused ? 'refused' : 'failed'}:`, err);
      res.status(refused ? 400 : 500).type('text/plain')
        .send(refused ? SIGN_IN_REFUSED : SIGN_IN_FAILED);
    }
  });

  // GET /auth/logout - Front-channel logout
  router.get('/logout', (req, res) => {
    const sid = unsignValue(
      req.cookies[authConfig.session.name],
      authConfig.session.secret,
      'session'
    );

    // Delete local session and get id_token
    let idToken = null;
    if (sid) {
      idToken = sessionStore.remove(sid);
    }

    // Clear cookie, with the flags it was set with
    res.clearCookie(authConfig.session.name, sessionCookieOptions(req, authConfig));

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
  // No response of this endpoint may be cached (Back-Channel Logout 1.0, 2.8)
  res.set('Cache-Control', 'no-store');

  // Until the provider is discovered, as awaitDiscovery does for /api and /auth
  const oidcConfig = oidcClient.getConfig();
  if (!oidcConfig) {
    return res.status(503).send('Authentication provider unavailable, try again later');
  }

  const logoutToken = req.body?.logout_token;
  if (typeof logoutToken !== 'string' || logoutToken === '') {
    return res.status(400).send('logout_token required');
  }

  // Signature against the provider's JWKS, issuer, audience, iat, then the
  // back-channel logout event, a sid or a sub, and no nonce: see
  // oidc-client.js and logout-token.js
  let claims;
  try {
    claims = await oidcClient.verifyLogoutToken(logoutToken);
  } catch (err) {
    console.warn('Back-channel logout: invalid logout token:', err.message);
    return res.status(400).send('Invalid logout token');
  }

  try {
    // The sessions of the sid only, even when none matches; without sid,
    // every session of the sub
    const target = sessionsToEnd(claims);
    const deleted = target.sid
      ? sessionStore.deleteByOidcSid(target.sid)
      : sessionStore.deleteByUserId(target.sub);
    const [by, value] = Object.entries(target)[0];
    console.log(`Back-channel logout: deleted ${deleted} session(s) for ${by}=${value}`);

    // Return 200 OK per spec (even if no sessions deleted)
    res.status(200).send('OK');
  } catch (err) {
    console.error('Back-channel logout error:', err.message);
    res.status(500).send('Logout failed');
  }
}

module.exports = {
  setup,
  backChannelLogout
};
