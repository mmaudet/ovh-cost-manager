/**
 * The Host check, against DNS rebinding (#78).
 *
 * A page on another domain can point that domain at the server's address: the
 * browser then sends the page's requests to the server as same-origin ones,
 * which CORS does not restrict, with the page's domain in the Host header.
 * When ALLOWED_HOSTS is set, the server only answers the hosts it lists and
 * the loopback names. When it is not, no check runs, so that no existing
 * deployment breaks.
 */

const { LOOPBACK_HOSTNAMES, firstValue, parseHost } = require('./hostHeader');

// Each blocked host is logged once, and only the first hundred: any client can
// send any number of them
const MAX_LOGGED_HOSTS = 100;

// The entries of ALLOWED_HOSTS, without blanks. The check is on as soon as
// there is one, well-formed or not, so that a typo does not turn it off.
function listEntries(allowedHosts) {
  return allowedHosts.map((entry) => entry.trim()).filter(Boolean);
}

/**
 * Builds the check once, from the server's settings.
 *
 * @param {object} settings
 * @param {string[]} settings.allowedHosts - ALLOWED_HOSTS, or allowedHosts in
 *   config.json: host names, each with an optional port
 * @param {boolean} settings.trustProxy - whether the server trusts its proxy (TRUST_PROXY)
 * @returns {function(object): {allowed: boolean, header: string, host: string}} the
 *   check of a request's headers, as Node names them: whether it passes, and
 *   when it does not, the header and the host it refused
 */
function createHostCheck({ allowedHosts, trustProxy }) {
  const entries = listEntries(allowedHosts);
  if (entries.length === 0) {
    return () => ({ allowed: true });
  }
  // A malformed entry matches no request
  const listedHosts = entries
    .map((entry) => parseHost(entry))
    .filter(Boolean)
    .map(({ host }) => host);

  // Listed, or a loopback name on any port: the Docker healthcheck, the import
  // cron and local tools call the server on localhost
  function isAllowed(header) {
    const parsed = parseHost(header);
    if (!parsed) {
      return false;
    }
    return LOOPBACK_HOSTNAMES.includes(parsed.hostname) || listedHosts.includes(parsed.host);
  }

  return function checkHost(headers) {
    const forwardedHost = headers['x-forwarded-host'];
    // Behind a trusted proxy, the host the browser asked for is the proxy's
    // X-Forwarded-Host, when it sends one: Host may be the container's name
    const [header, host] = trustProxy && forwardedHost
      ? ['X-Forwarded-Host', firstValue(forwardedHost)]
      : ['Host', headers.host];
    return isAllowed(host) ? { allowed: true } : { allowed: false, header, host };
  };
}

/**
 * The check as Express middleware: it answers a request it refuses with a 421
 * Misdirected Request, and logs it.
 *
 * @param {object} settings - as for createHostCheck()
 * @param {object} [logger] - the console, or a stand-in with warn()
 * @returns {function|null} the middleware, or null when ALLOWED_HOSTS is not
 *   set, so that nothing runs then
 */
function createHostCheckMiddleware(settings, logger = console) {
  if (listEntries(settings.allowedHosts).length === 0) {
    return null;
  }
  const checkHost = createHostCheck(settings);
  const loggedHosts = new Set();

  return function hostCheck(req, res, next) {
    const result = checkHost(req.headers);
    if (result.allowed) {
      return next();
    }
    if (!loggedHosts.has(result.host) && loggedHosts.size < MAX_LOGGED_HOSTS) {
      loggedHosts.add(result.host);
      logger.warn(`Host check: Blocked request for host: ${result.host}`);
      if (loggedHosts.size === MAX_LOGGED_HOSTS) {
        logger.warn('Host check: Further blocked hosts are not logged');
      }
    }
    return res.status(421).json({ error: 'Host not allowed' });
  };
}

module.exports = { createHostCheck, createHostCheckMiddleware };
