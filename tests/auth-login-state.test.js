/**
 * Tests for the binding of a sign-in to the browser that started it: the
 * callback accepts a state only with the login cookie that holds it, so that
 * a callback URL opened in another browser, as in a login CSRF, is refused.
 */

const {
  LOGIN_MAX_AGE_MS,
  encodeLoginState,
  readLoginState,
  loginCookie,
} = require('../server/auth/login-state');
const { signValue } = require('../server/auth/session-cookie');

const SECRET = '0123456789abcdef0123456789abcdef';
const NOW = Date.UTC(2026, 8, 26, 12, 0, 0);
const PENDING = {
  state: 'state-of-browser-a',
  nonce: 'nonce-of-browser-a',
  codeVerifier: 'verifier-of-browser-a',
  returnTo: '/dashboard',
};
const COOKIE = encodeLoginState(PENDING, SECRET, NOW);

describe('readLoginState', () => {
  test('gives the nonce, the code_verifier and where to go back for the cookie\'s state', () => {
    expect(readLoginState(COOKIE, 'state-of-browser-a', SECRET, NOW + 60 * 1000)).toEqual({
      nonce: 'nonce-of-browser-a',
      codeVerifier: 'verifier-of-browser-a',
      returnTo: '/dashboard',
    });
  });

  test('refuses a callback without the login cookie', () => {
    expect(readLoginState(undefined, 'state-of-browser-a', SECRET, NOW)).toBeNull();
  });

  test('refuses the state of a sign-in that another browser started', () => {
    expect(readLoginState(COOKIE, 'state-of-browser-b', SECRET, NOW)).toBeNull();
  });

  test.each([
    ['no state', undefined],
    ['an empty state', ''],
    ['a repeated state parameter', ['state-of-browser-a', 'state-of-browser-b']],
  ])('refuses a callback with %s', (label, state) => {
    expect(readLoginState(COOKIE, state, SECRET, NOW)).toBeNull();
  });

  test('refuses the cookie once its 10 minutes are over, whatever the browser says', () => {
    expect(readLoginState(COOKIE, 'state-of-browser-a', SECRET, NOW + LOGIN_MAX_AGE_MS))
      .toBeNull();
  });

  test('refuses a cookie signed with another secret', () => {
    const other = encodeLoginState(PENDING, 'another-secret-another-secret-12', NOW);
    expect(readLoginState(other, 'state-of-browser-a', SECRET, NOW)).toBeNull();
  });

  test('refuses a cookie whose content was changed', () => {
    const [, signature] = COOKIE.split('.');
    const [payload] = encodeLoginState({ ...PENDING, state: 'state-of-browser-b' }, SECRET, NOW)
      .split('.');
    expect(readLoginState(`${payload}.${signature}`, 'state-of-browser-b', SECRET, NOW))
      .toBeNull();
  });

  test.each([
    ['text that is no JSON', 'not-json'],
    ['JSON that is no object', Buffer.from('"state-of-browser-a"').toString('base64url')],
  ])('refuses a signed cookie holding %s', (label, payload) => {
    expect(readLoginState(signValue(payload, SECRET), 'state-of-browser-a', SECRET, NOW))
      .toBeNull();
  });
});

// One cookie per state, so that two sign-ins in one browser clear only their
// own. SameSite=Lax: the browser sends it with the provider's redirect back, a
// top-level GET, but not with requests other sites make
describe('loginCookie', () => {
  const STATE = 'Wv9qS3KxI0bM1a2c-_Zz8Y7x6W5v4U3t2S1r0Q9p8O7';
  const overHttp = { secure: false };
  const overHttps = { secure: true };
  const auth = { baseUrl: 'http://ocm.example.com', session: { secure: 'auto' } };

  test('is named after the state, HttpOnly and SameSite=Lax, on /auth, over HTTP', () => {
    expect(loginCookie(overHttp, auth, STATE)).toEqual({
      name: `ocm.login.${STATE}`,
      options: { httpOnly: true, secure: false, sameSite: 'lax', path: '/auth' },
    });
  });

  // __Host-: browsers accept it from this host only, over HTTPS, with Path=/
  // and no Domain, so that no sibling host nor HTTP page can set one
  test('takes the __Host- prefix over HTTPS, which requires Secure and Path=/', () => {
    expect(loginCookie(overHttps, auth, STATE)).toEqual({
      name: `__Host-ocm.login.${STATE}`,
      options: { httpOnly: true, secure: true, sameSite: 'lax', path: '/' },
    });
  });

  test('takes the __Host- prefix when the base URL is https', () => {
    const httpsBase = { ...auth, baseUrl: 'https://ocm.example.com' };
    expect(loginCookie(overHttp, httpsBase, STATE).name).toBe(`__Host-ocm.login.${STATE}`);
  });

  test('keeps a plain name when COOKIE_SECURE=false leaves out Secure', () => {
    const notSecure = { ...auth, session: { secure: false } };
    expect(loginCookie(overHttps, notSecure, STATE)).toMatchObject({
      name: `ocm.login.${STATE}`,
      options: { secure: false, path: '/auth' },
    });
  });

  test.each([
    ['no state', undefined],
    ['an empty state', ''],
    ['a repeated state parameter', [STATE, STATE]],
    ['a state with a semicolon', 'a;b'],
    ['a state with an equals sign', 'a=b'],
    ['a state too long for a sign-in', 'x'.repeat(129)],
  ])('is none for %s', (label, state) => {
    expect(loginCookie(overHttp, auth, state)).toBeNull();
  });

  test('gives the cookie 10 minutes', () => {
    expect(LOGIN_MAX_AGE_MS).toBe(10 * 60 * 1000);
  });
});
