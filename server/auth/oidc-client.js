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
  ClientError,
  ResponseBodyError,
  AuthorizationResponseError,
  WWWAuthenticateChallengeError,
} = require('openid-client');
// openid-client v6 validates no logout token: jose, the JOSE library it is
// built on, verifies them
const { createRemoteJWKSet, jwtVerify } = require('jose');
const {
  logoutTokenVerifyOptions,
  checkLogoutTokenClaims,
  replayWindowEnd,
  createReplayGuard,
} = require('./logout-token');
const {
  authorizationParameters,
  endSessionParameters,
  plainHttpAllowed,
  jwksUriToFetch,
} = require('./provider');

let config = null;
let authConfig = null;
// The provider's signing keys, fetched from its jwks_uri when a token needs them
let jwks = null;
// The logout tokens accepted, by jti, until they expire
const replayGuard = createReplayGuard();

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
    idTokenExpected: true,
  });

  return tokens;
}

/**
 * Whether a sign-in failed on the provider's side, not the server's: the
 * provider refused the code, as for a replayed callback, or the consent, or
 * its answer failed a check, as an ID token with another nonce. The user can
 * sign in again.
 *
 * @param {Error} err - what the callback's exchange threw
 * @returns {boolean}
 */
function isRefusedSignIn(err) {
  return err instanceof ClientError
    || err instanceof ResponseBodyError
    || err instanceof AuthorizationResponseError
    || err instanceof WWWAuthenticateChallengeError;
}

async function getUserInfo(accessToken, expectedSub) {
  return await fetchUserInfo(config, accessToken, expectedSub);
}

function getEndSessionUrl(idToken) {
  if (!config.serverMetadata().end_session_endpoint) {
    return null;
  }

  return buildEndSessionUrl(config, endSessionParameters(idToken, authConfig.baseUrl));
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
  // (5 minutes old at most), exp and jti; then the claims of a logout token:
  // the back-channel logout event, a sid or a sub, and no nonce
  const { payload } = await jwtVerify(
    logoutToken,
    jwks,
    logoutTokenVerifyOptions(config.serverMetadata(), authConfig.provider.clientId)
  );
  const claims = checkLogoutTokenClaims(payload);

  // Last, once the token is known valid, so that no forged token can use up
  // a jti
  if (!replayGuard.firstUse(claims.jti, replayWindowEnd(payload))) {
    throw new Error(`replay of the token ${claims.jti}`);
  }
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
  verifyLogoutToken,
  isRefusedSignIn,
};
