/**
 * The rate limiting settings, and TRUST_PROXY, which the CORS and Host checks
 * read too: from config.json, which the environment overrides.
 */
const { parseBoolean, parsePositiveInteger, readSection } = require('./settings');

const DEFAULTS = {
  enabled: true,
  trustProxy: false,
  api: { windowMs: 15 * 60 * 1000, max: 100 },
  auth: { windowMs: 15 * 60 * 1000, max: 20 },
};

/**
 * Builds the rate limiting settings. Their booleans, RATE_LIMIT_ENABLED and
 * TRUST_PROXY, or enabled and trustProxy under rateLimit in config.json, take
 * true or false only, as the auth settings; their windows and maxima,
 * positive integers only; rateLimit, and api and auth under it, are objects.
 * Any other value throws, naming the setting, rather than turn rate limiting
 * or the proxy's trust off.
 *
 * @param {object} fileConfig - the content of config.json
 * @param {object} [env] - the environment variables
 * @param {string} [source] - the path of config.json, for the errors
 * @returns {{ enabled: boolean, trustProxy: boolean, api: object, auth: object }}
 */
function buildRateLimitConfig(fileConfig, env = process.env, source = 'config.json') {
  const file = readSection(fileConfig || {}, 'rateLimit', { name: `rateLimit in ${source}` });
  const fromFile = (key) => parseBoolean(file[key], {
    name: `rateLimit.${key} in ${source}`,
    fromFile: true,
  });
  const fromEnv = (name) => parseBoolean(env[name], { name });

  // Every setting is read, even where the environment overrides the file
  const fileEnabled = fromFile('enabled');
  const fileTrustProxy = fromFile('trustProxy');

  return {
    enabled: fromEnv('RATE_LIMIT_ENABLED') ?? fileEnabled ?? DEFAULTS.enabled,
    trustProxy: fromEnv('TRUST_PROXY') ?? fileTrustProxy ?? DEFAULTS.trustProxy,
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
