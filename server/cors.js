/**
 * The origin check of the CORS middleware.
 *
 * Allowed: requests without an Origin, the listed origins, localhost in
 * development, and the request's own origin. Chromium sends an Origin even on
 * the page's own script and stylesheet, which Vite marks crossorigin (#76).
 * CORS only restricts cross-origin requests, so accepting the request's own
 * origin does not widen access.
 */

const { LOOPBACK_HOSTNAMES, firstValue, parseHost } = require('./hostHeader');

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
   * @property {string} [forwardedProto] - X-Forwarded-Proto header, read only
   *   behind a trusted proxy: its first scheme is the request's
   * @property {boolean} [encrypted] - whether the connection itself is TLS
   */
  return function isAllowedOrigin(origin, request) {
    if (!origin || allowedOrigins.includes(origin)) {
      return true;
    }
    const url = parseOrigin(origin);
    if (!url) {
      return false;
    }
    // In development, the Vite dev server calls the API from another port
    if (isDev && LOOPBACK_HOSTNAMES.includes(url.hostname)) {
      return true;
    }
    // When the server does not know the request's scheme, hosts alone are
    // compared: an http page then passes for an https dashboard on the same
    // host, but the dashboard does not go blank behind a TLS-terminating proxy
    // that is not trusted, or that sends no X-Forwarded-Proto.
    const scheme = knownScheme(request, trustProxy);
    if (scheme && url.protocol !== `${scheme}:`) {
      return false;
    }
    const ownHosts = [request.host];
    if (trustProxy && request.forwardedHost) {
      ownHosts.push(firstValue(request.forwardedHost));
    }
    return ownHosts.some((ownHost) => parseHost(ownHost, url.protocol)?.host === url.host);
  };
}

// The request's scheme when the server knows it, or null. Behind a
// TLS-terminating proxy, the connection is plain HTTP whatever the page's
// scheme: only a trusted proxy's X-Forwarded-Proto, or a TLS connection, tells.
function knownScheme({ forwardedProto, encrypted }, trustProxy) {
  if (trustProxy && forwardedProto) {
    return firstValue(forwardedProto);
  }
  return encrypted ? 'https' : null;
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
