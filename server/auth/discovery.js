/**
 * OIDC discovery at startup. When the provider is not reachable yet, the server
 * keeps authentication on: it retries in the background and, meanwhile, answers
 * 503 on the API and the sign-in routes.
 */

const { isHealthCheck } = require('./health');

const FIRST_RETRY_DELAY_MS = 1000;
const MAX_RETRY_DELAY_MS = 60 * 1000;

/**
 * The delay before the next discovery attempt: 1 s after the first failure,
 * twice as long after each other one, 1 min at most.
 *
 * @param {number} failures - the failed attempts before the last one
 * @returns {number} milliseconds
 */
function discoveryRetryDelay(failures) {
  return Math.min(FIRST_RETRY_DELAY_MS * 2 ** failures, MAX_RETRY_DELAY_MS);
}

/**
 * A middleware that answers 503 until the provider is discovered. Mounted on
 * /api and /auth, it matches their paths as Express matches their routes:
 * without case, with or without a trailing slash. The health check stays open,
 * for the container's healthcheck.
 *
 * @param {function(): boolean} isDiscovered
 * @returns {function} the middleware
 */
function createDiscoveryGate(isDiscovered) {
  return (req, res, next) => {
    if (isDiscovered() || isHealthCheck(req)) {
      return next();
    }
    res.status(503).json({ error: 'Authentication provider unavailable, try again later' });
  };
}

module.exports = { discoveryRetryDelay, createDiscoveryGate };
