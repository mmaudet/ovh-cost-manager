/**
 * The origin check of the CORS middleware.
 *
 * Allowed: requests without an Origin, the listed origins, localhost in
 * development, and the request's own origin. Chromium sends an Origin even on
 * the page's own script and stylesheet, which Vite marks crossorigin (#76).
 * CORS only restricts cross-origin requests, so accepting the request's own
 * origin does not widen access.
 */

// Allowed in development, where the Vite dev server calls the API from
// another port. Compared with the whole hostname, as URL writes it.
const LOOPBACK_HOSTNAMES = ['localhost', '127.0.0.1', '[::1]'];

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
    const url = parseOrigin(origin);
    if (!url) {
      return false;
    }
    if (isDev && LOOPBACK_HOSTNAMES.includes(url.hostname)) {
      return true;
    }
    const ownHosts = [host];
    if (trustProxy && forwardedHost) {
      ownHosts.push(forwardedHost.split(',')[0].trim());
    }
    // Hostname and port, the default port left out as in the Host header
    return ownHosts.includes(url.host);
  };
}

// The Origin header as an http(s) URL, which always has a host, or null: when
// it is malformed, 'null', or of another scheme. 'ocm.example.com:3001' parses,
// but as the scheme 'ocm.example.com:' without a host.
function parseOrigin(origin) {
  let url;
  try {
    url = new URL(origin);
  } catch (e) {
    return null;
  }
  return ['http:', 'https:'].includes(url.protocol) ? url : null;
}

module.exports = { createOriginCheck };
