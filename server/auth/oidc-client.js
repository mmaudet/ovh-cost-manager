/**
 * OIDC Client initialization using openid-client v6.x
 */
const {
  discovery,
  buildAuthorizationUrl,
  authorizationCodeGrant,
  fetchUserInfo,
  buildEndSessionUrl,
  allowInsecureRequests,
  validateJwtLogoutToken
} = require('openid-client');

let config = null;
let authConfig = null;

async function initialize(appConfig) {
  authConfig = appConfig.auth;
  const { provider, baseUrl } = authConfig;

  // Discover OIDC configuration from issuer
  const issuerUrl = new URL(provider.issuer);

  config = await discovery(
    issuerUrl,
    provider.clientId,
    provider.clientSecret,
    undefined,
    {
      execute: [allowInsecureRequests]
    }
  );

  console.log('OIDC: Discovered issuer %s', config.serverMetadata().issuer);

  return config;
}

function buildAuthUrl(state, nonce) {
  const redirectUri = `${authConfig.baseUrl}/auth/callback`;

  return buildAuthorizationUrl(config, {
    redirect_uri: redirectUri,
    scope: authConfig.provider.scopes.join(' '),
    state,
    nonce
  });
}

async function handleCallback(currentUrl, expectedState, expectedNonce) {
  const tokens = await authorizationCodeGrant(config, currentUrl, {
    expectedState,
    expectedNonce,
    idTokenExpected: true
  });

  return tokens;
}

async function getUserInfo(accessToken, expectedSub) {
  return await fetchUserInfo(config, accessToken, expectedSub);
}

function getEndSessionUrl(idToken) {
  if (!config.serverMetadata().end_session_endpoint) {
    return null;
  }

  return buildEndSessionUrl(config, {
    id_token_hint: idToken,
    post_logout_redirect_uri: authConfig.baseUrl
  });
}

function getConfig() {
  return config;
}

function getServerMetadata() {
  return config?.serverMetadata();
}

/**
 * Verify and decode a back-channel logout token
 * @param {string} logoutToken - The JWT logout token from the OP
 * @returns {Promise<object>} - The verified token claims
 * @throws {Error} - If token validation fails
 */
async function verifyLogoutToken(logoutToken) {
  if (!config) {
    throw new Error('OIDC not initialized');
  }

  // validateJwtLogoutToken verifies:
  // - JWT signature against OIDC provider's JWKS
  // - Token expiration (exp claim)
  // - Issuer (iss claim) matches the OIDC provider
  // - Audience (aud claim) contains our client_id
  // - Required claims (sub or sid) are present
  const claims = await validateJwtLogoutToken(config, logoutToken);

  return claims;
}

module.exports = {
  initialize,
  buildAuthUrl,
  handleCallback,
  getUserInfo,
  getEndSessionUrl,
  getConfig,
  getServerMetadata,
  verifyLogoutToken
};
