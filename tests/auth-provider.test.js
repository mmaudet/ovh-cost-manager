/**
 * Tests for what the dashboard sends to the OIDC provider.
 */

const {
  authorizationParameters,
  endSessionParameters,
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

describe('endSessionParameters', () => {
  const BASE_URL = 'https://ocm.example.com';

  test('gives the ID token of the session as id_token_hint', () => {
    expect(endSessionParameters('eyJ.payload.signature', BASE_URL)).toEqual({
      id_token_hint: 'eyJ.payload.signature',
      post_logout_redirect_uri: BASE_URL,
    });
  });

  // Logging out without a session, or a session without an ID token
  test.each([null, undefined, ''])('leaves id_token_hint out for %p', (idToken) => {
    expect(endSessionParameters(idToken, BASE_URL))
      .toStrictEqual({ post_logout_redirect_uri: BASE_URL });
  });

  // openid-client writes the parameters through URLSearchParams, where null
  // and undefined become the text "null" and "undefined"
  test.each([null, undefined])('puts no id_token_hint in the URL for %p', (idToken) => {
    expect(new URLSearchParams(endSessionParameters(idToken, BASE_URL)).toString())
      .toBe('post_logout_redirect_uri=https%3A%2F%2Focm.example.com');
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
