/**
 * The rate limiting settings, and TRUST_PROXY, which the CORS and Host checks
 * read too: from config.json, which the environment overrides.
 */
const {
  parseBoolean,
  parsePositiveInteger,
  parseProxyCount,
  readSection,
} = require('./settings');

const DEFAULTS = {
  enabled: true,
  trustProxy: 0,
  api: { windowMs: 15 * 60 * 1000, max: 100 },
  auth: { windowMs: 15 * 60 * 1000, max: 20 },
};

/**
 * Builds the rate limiting settings. RATE_LIMIT_ENABLED, or enabled under
 * rateLimit in config.json, takes true or false only, as the auth settings;
 * TRUST_PROXY, or trustProxy there, true, false or a number of proxies from
 * 1 to 10; the windows and maxima, positive integers only; rateLimit, and api
 * and auth under it, are objects. Any other value throws, naming the setting,
 * rather than turn rate limiting or the proxy's trust off.
 *
 * @param {object} fileConfig - the content of config.json
 * @param {object} [env] - the environment variables
 * @param {string} [source] - the path of config.json, for the errors
 * @returns {{ enabled: boolean, trustProxy: number, api: object, auth: object }}
 *   trustProxy is the number of proxies the server trusts: 1 for true, 0 for
 *   false
 */
function buildRateLimitConfig(fileConfig, env = process.env, source = 'config.json') {
  const file = readSection(fileConfig || {}, 'rateLimit', { name: `rateLimit in ${source}` });
  // A key of rateLimit in config.json, or a variable, as the parser reads it
  const fromFile = (key, parse) => parse(file[key], {
    name: `rateLimit.${key} in ${source}`,
    fromFile: true,
  });
  const fromEnv = (name, parse) => parse(env[name], { name });

  // Every setting is read, even where the environment overrides the file
  const fileEnabled = fromFile('enabled', parseBoolean);
  const fileTrustProxy = fromFile('trustProxy', parseProxyCount);

  return {
    enabled: fromEnv('RATE_LIMIT_ENABLED', parseBoolean) ?? fileEnabled ?? DEFAULTS.enabled,
    trustProxy: fromEnv('TRUST_PROXY', parseProxyCount) ?? fileTrustProxy ?? DEFAULTS.trustProxy,
    api: readLimits(file, 'api', env, source),
    auth: readLimits(file, 'auth', env, source),
  };
}

// The window and the maximum of one limiter, api or auth, such as
// RATE_LIMIT_API_MAX, which overrides rateLimit.api.max
function readLimits(file, key, env, source) {
  const section = readSection(file, key, { name: `rateLimit.${key} in ${source}` });
  const prefix = `RATE_LIMIT_${key.toUpperCase()}`;
  const read = (name, variable) => {
    const fromFile = parsePositiveInteger(section[name], {
      name: `rateLimit.${key}.${name} in ${source}`,
      fromFile: true,
    });
    const fromEnv = parsePositiveInteger(env[variable], { name: variable });
    return fromEnv ?? fromFile ?? DEFAULTS[key][name];
  };
  return {
    windowMs: read('windowMs', `${prefix}_WINDOW_MS`),
    max: read('max', `${prefix}_MAX`),
  };
}

module.exports = { buildRateLimitConfig };
