/**
 * The rate limiting settings, and TRUST_PROXY, which the CORS and Host checks
 * read too: from config.json, which the environment overrides.
 */
const { parseBoolean } = require('./boolean-setting');

const DEFAULTS = {
  enabled: true,
  trustProxy: false,
  api: { windowMs: 15 * 60 * 1000, max: 100 },
  auth: { windowMs: 15 * 60 * 1000, max: 20 },
};

// A positive integer of the environment, or the value so far
function envInteger(env, name, current) {
  const value = parseInt(env[name], 10);
  return !isNaN(value) && value > 0 ? value : current;
}

/**
 * Builds the rate limiting settings. Their booleans, RATE_LIMIT_ENABLED and
 * TRUST_PROXY, or enabled and trustProxy under rateLimit in config.json, take
 * true or false only, as the auth settings: any other value throws, naming
 * the setting, rather than turn rate limiting or the proxy's trust off.
 *
 * @param {object} fileConfig - the content of config.json
 * @param {object} [env] - the environment variables
 * @param {string} [source] - the path of config.json, for the errors
 * @returns {{ enabled: boolean, trustProxy: boolean, api: object, auth: object }}
 */
function buildRateLimitConfig(fileConfig, env = process.env, source = 'config.json') {
  const file = fileConfig?.rateLimit || {};
  const fromFile = (key) => parseBoolean(file[key], {
    name: `rateLimit.${key} in ${source}`,
    fromFile: true,
  });
  const fromEnv = (name) => parseBoolean(env[name], { name });

  // Every boolean is read, even where the environment overrides the file
  const fileEnabled = fromFile('enabled');
  const fileTrustProxy = fromFile('trustProxy');

  return {
    enabled: fromEnv('RATE_LIMIT_ENABLED') ?? fileEnabled ?? DEFAULTS.enabled,
    trustProxy: fromEnv('TRUST_PROXY') ?? fileTrustProxy ?? DEFAULTS.trustProxy,
    api: {
      windowMs: envInteger(env, 'RATE_LIMIT_API_WINDOW_MS',
        file.api?.windowMs ?? DEFAULTS.api.windowMs),
      max: envInteger(env, 'RATE_LIMIT_API_MAX', file.api?.max ?? DEFAULTS.api.max),
    },
    auth: {
      windowMs: envInteger(env, 'RATE_LIMIT_AUTH_WINDOW_MS',
        file.auth?.windowMs ?? DEFAULTS.auth.windowMs),
      max: envInteger(env, 'RATE_LIMIT_AUTH_MAX', file.auth?.max ?? DEFAULTS.auth.max),
    },
  };
}

module.exports = { buildRateLimitConfig };
