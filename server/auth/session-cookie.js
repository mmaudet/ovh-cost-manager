/**
 * The cookies of OIDC sign-in: their flags, and their values signed with
 * SESSION_SECRET, such as the session id of the session cookie.
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
 * The session cookie of a request: its name and its options, to set it, clear
 * it and read it. Secure, it is named with the __Host- prefix, on Path=/: a
 * browser accepts such a cookie only from this host, so that a sibling host
 * cannot plant one, as it can a plain ocm.sid for the whole domain on
 * Path=/api, which the browser sends first. Over plain HTTP, where browsers
 * refuse a __Host- cookie, it keeps its plain name.
 *
 * @param {object} req - the request
 * @param {object} auth - the auth settings: baseUrl, session.name and
 *   session.secure
 * @returns {{ name: string, options: object }}
 */
function sessionCookie(req, auth) {
  const options = { ...sessionCookieOptions(req, auth), path: '/' };
  const name = options.secure ? `__Host-${auth.session.name}` : auth.session.name;
  return { name, options };
}

/**
 * A cookie value signed with SESSION_SECRET for a purpose: the value, a dot,
 * and the HMAC-SHA256 of the purpose, a colon and the value. The session
 * cookie holds the session id signed for 'session': a session id alone, as
 * the sessions table stores it, is then no valid cookie. The sign-in cookie
 * is signed for 'login': neither cookie passes for the other.
 *
 * @param {string} value - such as the session id
 * @param {string} secret - SESSION_SECRET
 * @param {string} purpose - what the value is for: 'session' or 'login'
 * @returns {string}
 */
function signValue(value, secret, purpose) {
  return `${value}.${signature(value, secret, purpose)}`;
}

/**
 * The value of a signed cookie value, when its signature matches for the
 * purpose.
 *
 * @param {*} signed - the cookie value, whatever its type
 * @param {string} secret - SESSION_SECRET
 * @param {string} purpose - what the value is for: 'session' or 'login'
 * @returns {string|null} the value, or null
 */
function unsignValue(signed, secret, purpose) {
  checkPurpose(purpose);
  if (typeof signed !== 'string') {
    return null;
  }
  const dot = signed.lastIndexOf('.');
  if (dot <= 0) {
    return null;
  }
  const value = signed.slice(0, dot);
  const expected = Buffer.from(signature(value, secret, purpose));
  const given = Buffer.from(signed.slice(dot + 1));
  // In constant time: timingSafeEqual needs buffers of the same length, and
  // the length of a signature tells nothing about the secret
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
    return null;
  }
  return value;
}

function signature(value, secret, purpose) {
  checkPurpose(purpose);
  return crypto.createHmac('sha256', secret).update(`${purpose}:${value}`).digest('base64url');
}

// A purpose ends at its colon: it holds none, so that no two pairs of
// purpose and value sign the same text
function checkPurpose(purpose) {
  if (typeof purpose !== 'string' || purpose === '' || purpose.includes(':')) {
    throw new TypeError(`a signed value needs a purpose without colon, not ${purpose}`);
  }
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
  sessionCookie,
  signValue,
  unsignValue,
  sessionSecretWarning,
};
