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

// Always allowed, on any port: the Docker healthcheck, the import cron and
// local tools call the server on localhost. Compared with the whole hostname,
// as URL writes it.
const LOOPBACK_HOSTNAMES = ['localhost', '127.0.0.1', '[::1]'];

// What a host may hold: a name, an IPv4 address or an IPv6 one in brackets,
// then a port. URL would read a path, a user or a query after a host, or a tab
// within it, as that host alone.
const HOST_CHARACTERS = /^[\w.:[\]-]+$/;

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
  const listedHosts = entries.map(parseHost).filter(Boolean).map(({ host }) => host);
  return function isAllowedHost(host, forwardedHost) {
    // Behind a trusted proxy, the host the browser asked for is the proxy's
    // X-Forwarded-Host, when it sends one: Host may be the container's name
    const requested = trustProxy && forwardedHost ? firstValue(forwardedHost) : host;
    const requestHost = parseHost(requested);
    if (!requestHost) {
      return false;
    }
    if (LOOPBACK_HOSTNAMES.includes(requestHost.hostname)) {
      return true;
    }
    return listedHosts.includes(requestHost.host);
  };
}

// The first value of a header that may hold a list, as Express reads it
function firstValue(header) {
  return header.split(',')[0].trim();
}

// A host as URL writes it, and its name without the port: lowercase, and
// without the default port of http or https, as the check does not know the
// request's scheme. Behind a TLS-terminating proxy, the connection is plain
// HTTP whatever the page's. null when it is no host.
function parseHost(host) {
  if (!host || !HOST_CHARACTERS.test(host)) {
    return null;
  }
  let url;
  try {
    url = new URL(`http://${host}`);
  } catch (e) {
    return null;
  }
  return {
    // URL drops 80, the default port of http, but keeps 443
    host: url.port === '443' ? url.hostname : url.host,
    hostname: url.hostname,
  };
}

module.exports = { createHostCheck };
