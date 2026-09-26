/**
 * The OIDC settings, read from the environment and config.json.
 */

const DEFAULT_SCOPES = ['openid', 'profile', 'email'];

/**
 * A true/false setting of the environment, which overrides config.json.
 *
 * @param {object} env - the environment variables
 * @param {string} name - the variable
 * @returns {boolean|undefined} undefined when unset or empty, for the file's
 *   value to apply
 * @throws {Error} on any other value than true or false, rather than guess
 */
function envBoolean(env, name) {
  const value = env[name];
  if (value === undefined || value === '') {
    return undefined;
  }
  if (value !== 'true' && value !== 'false') {
    throw new Error(`${name} must be true or false, not '${value}'`);
  }
  return value === 'true';
}

// The Secure flag of the session cookie: true or false when COOKIE_SECURE or
// auth.session.secure forces it, 'auto' to follow the request's scheme
function cookieSecureSetting(env, fileSession) {
  const fromFile = typeof fileSession?.secure === 'boolean' ? fileSession.secure : 'auto';
  return envBoolean(env, 'COOKIE_SECURE') ?? fromFile;
}

/**
 * Builds the auth settings from environment variables and the config file:
 * the environment overrides the file.
 *
 * @param {object} fileConfig - the content of config.json
 * @param {object} [env] - the environment variables
 * @returns {object} { enabled: false }, or every setting when OIDC is enabled
 */
function buildAuthConfig(fileConfig, env = process.env) {
  const file = fileConfig?.auth || {};
  // OIDC_ENABLED overrides auth.enabled, whichever way
  const enabled = envBoolean(env, 'OIDC_ENABLED') ?? file.enabled === true;

  if (!enabled) {
    return { enabled: false };
  }

  return {
    enabled: true,
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
      secure: cookieSecureSetting(env, file.session),
    },
    baseUrl: env.OIDC_BASE_URL || file.baseUrl,
    backChannelLogout: file.backChannelLogout !== false,
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
