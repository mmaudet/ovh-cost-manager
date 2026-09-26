/**
 * The OIDC settings, read from the environment and config.json.
 */

const DEFAULT_SCOPES = ['openid', 'profile', 'email'];

/**
 * Builds the auth settings from environment variables and the config file.
 *
 * @param {object} fileConfig - the content of config.json
 * @param {object} [env] - the environment variables
 * @returns {object} { enabled: false }, or every setting when OIDC is enabled
 */
function buildAuthConfig(fileConfig, env = process.env) {
  const file = fileConfig?.auth || {};
  const envEnabled = env.OIDC_ENABLED === 'true';
  const fileEnabled = file.enabled === true;

  if (!envEnabled && !fileEnabled) {
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
