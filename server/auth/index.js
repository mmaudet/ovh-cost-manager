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
const { buildAuthConfig, missingSettings } = require('./config');
const { discoveryRetryDelay, createDiscoveryGate } = require('./discovery');
const { mountHeaderMode } = require('./header-mode');
const { sessionSecretWarning } = require('./session-cookie');
const { plainHttpWarning } = require('./provider');

/**
 * Initialize OIDC authentication. When it is enabled, the server never falls
 * back to header mode: it refuses to start without the required settings, and
 * discovers the provider in the background, retrying until it succeeds.
 */
async function initialize(app, db, fileConfig) {
  const config = { auth: buildAuthConfig(fileConfig) };

  if (!config.auth.enabled) {
    console.log('OIDC authentication disabled');
    return { config };
  }

  const missing = missingSettings(config.auth);
  if (missing.length > 0) {
    throw new Error(`OIDC is enabled, but these settings are missing: ${missing.join('; ')}`);
  }

  // Initialize session store
  sessionStore.init(db);

  const { provider, baseUrl } = config.auth;
  console.log('OIDC authentication enabled');
  console.log(`  Issuer: ${provider.issuer}`);
  console.log(`  Client ID: ${provider.clientId}`);
  console.log(`  Base URL: ${baseUrl}`);

  const secretWarning = sessionSecretWarning(config.auth.session.secret);
  if (secretWarning) {
    console.warn(`OIDC: ${secretWarning}`);
  }
  const httpWarning = plainHttpWarning(provider.issuer, process.env.NODE_ENV);
  if (httpWarning) {
    console.warn(`OIDC: ${httpWarning}`);
  }

  discover(config);

  return { config };
}

// Discovers the provider, retrying with backoff until it succeeds. Meanwhile,
// the gates of awaitDiscovery answer 503.
function discover(config, failures = 0) {
  oidcClient.initialize(config).then(
    () => console.log('OIDC: provider discovered, sign-in is available'),
    (err) => {
      const delay = discoveryRetryDelay(failures);
      const cause = err.cause?.code || err.cause?.message;
      const reason = cause ? `${err.message} (${cause})` : err.message;
      console.error(`OIDC: discovery of ${config.auth.provider.issuer} failed: ${reason}. `
        + `/api and /auth answer 503 until it succeeds; next attempt in ${delay / 1000} s`);
      setTimeout(() => discover(config, failures + 1), delay);
    },
  );
}

/**
 * A middleware that answers 503 until the provider is discovered, except on
 * the health check.
 */
function awaitDiscovery() {
  return createDiscoveryGate(() => oidcClient.getConfig() !== null);
}

module.exports = {
  buildAuthConfig,
  initialize,
  awaitDiscovery,
  mountHeaderMode,
  createAuthMiddleware,
  setupRoutes: routes.setup,
  backChannelLogout: routes.backChannelLogout,
  sessionStore,
};
