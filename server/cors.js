/**
 * The origin check of the CORS middleware.
 *
 * Allowed: requests without an Origin, the listed origins, localhost and
 * 127.0.0.1 in development, and the request's own origin. Chromium sends an
 * Origin even on the page's own script and stylesheet, which Vite marks
 * crossorigin (#76). CORS only restricts cross-origin requests, so accepting
 * the request's own origin does not widen access.
 */

/**
 * Builds the check once, from the server's settings.
 *
 * @param {object} settings
 * @param {string[]} settings.allowedOrigins - ALLOWED_ORIGINS, or allowedOrigins in config.json
 * @param {boolean} settings.isDev - true unless NODE_ENV is 'production'
 * @param {boolean} settings.trustProxy - whether the server trusts its proxy (TRUST_PROXY)
 * @returns {function(string|undefined, RequestFacts): boolean} whether a request
 *   with this Origin header passes
 */
function createOriginCheck({ allowedOrigins, isDev, trustProxy }) {
  /**
   * @typedef {object} RequestFacts
   * @property {string} [host] - Host header
   * @property {string} [forwardedHost] - X-Forwarded-Host header, read only
   *   behind a trusted proxy: its first host counts as the request's own too
   */
  return function isAllowedOrigin(origin, { host, forwardedHost }) {
    if (!origin || allowedOrigins.includes(origin)) {
      return true;
    }
    if (isDev && (origin.includes('localhost') || origin.includes('127.0.0.1'))) {
      return true;
    }
    const ownHosts = [host];
    if (trustProxy && forwardedHost) {
      ownHosts.push(forwardedHost.split(',')[0].trim());
    }
    try {
      // Hostname and port, the default port left out as in the Host header
      return ownHosts.includes(new URL(origin).host);
    } catch (e) {
      // A malformed Origin, or 'null', is nobody's own origin
      return false;
    }
  };
}

module.exports = { createOriginCheck };
