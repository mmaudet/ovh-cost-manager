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

module.exports = { authorizationParameters };
