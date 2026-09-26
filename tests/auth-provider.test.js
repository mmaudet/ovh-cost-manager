/**
 * Tests for what the dashboard sends to the OIDC provider.
 */

const { authorizationParameters } = require('../server/auth/provider');

describe('authorizationParameters', () => {
  test('asks the provider for PKCE with S256', () => {
    expect(authorizationParameters({
      redirectUri: 'https://ocm.example.com/auth/callback',
      scopes: ['openid', 'profile', 'email'],
      state: 'state-of-browser-a',
      nonce: 'nonce-of-browser-a',
      codeChallenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    })).toEqual({
      redirect_uri: 'https://ocm.example.com/auth/callback',
      scope: 'openid profile email',
      state: 'state-of-browser-a',
      nonce: 'nonce-of-browser-a',
      code_challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
      code_challenge_method: 'S256',
    });
  });
});
