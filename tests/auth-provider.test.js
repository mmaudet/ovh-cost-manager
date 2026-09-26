/**
 * Tests for what the dashboard sends to the OIDC provider.
 */

const {
  authorizationParameters,
  plainHttpAllowed,
  plainHttpWarning,
  jwksUriToFetch,
} = require('../server/auth/provider');

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

// openid-client refuses plain HTTP unless allowed: only an http:// issuer,
// such as the provider of the demo stack, allows it
describe('plainHttpAllowed', () => {
  test.each(['http://auth.localhost', 'HTTP://auth.example.com', 'http://127.0.0.1:3902'])(
    'allows plain HTTP for the issuer %s',
    (issuer) => {
      expect(plainHttpAllowed(issuer)).toBe(true);
    }
  );

  test.each([
    'https://auth.example.com',
    'https://auth.example.com/realms/http://x',
    'auth.example.com',
    '',
    undefined,
  ])('refuses plain HTTP for the issuer %p', (issuer) => {
    expect(plainHttpAllowed(issuer)).toBe(false);
  });
});

describe('plainHttpWarning', () => {
  test('warns in production about an http:// issuer', () => {
    expect(plainHttpWarning('http://auth.example.com', 'production'))
      .toMatch(/^the issuer http:\/\/auth\.example\.com is plain HTTP/);
  });

  test.each([
    ['in development', 'http://auth.localhost', 'development'],
    ['without NODE_ENV', 'http://auth.localhost', undefined],
    ['about an https:// issuer', 'https://auth.example.com', 'production'],
  ])('says nothing %s', (label, issuer, nodeEnv) => {
    expect(plainHttpWarning(issuer, nodeEnv)).toBeNull();
  });
});

// jose fetches the keys for the back-channel logout, apart from openid-client:
// the same rule applies
describe('jwksUriToFetch', () => {
  test('fetches an https:// jwks_uri', () => {
    expect(jwksUriToFetch('https://auth.example.com/jwks', 'https://auth.example.com'))
      .toBe('https://auth.example.com/jwks');
  });

  test('fetches an http:// jwks_uri of an http:// issuer, as in the demo stack', () => {
    expect(jwksUriToFetch('http://auth.localhost/jwks', 'http://auth.localhost'))
      .toBe('http://auth.localhost/jwks');
  });

  test('refuses an http:// jwks_uri of an https:// issuer', () => {
    expect(jwksUriToFetch('http://auth.example.com/jwks', 'https://auth.example.com')).toBeNull();
  });

  test('gives nothing without jwks_uri', () => {
    expect(jwksUriToFetch(undefined, 'https://auth.example.com')).toBeNull();
  });
});
