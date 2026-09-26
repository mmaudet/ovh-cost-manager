/**
 * OIDC Client initialization using openid-client v6.x
 */
const {
  discovery,
  buildAuthorizationUrl,
  authorizationCodeGrant,
  fetchUserInfo,
  buildEndSessionUrl,
  allowInsecureRequests
} = require('openid-client');
// openid-client v6 validates no logout token: jose, the JOSE library it is
// built on, verifies them
const { createRemoteJWKSet, jwtVerify } = require('jose');
const { logoutTokenVerifyOptions, checkLogoutTokenClaims } = require('./logout-token');
const { authorizationParameters, plainHttpAllowed, jwksUriToFetch } = require('./provider');

let config = null;
let authConfig = null;
// The provider's signing keys, fetched from its jwks_uri when a token needs them
let jwks = null;

async function initialize(appConfig) {
  authConfig = appConfig.auth;
  const { provider } = authConfig;

  // Discover OIDC configuration from issuer
  const issuerUrl = new URL(provider.issuer);

  const discovered = await discovery(
    issuerUrl,
    provider.clientId,
    provider.clientSecret,
    undefined,
    // Plain HTTP only for an http:// issuer, as in the demo stack
    plainHttpAllowed(provider.issuer) ? { execute: [allowInsecureRequests] } : undefined
  );

  // For the back-channel logout, under the same rule
  const jwksUri = jwksUriToFetch(discovered.serverMetadata().jwks_uri, provider.issuer);
  jwks = jwksUri ? createRemoteJWKSet(new URL(jwksUri)) : null;
  // Set last: a configuration means the provider is discovered
  config = discovered;

  console.log('OIDC: Discovered issuer %s', config.serverMetadata().issuer);

  return config;
}

function buildAuthUrl(state, nonce, codeChallenge) {
  const redirectUri = `${authConfig.baseUrl}/auth/callback`;

  return buildAuthorizationUrl(config, authorizationParameters({
    redirectUri,
    scopes: authConfig.provider.scopes,
    state,
    nonce,
    codeChallenge,
  }));
}

async function handleCallback(currentUrl, expectedState, expectedNonce, pkceCodeVerifier) {
  const tokens = await authorizationCodeGrant(config, currentUrl, {
    pkceCodeVerifier,
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
 * Verify a back-channel logout token (OpenID Connect Back-Channel Logout 1.0)
 * @param {string} logoutToken - The JWT logout token from the OP
 * @returns {Promise<{ sid: (string|undefined), sub: (string|undefined) }>} whose
 *   sessions end
 * @throws {Error} - If token validation fails
 */
async function verifyLogoutToken(logoutToken) {
  if (!config) {
    throw new Error('OIDC not initialized');
  }
  if (!jwks) {
    throw new Error('no jwks_uri to fetch: none, or an http:// one for an https:// issuer');
  }

  // jwtVerify checks the signature against the provider's JWKS, with an
  // algorithm of its ID tokens, the issuer, the audience (our client id), iat
  // (5 minutes old at most) and exp when present; then the claims of a logout
  // token: the back-channel logout event, a sid or a sub, and no nonce
  const { payload } = await jwtVerify(
    logoutToken,
    jwks,
    logoutTokenVerifyOptions(config.serverMetadata(), authConfig.provider.clientId)
  );

  return checkLogoutTokenClaims(payload);
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
