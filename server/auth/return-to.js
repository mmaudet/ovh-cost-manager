/**
 * Where the OIDC callback may redirect after sign-in: a path of this site.
 */

// A single slash, not followed by another slash or a backslash, then no
// backslash, whitespace or control character: browsers read a backslash as a
// slash and drop tabs and newlines, so /\evil.example or /<tab>/evil.example
// would lead to //evil.example, another site. With a leading slash, the value
// has no scheme either.
const SAME_SITE_PATH = /^\/(?![/\\])[^\\\s\x00-\x1f\x7f]*$/;

/**
 * The returnTo of /auth/login when it is a same-site path, or '/'.
 *
 * @param {*} value - the returnTo query parameter, whatever its type
 * @returns {string} a path starting with a single slash
 */
function safeReturnTo(value) {
  return typeof value === 'string' && SAME_SITE_PATH.test(value) ? value : '/';
}

module.exports = { safeReturnTo };
