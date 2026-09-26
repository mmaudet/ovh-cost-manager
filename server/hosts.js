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

// The log names each blocked host once an hour, and at most this many hosts
// an hour, as any client can send any number of them. It counts the others.
const LOG_PERIOD_MS = 60 * 60 * 1000;
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
  function isAllowed(parsed) {
    if (!parsed) {
      return false;
    }
    return LOOPBACK_HOSTNAMES.includes(parsed.hostname) || listedHosts.includes(parsed.host);
  }

  return function checkHost(headers) {
    const forwardedHost = headers['x-forwarded-host'];
    // Behind a trusted proxy, the host the browser asked for is the proxy's
    // X-Forwarded-Host, when it sends one: Host may be the container's name
    const [header, value] = trustProxy && forwardedHost
      ? ['X-Forwarded-Host', firstValue(forwardedHost)]
      : ['Host', headers.host];
    const parsed = parseHost(value);
    if (isAllowed(parsed)) {
      return { allowed: true };
    }
    // The host as the check compares it, or null when the header holds none
    return { allowed: false, header, host: parsed && parsed.host };
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
  let loggedHosts = new Set();
  let unlogged = 0;

  // Every hour, the log says how many rejections it left out, and starts over
  setInterval(() => {
    if (unlogged > 0) {
      const requests = unlogged === 1 ? 'request' : 'requests';
      logger.warn(`Host check: ${unlogged} more blocked ${requests} in the last hour, not logged`);
    }
    loggedHosts = new Set();
    unlogged = 0;
  }, LOG_PERIOD_MS).unref();

  return function hostCheck(req, res, next) {
    const result = checkHost(req.headers);
    if (result.allowed) {
      return next();
    }
    // Keyed on the host as the check compares it, so that a host is logged
    // once however it is written, and all malformed ones together
    const host = result.host || 'invalid';
    if (loggedHosts.has(host) || loggedHosts.size >= MAX_LOGGED_HOSTS) {
      unlogged += 1;
    } else {
      loggedHosts.add(host);
      logger.warn(`Host check: Blocked request for host: ${host}`);
    }
    return res.status(421).json({ error: 'Host not allowed' });
  };
}

module.exports = { createHostCheck, createHostCheckMiddleware };
