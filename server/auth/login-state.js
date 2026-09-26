/**
 * A sign-in in progress, bound to the browser that started it. /auth/login
 * sets a short-lived login cookie, signed with SESSION_SECRET, that holds the
 * state, the nonce and the PKCE code_verifier of its authorization request,
 * and where to go back after. The callback accepts a state only with the
 * cookie that holds it: a callback URL opened in another browser, as in a
 * login CSRF, is refused.
 */
const { signValue, unsignValue, sessionCookieOptions } = require('./session-cookie');

const LOGIN_COOKIE = 'ocm.login';
// Long enough to sign in at the provider, short enough not to be reused
const LOGIN_MAX_AGE_MS = 10 * 60 * 1000;

/**
 * The value of the login cookie: the sign-in and its expiry, as base64url
 * JSON, signed with SESSION_SECRET.
 *
 * @param {object} pending - state, nonce, codeVerifier and returnTo
 * @param {string} secret - SESSION_SECRET
 * @param {number} [now] - the current time, in milliseconds
 * @returns {string}
 */
function encodeLoginState({ state, nonce, codeVerifier, returnTo }, secret, now = Date.now()) {
  const json = JSON.stringify({
    state,
    nonce,
    codeVerifier,
    returnTo,
    expiresAt: now + LOGIN_MAX_AGE_MS,
  });
  return signValue(Buffer.from(json).toString('base64url'), secret);
}

/**
 * The sign-in of the login cookie, when the callback's state is its own.
 *
 * @param {*} cookie - the login cookie, whatever its type
 * @param {*} state - the state parameter of the callback, whatever its type
 * @param {string} secret - SESSION_SECRET
 * @param {number} [now] - the current time, in milliseconds
 * @returns {{ nonce: string, codeVerifier: string, returnTo: string }|null} null
 *   when the cookie is missing, altered or expired, or holds another state
 */
function readLoginState(cookie, state, secret, now = Date.now()) {
  const payload = unsignValue(cookie, secret);
  if (!payload || typeof state !== 'string' || state === '') {
    return null;
  }
  let pending;
  try {
    pending = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch (err) {
    return null;
  }
  // The browser drops the cookie after LOGIN_MAX_AGE_MS; expiresAt holds
  // even when a copy of it is sent later
  if (typeof pending !== 'object' || pending === null || !(pending.expiresAt > now)
    || pending.state !== state) {
    return null;
  }
  return { nonce: pending.nonce, codeVerifier: pending.codeVerifier, returnTo: pending.returnTo };
}

/**
 * The options of the login cookie, for res.cookie, with maxAge
 * LOGIN_MAX_AGE_MS, and res.clearCookie: those of the session cookie,
 * HttpOnly and SameSite=Lax, so that the provider's redirect back, a top-level
 * GET, carries it, but only on /auth.
 *
 * @param {object} req - the request
 * @param {object} auth - the auth settings
 * @returns {object}
 */
function loginCookieOptions(req, auth) {
  return { ...sessionCookieOptions(req, auth), path: '/auth' };
}

module.exports = {
  LOGIN_COOKIE,
  LOGIN_MAX_AGE_MS,
  encodeLoginState,
  readLoginState,
  loginCookieOptions,
};
