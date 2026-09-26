/**
 * The session cookie of OIDC sign-in.
 */

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

module.exports = { cookieSecure, sessionCookieOptions };
