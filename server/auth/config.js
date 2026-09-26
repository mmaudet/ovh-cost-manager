/**
 * The OIDC settings, read from the environment and config.json.
 */
const { parseBoolean } = require('../boolean-setting');

const DEFAULT_SCOPES = ['openid', 'profile', 'email'];

/**
 * Builds the auth settings from environment variables and the config file:
 * the environment overrides the file. Every boolean is read, whatever the
 * mode, so that a mistake in one stops the server.
 *
 * @param {object} fileConfig - the content of config.json
 * @param {object} [env] - the environment variables
 * @param {string} [source] - the path of config.json, for the errors
 * @returns {object} { enabled: false, required }, or every setting when OIDC
 *   is enabled
 */
function buildAuthConfig(fileConfig, env = process.env, source = 'config.json') {
  const file = fileConfig?.auth || {};
  const fromEnv = (name, options) => parseBoolean(env[name], { name, ...options });
  const fromFile = (key, value, options) => parseBoolean(value, {
    name: `auth.${key} in ${source}`,
    fromFile: true,
    ...options,
  });

  const fileEnabled = fromFile('enabled', file.enabled);
  const fileSecure = fromFile('session.secure', file.session?.secure, { auto: true });
  const backChannelLogout = fromFile('backChannelLogout', file.backChannelLogout) ?? true;
  const envSecure = fromEnv('COOKIE_SECURE', { auto: true });
  // Header mode: whether Auth-User is required on the API
  const required = fromEnv('AUTH_REQUIRED') ?? false;
  // OIDC_ENABLED overrides auth.enabled, whichever way
  const enabled = fromEnv('OIDC_ENABLED') ?? fileEnabled ?? false;

  if (!enabled) {
    return { enabled: false, required };
  }

  return {
    enabled: true,
    required,
    provider: {
      issuer: env.OIDC_ISSUER || file.provider?.issuer,
      clientId: env.OIDC_CLIENT_ID || file.provider?.clientId,
      clientSecret: env.OIDC_CLIENT_SECRET || file.provider?.clientSecret,
      scopes: env.OIDC_SCOPES?.split(',') || file.provider?.scopes || DEFAULT_SCOPES,
    },
    session: {
      secret: env.SESSION_SECRET || file.session?.secret,
      maxAge: file.session?.maxAge || 86400000, // 24h
      name: file.session?.name || 'ocm.sid',
      // The Secure flag of the session cookie: true or false when forced,
      // 'auto' to follow the request's scheme
      secure: envSecure ?? fileSecure ?? 'auto',
    },
    baseUrl: env.OIDC_BASE_URL || file.baseUrl,
    backChannelLogout,
  };
}

// The settings OIDC cannot work without, named as an operator sets them
const REQUIRED_SETTINGS = [
  ['OIDC_ISSUER or auth.provider.issuer', (auth) => auth.provider.issuer],
  ['OIDC_CLIENT_ID or auth.provider.clientId', (auth) => auth.provider.clientId],
  ['OIDC_CLIENT_SECRET or auth.provider.clientSecret', (auth) => auth.provider.clientSecret],
  ['OIDC_BASE_URL or auth.baseUrl', (auth) => auth.baseUrl],
  ['SESSION_SECRET or auth.session.secret', (auth) => auth.session.secret],
];

/**
 * The required settings missing from enabled auth settings. With any, the
 * server must not start: falling back to header mode would open the API.
 *
 * @param {object} auth - settings of buildAuthConfig, with enabled: true
 * @returns {string[]} the names of the missing settings
 */
function missingSettings(auth) {
  return REQUIRED_SETTINGS.filter(([, read]) => !read(auth)).map(([name]) => name);
}

module.exports = { buildAuthConfig, missingSettings };
