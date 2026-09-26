/**
 * The health check's path, which every auth check leaves open, for the
 * container's healthcheck.
 */

// /api/health as Express routes it: in any case, with or without a trailing
// slash, and nothing else
const HEALTH_PATH = /^\/api\/health\/?$/i;

/**
 * Whether a request is for the health check, from any middleware, mounted on
 * /api or on the app: on the path the request writes, req.originalUrl
 * without its query. Not on req.baseUrl followed by req.path: mounted on
 * /api, a middleware sees /api//health as /api and /health, while no route
 * serves the health check at /api//health.
 *
 * @param {object} req - the request
 * @returns {boolean}
 */
function isHealthCheck(req) {
  const [path] = (req.originalUrl ?? req.url).split('?');
  return HEALTH_PATH.test(path);
}

module.exports = { isHealthCheck };
