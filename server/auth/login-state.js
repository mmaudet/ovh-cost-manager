/**
 * A sign-in in progress, bound to the browser that started it. /auth/login
 * sets a short-lived sign-in cookie, signed with SESSION_SECRET, that holds
 * the state, the nonce and the PKCE code_verifier of its authorization
 * request, and where to go back after. The callback accepts a state only with
 * the cookie that holds it: a callback URL opened in another browser, as in a
 * login CSRF, is refused.
 */
const { signValue, unsignValue, sessionCookieOptions } = require('./session-cookie');

const LOGIN_COOKIE_PREFIX = 'ocm.login.';
// Long enough to sign in at the provider, short enough not to be reused
const LOGIN_MAX_AGE_MS = 10 * 60 * 1000;
// A state as openid-client's randomState writes it, base64url, so that it can
// name a cookie
const STATE_FORMAT = /^[\w-]{1,128}$/;

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
  return signValue(Buffer.from(json).toString('base64url'), secret, 'login');
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
  const payload = unsignValue(cookie, secret, 'login');
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
 * The sign-in cookie of a state: its name, and its options for res.cookie,
 * with maxAge LOGIN_MAX_AGE_MS, and res.clearCookie. One cookie per state, so
 * that two sign-ins in one browser clear only their own. The flags are those
 * of the session cookie: HttpOnly, and SameSite=Lax, so that the provider's
 * redirect back, a top-level GET, carries it. When it is Secure, as over
 * HTTPS, the __Host- prefix makes browsers accept it only from this host,
 * with Path=/ and no Domain: neither a sibling host nor an HTTP page can set
 * one of their choice. Otherwise, as in the HTTP demo stack, a plain name,
 * on /auth only.
 *
 * @param {object} req - the request
 * @param {object} auth - the auth settings
 * @param {*} state - the state of the sign-in, whatever its type
 * @returns {{ name: string, options: object }|null} null for a state that no
 *   sign-in has
 */
function loginCookie(req, auth, state) {
  if (typeof state !== 'string' || !STATE_FORMAT.test(state)) {
    return null;
  }
  const options = sessionCookieOptions(req, auth);
  return options.secure
    ? { name: `__Host-${LOGIN_COOKIE_PREFIX}${state}`, options: { ...options, path: '/' } }
    : { name: `${LOGIN_COOKIE_PREFIX}${state}`, options: { ...options, path: '/auth' } };
}

module.exports = {
  LOGIN_MAX_AGE_MS,
  encodeLoginState,
  readLoginState,
  loginCookie,
};
