/**
 * Whether the CORS middleware lets a request through, given its Origin header.
 *
 * Allowed: requests without an Origin, the listed origins, localhost and
 * 127.0.0.1 in development, and the request's own origin. Chromium sends an
 * Origin even on the page's own script and stylesheet, which Vite marks
 * crossorigin (#76). CORS only restricts cross-origin requests, so accepting
 * the request's own origin does not widen access.
 *
 * @param {object} request
 * @param {string} [request.origin] - Origin header
 * @param {string} [request.host] - Host header
 * @param {string} [request.forwardedHost] - X-Forwarded-Host header, read only
 *   behind a trusted proxy: its first host counts as the request's own too
 * @param {boolean} request.trustProxy - whether the server trusts its proxy (TRUST_PROXY)
 * @param {string[]} request.allowedOrigins - ALLOWED_ORIGINS, or allowedOrigins in config.json
 * @param {boolean} request.isDev - true unless NODE_ENV is 'production'
 * @returns {boolean}
 */
function isAllowedOrigin({ origin, host, forwardedHost, trustProxy, allowedOrigins, isDev }) {
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
}

module.exports = { isAllowedOrigin };
