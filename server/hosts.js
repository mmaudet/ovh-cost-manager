/**
 * The Host check, against DNS rebinding (#78).
 *
 * A page on another domain can point that domain at the server's address: the
 * browser then sends the page's requests to the server as same-origin ones,
 * which CORS does not restrict, with the page's domain in the Host header.
 * When ALLOWED_HOSTS is set, the server only answers the hosts it lists and
 * the loopback names. When it is not, the check allows every request, so that
 * no existing deployment breaks.
 */

const { LOOPBACK_HOSTNAMES, firstValue, parseHost } = require('./hostHeader');

/**
 * Builds the check once, from the server's settings.
 *
 * @param {object} settings
 * @param {string[]} settings.allowedHosts - ALLOWED_HOSTS, or allowedHosts in
 *   config.json: host names, each with an optional port
 * @param {boolean} settings.trustProxy - whether the server trusts its proxy (TRUST_PROXY)
 * @returns {function(string|undefined, string|undefined): boolean} whether a
 *   request with this Host and X-Forwarded-Host passes
 */
function createHostCheck({ allowedHosts, trustProxy }) {
  // The check is on as soon as the list holds anything, well-formed or not, so
  // that a typo does not turn it off: a malformed entry matches no request
  const entries = allowedHosts.map((entry) => entry.trim()).filter(Boolean);
  if (entries.length === 0) {
    return () => true;
  }
  const listedHosts = entries
    .map((entry) => parseHost(entry))
    .filter(Boolean)
    .map(({ host }) => host);
  return function isAllowedHost(host, forwardedHost) {
    // Behind a trusted proxy, the host the browser asked for is the proxy's
    // X-Forwarded-Host, when it sends one: Host may be the container's name
    const requested = trustProxy && forwardedHost ? firstValue(forwardedHost) : host;
    const requestHost = parseHost(requested);
    if (!requestHost) {
      return false;
    }
    // Always allowed, on any port: the Docker healthcheck, the import cron
    // and local tools call the server on localhost
    if (LOOPBACK_HOSTNAMES.includes(requestHost.hostname)) {
      return true;
    }
    return listedHosts.includes(requestHost.host);
  };
}

module.exports = { createHostCheck };
