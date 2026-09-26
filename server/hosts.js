/**
 * The Host check, against DNS rebinding (#78).
 *
 * A page on another domain can point that domain at the server's address: the
 * browser then sends the page's requests to the server as same-origin ones,
 * which CORS does not restrict, with the page's domain in the Host header.
 * When ALLOWED_HOSTS is set, the server only answers a request whose Host it
 * lists, or is a loopback name on a direct request, and behind a trusted
 * proxy, whose last X-Forwarded-Host it lists too. When it is not, no check
 * runs, so that no existing deployment breaks.
 */

const { LOOPBACK_HOSTNAMES, lastValue, parseHost } = require('./hostHeader');

// The headers a proxy adds: a request with any of them is not a direct one
const PROXY_HEADERS = ['x-forwarded-for', 'x-forwarded-host', 'forwarded'];

// The log names each blocked host once an hour, and at most this many hosts
// an hour, as any client can send any number of them. It counts the others.
const LOG_PERIOD_MS = 60 * 60 * 1000;
const MAX_LOGGED_HOSTS = 100;

/**
 * Reads ALLOWED_HOSTS, or allowedHosts in config.json: a comma-separated
 * string, as the environment gives, or an array. The check is on as soon as
 * there is an entry, well-formed or not, so that a typo does not turn it off.
 *
 * @returns {{hosts: string[], ignored: Array}|null} the hosts as the check
 *   compares them, and the entries that are no host, such as a URL, which
 *   match no request; null when there is no entry
 */
function readAllowedHosts(setting) {
  const entries = (typeof setting === 'string' ? setting.split(',') : [].concat(setting ?? []))
    .map((entry) => (typeof entry === 'string' ? entry.trim() : entry))
    .filter((entry) => entry !== '');
  if (entries.length === 0) {
    return null;
  }
  const hosts = [];
  const ignored = [];
  for (const entry of entries) {
    const parsed = typeof entry === 'string' ? parseHost(entry) : null;
    if (parsed) {
      hosts.push(parsed.host);
    } else {
      ignored.push(entry);
    }
  }
  return { hosts, ignored };
}

/**
 * Builds the check once, from the server's settings.
 *
 * @param {object} settings
 * @param {string|string[]} [settings.allowedHosts] - ALLOWED_HOSTS, or
 *   allowedHosts in config.json: host names, each with an optional port, in a
 *   comma-separated string or an array
 * @param {boolean} settings.trustProxy - whether the server trusts its proxy (TRUST_PROXY)
 * @returns {function(object): {allowed: boolean, header: string, host: string}} the
 *   check of a request's headers, as Node names them: whether it passes, and
 *   when it does not, the header and the host it refused
 */
function createHostCheck({ allowedHosts, trustProxy }) {
  const setting = readAllowedHosts(allowedHosts);
  if (!setting) {
    return () => ({ allowed: true });
  }

  const isListed = (parsed) => parsed !== null && setting.hosts.includes(parsed.host);
  // A loopback name, on any port: the Docker healthcheck, the import cron and
  // local tools call the server on localhost
  const isLoopback = (parsed) => parsed !== null && LOOPBACK_HOSTNAMES.includes(parsed.hostname);
  // The header and the host refused, as the check compares it, or null when
  // the header holds none
  const refuse = (header, parsed) => ({ allowed: false, header, host: parsed && parsed.host });

  return function checkHost(headers) {
    // Host is always checked: a page that rebinds its own domain sends it
    // there, and a proxy that keeps Host passes it on. The loopback names pass
    // on direct requests only: a proxy on the same machine may send its
    // upstream, 127.0.0.1:3001, as Host, whatever the browser asked for.
    const host = parseHost(headers.host);
    const direct = PROXY_HEADERS.every((name) => headers[name] === undefined);
    if (!isListed(host) && !(direct && isLoopback(host))) {
      return refuse('Host', host);
    }
    // Behind a trusted proxy, the last X-Forwarded-Host must be listed too. A
    // page can send any X-Forwarded-Host, such as localhost, and a proxy that
    // does not set the header passes it on: the last value is the one the
    // nearest proxy set or appended, and the loopback names do not pass there.
    const forwardedHost = headers['x-forwarded-host'];
    if (trustProxy && forwardedHost !== undefined) {
      const forwarded = parseHost(lastValue(forwardedHost));
      if (!isListed(forwarded)) {
        return refuse('X-Forwarded-Host', forwarded);
      }
    }
    return { allowed: true };
  };
}

/**
 * The check as Express middleware: it answers a request it refuses with a 421
 * Misdirected Request, and logs it. Once built, it logs the hosts it allows,
 * and warns about each entry it ignores.
 *
 * @param {object} settings - as for createHostCheck()
 * @param {object} [logger] - the console, or a stand-in with log() and warn()
 * @returns {function|null} the middleware, or null when ALLOWED_HOSTS is not
 *   set, so that nothing runs then
 */
function createHostCheckMiddleware(settings, logger = console) {
  const setting = readAllowedHosts(settings.allowedHosts);
  if (!setting) {
    return null;
  }
  for (const entry of setting.ignored) {
    const reason = 'not a host name with an optional port';
    logger.warn(`Host check: ignoring ${JSON.stringify(entry)} in the allowed hosts: ${reason}`);
  }
  logger.log(setting.hosts.length > 0
    ? `Host check: allowed hosts: ${setting.hosts.join(', ')}`
      + ' (and the loopback names on direct requests)'
    : 'Host check: allowed hosts: none (only the loopback names on direct requests)');

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
      logger.warn(`Host check: Blocked request with ${result.header}: ${host}`);
    }
    return res.status(421).json({ error: 'Host not allowed' });
  };
}

module.exports = { createHostCheck, createHostCheckMiddleware };
