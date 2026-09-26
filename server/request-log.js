/**
 * The server's log lines that carry text it did not write: a user id from the
 * provider or the Auth-User header, an Origin header from the client. That
 * text is quoted, so that a newline or another control character in it cannot
 * end the line and forge one of its own in the log.
 */

const { quote } = require('./auth/log-text');

/**
 * The log line of a request.
 *
 * @param {{ at: Date, user?: string, method: string, path: string }} request
 * @returns {string}
 */
function requestLogLine({ at, user, method, path }) {
  return `${at.toISOString()} [${quote(user || 'anonymous')}] ${method} ${path}`;
}

/**
 * The log line of a request the CORS check refused.
 *
 * @param {string} origin - the request's Origin header
 * @returns {string}
 */
function blockedOriginLogLine(origin) {
  return `CORS: Blocked request from origin: ${quote(origin)}`;
}

module.exports = { requestLogLine, blockedOriginLogLine };
