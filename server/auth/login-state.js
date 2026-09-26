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
  const pending = decodeLoginState(cookie, state, secret, now);
  if (!pending) {
    return null;
  }
  return { nonce: pending.nonce, codeVerifier: pending.codeVerifier, returnTo: pending.returnTo };
}

// The sign-in a login cookie holds, with its expiresAt, when its signature
// matches, its 10 minutes are not over and its state is the one given
function decodeLoginState(cookie, state, secret, now) {
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
  return pending;
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
  const { prefix, options } = loginCookieKind(req, auth);
  return { name: `${prefix}${state}`, options };
}

// The prefix of the sign-in cookies of a request, and their options
function loginCookieKind(req, auth) {
  const options = sessionCookieOptions(req, auth);
  return options.secure
    ? { prefix: `__Host-${LOGIN_COOKIE_PREFIX}`, options: { ...options, path: '/' } }
    : { prefix: LOGIN_COOKIE_PREFIX, options: { ...options, path: '/auth' } };
}

// The sign-ins in progress a browser keeps at most, the newest. With a
// returnTo of 1 KB at most, a sign-in cookie holds less than 2 KB: three,
// and the session cookie, keep the Cookie header under 8 KB, the longest
// header line nginx accepts by default
const MAX_PENDING_SIGN_INS = 3;

/**
 * The sign-in cookies that a new sign-in clears, so that a browser keeps
 * MAX_PENDING_SIGN_INS at most, the new one included: all but the newest of
 * those the request carries, told by the expiry they hold, and every one
 * that no callback would accept, altered or expired. Otherwise each visit of
 * /auth/login adds a cookie for 10 minutes, and a page that opens it again
 * and again grows the Cookie header until the server, or a proxy, refuses
 * every request of the dashboard.
 *
 * @param {object} req - the request of /auth/login, with its cookies
 * @param {object} auth - the auth settings
 * @param {number} [now] - the current time, in milliseconds
 * @returns {Array<{ name: string, options: object }>} the cookies to clear
 */
function staleLoginCookies(req, auth, now = Date.now()) {
  const { prefix, options } = loginCookieKind(req, auth);
  // A browser sends the cookies of one path oldest first: reversed, the
  // newest come first among those of the same expiry
  const pending = Object.entries(req.cookies || {})
    .filter(([name]) => name.startsWith(prefix) && STATE_FORMAT.test(name.slice(prefix.length)))
    .reverse()
    .map(([name, cookie]) => {
      const sign = decodeLoginState(cookie, name.slice(prefix.length), auth.session.secret, now);
      return { name, expiresAt: sign ? sign.expiresAt : null };
    });
  const kept = pending
    .filter(({ expiresAt }) => expiresAt !== null)
    .sort((a, b) => b.expiresAt - a.expiresAt)
    .slice(0, MAX_PENDING_SIGN_INS - 1);
  return pending
    .filter((cookie) => !kept.includes(cookie))
    .map(({ name }) => ({ name, options }));
}

module.exports = {
  LOGIN_MAX_AGE_MS,
  MAX_PENDING_SIGN_INS,
  encodeLoginState,
  readLoginState,
  loginCookie,
  staleLoginCookies,
};
