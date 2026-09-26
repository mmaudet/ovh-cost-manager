/**
 * The health check's path, which every auth check leaves open, for the
 * container's healthcheck.
 */

// /api/health as Express routes it: in any case, with or without a trailing
// slash, and nothing else
const HEALTH_PATH = /^\/api\/health\/?$/i;

/**
 * Whether a request is for the health check, from any middleware: whether it
 * is mounted on /api or on the app, req.baseUrl followed by req.path is the
 * path the request writes.
 *
 * @param {object} req - the request
 * @returns {boolean}
 */
function isHealthCheck(req) {
  return HEALTH_PATH.test(req.baseUrl + req.path);
}

module.exports = { isHealthCheck };
