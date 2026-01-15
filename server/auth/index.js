/**
 * OIDC Authentication Module (openid-client v6.x)
 *
 * Provides optional OpenID Connect authentication with:
 * - Authorization code flow
 * - Session management in SQLite
 * - Back-channel logout support
 */
const oidcClient = require('./oidc-client');
const sessionStore = require('./session-store');
const routes = require('./routes');
const { createAuthMiddleware } = require('./middleware');

/**
 * Build auth configuration from environment variables and config file
 */
function buildAuthConfig(fileConfig) {
  const envEnabled = process.env.OIDC_ENABLED === 'true';
  const fileEnabled = fileConfig?.auth?.enabled === true;

  if (!envEnabled && !fileEnabled) {
    return { enabled: false };
  }

  return {
    enabled: true,
    provider: {
      issuer: process.env.OIDC_ISSUER || fileConfig?.auth?.provider?.issuer,
      clientId: process.env.OIDC_CLIENT_ID || fileConfig?.auth?.provider?.clientId,
      clientSecret: process.env.OIDC_CLIENT_SECRET || fileConfig?.auth?.provider?.clientSecret,
      scopes: (process.env.OIDC_SCOPES?.split(',') || fileConfig?.auth?.provider?.scopes || ['openid', 'profile', 'email'])
    },
    session: {
      secret: process.env.SESSION_SECRET || fileConfig?.auth?.session?.secret,
      maxAge: fileConfig?.auth?.session?.maxAge || 86400000, // 24h
      name: fileConfig?.auth?.session?.name || 'ocm.sid'
    },
    baseUrl: process.env.OIDC_BASE_URL || fileConfig?.auth?.baseUrl,
    backChannelLogout: fileConfig?.auth?.backChannelLogout !== false
  };
}

/**
 * Initialize OIDC authentication
 */
async function initialize(app, db, fileConfig) {
  const config = { auth: buildAuthConfig(fileConfig) };

  if (!config.auth.enabled) {
    console.log('OIDC authentication disabled');
    return { config, initialized: false };
  }

  // Validate required config
  const { provider, session, baseUrl } = config.auth;
  if (!provider.issuer || !provider.clientId || !provider.clientSecret) {
    console.error('OIDC: Missing required configuration (issuer, clientId, clientSecret)');
    config.auth.enabled = false;
    return { config, initialized: false };
  }

  if (!baseUrl) {
    console.error('OIDC: Missing baseUrl configuration');
    config.auth.enabled = false;
    return { config, initialized: false };
  }

  if (!session.secret) {
    console.error('OIDC: Missing session secret');
    config.auth.enabled = false;
    return { config, initialized: false };
  }

  try {
    // Initialize session store
    sessionStore.init(db);

    // Initialize OIDC client
    await oidcClient.initialize(config);

    console.log('OIDC authentication enabled');
    console.log(`  Issuer: ${provider.issuer}`);
    console.log(`  Client ID: ${provider.clientId}`);
    console.log(`  Base URL: ${baseUrl}`);

    return { config, initialized: true };
  } catch (err) {
    console.error('OIDC initialization failed:', err.message);
    config.auth.enabled = false;
    return { config, initialized: false };
  }
}

module.exports = {
  buildAuthConfig,
  initialize,
  createAuthMiddleware,
  setupRoutes: routes.setup,
  backChannelLogout: routes.backChannelLogout,
  sessionStore
};
