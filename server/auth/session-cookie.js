/**
 * The session cookie of OIDC sign-in: its flags, and its value, the session id
 * signed with SESSION_SECRET.
 */
const crypto = require('crypto');

/**
 * Whether the session cookie gets the Secure flag. Browsers then send it over
 * HTTPS only, but also refuse to store it from an http:// page: a Secure
 * cookie on an HTTP stack makes the sign-in loop.
 *
 * @param {object} req - the request: req.secure is true over HTTPS, as the
 *   connection says or, with TRUST_PROXY, the proxy's X-Forwarded-Proto
 * @param {boolean|string} setting - true or false when COOKIE_SECURE or
 *   auth.session.secure forces it, 'auto' otherwise
 * @param {string} baseUrl - the dashboard's public URL (OIDC_BASE_URL). The
 *   callback, which sets the cookie, is on it: over HTTPS when it is https, even
 *   when a proxy that is not trusted hides it from req.secure
 * @returns {boolean}
 */
function cookieSecure(req, setting, baseUrl) {
  if (typeof setting === 'boolean') {
    return setting;
  }
  return req.secure === true || /^https:/i.test(baseUrl);
}

/**
 * The options of the session cookie, for res.cookie and res.clearCookie.
 *
 * @param {object} req - the request
 * @param {object} auth - the auth settings: baseUrl and session.secure
 * @returns {object}
 */
function sessionCookieOptions(req, auth) {
  return {
    httpOnly: true,
    secure: cookieSecure(req, auth.session.secure, auth.baseUrl),
    sameSite: 'lax',
  };
}

/**
 * The value of the session cookie: the session id, a dot, and the HMAC-SHA256
 * of the session id under SESSION_SECRET. A session id alone, as the sessions
 * table stores it, is then no valid cookie.
 *
 * @param {string} sid - the session id
 * @param {string} secret - SESSION_SECRET
 * @returns {string}
 */
function signSessionId(sid, secret) {
  return `${sid}.${signature(sid, secret)}`;
}

/**
 * The session id of a cookie value, when its signature matches.
 *
 * @param {*} value - the cookie value, whatever its type
 * @param {string} secret - SESSION_SECRET
 * @returns {string|null} the session id, or null
 */
function unsignSessionId(value, secret) {
  if (typeof value !== 'string') {
    return null;
  }
  const dot = value.lastIndexOf('.');
  if (dot <= 0) {
    return null;
  }
  const sid = value.slice(0, dot);
  const expected = Buffer.from(signature(sid, secret));
  const given = Buffer.from(value.slice(dot + 1));
  // In constant time: timingSafeEqual needs buffers of the same length, and
  // the length of a signature tells nothing about the secret
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
    return null;
  }
  return sid;
}

function signature(sid, secret) {
  return crypto.createHmac('sha256', secret).update(sid).digest('base64url');
}

const MIN_SECRET_LENGTH = 32;

/**
 * A warning when SESSION_SECRET is too short to keep the signatures from
 * being forged, such as the defaults of the example files.
 *
 * @param {string} secret - SESSION_SECRET
 * @returns {string|null} the warning, or null
 */
function sessionSecretWarning(secret) {
  if (secret.length >= MIN_SECRET_LENGTH) {
    return null;
  }
  return `SESSION_SECRET has ${secret.length} characters: it signs the session cookie, `
    + `use at least ${MIN_SECRET_LENGTH} characters, such as the output of openssl rand -hex 32`;
}

module.exports = {
  cookieSecure,
  sessionCookieOptions,
  signSessionId,
  unsignSessionId,
  sessionSecretWarning,
};
