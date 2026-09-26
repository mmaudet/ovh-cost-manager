/**
 * What the dashboard sends to the OIDC provider, apart from openid-client,
 * which Jest cannot load.
 */

/**
 * The parameters of the authorization request. With PKCE (RFC 7636), the
 * token request must prove, with the code_verifier of this challenge, that it
 * comes from the sign-in that started it.
 *
 * @param {object} request
 * @param {string} request.redirectUri - the callback URL
 * @param {string[]} request.scopes
 * @param {string} request.state
 * @param {string} request.nonce
 * @param {string} request.codeChallenge - the S256 challenge of the code_verifier
 * @returns {object}
 */
function authorizationParameters({ redirectUri, scopes, state, nonce, codeChallenge }) {
  return {
    redirect_uri: redirectUri,
    scope: scopes.join(' '),
    state,
    nonce,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  };
}

/**
 * Whether the provider may be reached over plain HTTP: only when the issuer is
 * an http:// URL, as in the demo stack. openid-client otherwise refuses every
 * http:// URL, those of the endpoints the discovery lists included.
 *
 * @param {string} issuer - OIDC_ISSUER
 * @returns {boolean}
 */
function plainHttpAllowed(issuer) {
  return /^http:\/\//i.test(issuer ?? '');
}

/**
 * A warning when, in production, the issuer is plain HTTP.
 *
 * @param {string} issuer - OIDC_ISSUER
 * @param {string} [nodeEnv] - NODE_ENV
 * @returns {string|null} the warning, or null
 */
function plainHttpWarning(issuer, nodeEnv) {
  if (nodeEnv !== 'production' || !plainHttpAllowed(issuer)) {
    return null;
  }
  return `the issuer ${issuer} is plain HTTP: codes, tokens and signing keys travel `
    + 'unencrypted, anyone on the way can read or change them. Use an https:// issuer';
}

/**
 * The jwks_uri from which jose may fetch the provider's keys, for the
 * back-channel logout: under the rule openid-client follows for its own
 * requests, https://, or http:// for an http:// issuer only.
 *
 * @param {string} [jwksUri] - the provider's jwks_uri
 * @param {string} issuer - OIDC_ISSUER
 * @returns {string|null} the URL, or null
 */
function jwksUriToFetch(jwksUri, issuer) {
  if (!jwksUri) {
    return null;
  }
  return /^https:\/\//i.test(jwksUri) || plainHttpAllowed(issuer) ? jwksUri : null;
}

module.exports = {
  authorizationParameters,
  plainHttpAllowed,
  plainHttpWarning,
  jwksUriToFetch,
};
