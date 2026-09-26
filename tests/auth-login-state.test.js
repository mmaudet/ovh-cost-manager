/**
 * Tests for the binding of a sign-in to the browser that started it: the
 * callback accepts a state only with the login cookie that holds it, so that
 * a callback URL opened in another browser, as in a login CSRF, is refused.
 */

const {
  LOGIN_MAX_AGE_MS,
  MAX_PENDING_SIGN_INS,
  encodeLoginState,
  readLoginState,
  loginCookie,
  staleLoginCookies,
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
    expect(readLoginState(signValue(payload, SECRET, 'login'), 'state-of-browser-a', SECRET, NOW))
      .toBeNull();
  });
});

// The cookie as a browser could send it back altered: its payload is readable
// base64url JSON, but any change breaks its signature
describe('a tampered sign-in cookie', () => {
  const [PAYLOAD, SIGNATURE] = COOKIE.split('.');
  const pending = JSON.parse(Buffer.from(PAYLOAD, 'base64url').toString());
  const withPayload = (changes) => `${Buffer.from(JSON.stringify({ ...pending, ...changes }))
    .toString('base64url')}.${SIGNATURE}`;
  const flipped = SIGNATURE.endsWith('A') ? 'B' : 'A';

  test.each([
    ['a character of its signature changed', `${PAYLOAD}.${SIGNATURE.slice(0, -1)}${flipped}`],
    ['its signature cut short', `${PAYLOAD}.${SIGNATURE.slice(0, 20)}`],
    ['no signature', PAYLOAD],
    ['its expiry pushed back, its signature kept', withPayload({ expiresAt: NOW + 86400000 })],
    ['another returnTo, its signature kept', withPayload({ returnTo: 'https://evil.example/' })],
    ['another code_verifier, its signature kept', withPayload({ codeVerifier: 'mine' })],
    ['its payload signed for the session cookie', signValue(PAYLOAD, SECRET, 'session')],
  ])('is refused with %s', (label, cookie) => {
    expect(readLoginState(cookie, 'state-of-browser-a', SECRET, NOW)).toBeNull();
  });

  test('is read untouched', () => {
    expect(readLoginState(COOKIE, 'state-of-browser-a', SECRET, NOW)).not.toBeNull();
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

// Each visit of /auth/login sets a cookie for 10 minutes: without a bound, a
// page that opens it again and again grows the Cookie header until the
// server, or a proxy, refuses every request of the dashboard
describe('staleLoginCookies', () => {
  const auth = {
    baseUrl: 'http://ocm.example.com',
    session: { secure: 'auto', secret: SECRET },
  };
  const AT = NOW + 60 * 1000;
  // The cookie of the sign-in of state n, started n seconds after NOW
  const cookieOf = (n, prefix = 'ocm.login.') => [
    `${prefix}state-${n}`,
    encodeLoginState({ ...PENDING, state: `state-${n}` }, SECRET, NOW + n * 1000),
  ];
  const request = (cookies, secure = false) => ({ secure, cookies: Object.fromEntries(cookies) });
  const names = (stale) => stale.map(({ name }) => name).sort();

  test('keeps three sign-ins in progress at most, the new one included', () => {
    expect(MAX_PENDING_SIGN_INS).toBe(3);
  });

  test('clears all but the two newest, for the new sign-in to make three', () => {
    const cookies = [1, 2, 3, 4, 5].map((n) => cookieOf(n));
    expect(names(staleLoginCookies(request(cookies), auth, AT)))
      .toEqual(['ocm.login.state-1', 'ocm.login.state-2', 'ocm.login.state-3']);
  });

  test('clears nothing with two sign-ins in progress', () => {
    expect(staleLoginCookies(request([cookieOf(1), cookieOf(2)]), auth, AT)).toEqual([]);
  });

  test('tells the newest by the expiry the cookies hold, whatever their order', () => {
    const cookies = [cookieOf(4), cookieOf(1), cookieOf(3), cookieOf(2)];
    expect(names(staleLoginCookies(request(cookies), auth, AT)))
      .toEqual(['ocm.login.state-1', 'ocm.login.state-2']);
  });

  // A browser sends the cookies of one path oldest first
  test('tells two sign-ins of the same millisecond by their order', () => {
    const cookies = ['a', 'b', 'c'].map((state) => [
      `ocm.login.${state}`,
      encodeLoginState({ ...PENDING, state }, SECRET, NOW),
    ]);
    expect(names(staleLoginCookies(request(cookies), auth, AT))).toEqual(['ocm.login.a']);
  });

  test('clears the cookies that no callback would accept', () => {
    const [, ofState1] = cookieOf(1);
    const cookies = [
      ['ocm.login.expired', encodeLoginState({ ...PENDING, state: 'expired' }, SECRET,
        AT - LOGIN_MAX_AGE_MS)],
      ['ocm.login.foreign', encodeLoginState({ ...PENDING, state: 'foreign' },
        'another-secret-another-secret-12', NOW)],
      ['ocm.login.state-9', ofState1],
      ['ocm.login.garbage', 'garbage'],
    ];
    expect(names(staleLoginCookies(request(cookies), auth, AT))).toEqual([
      'ocm.login.expired',
      'ocm.login.foreign',
      'ocm.login.garbage',
      'ocm.login.state-9',
    ]);
  });

  test('leaves alone the cookies that are not sign-in cookies', () => {
    const cookies = [
      ['ocm.sid', 'x'],
      ['__Host-ocm.sid', 'x'],
      ['another.app', 'x'],
      ['ocm.login.', 'x'],
      ['ocm.login.a b', 'x'],
      ['ocm.login.a;b', 'x'],
    ];
    expect(staleLoginCookies(request(cookies), auth, AT)).toEqual([]);
    expect(staleLoginCookies({ secure: false }, auth, AT)).toEqual([]);
  });

  test('clears the plain cookies on /auth, over HTTP', () => {
    const cookies = [1, 2, 3].map((n) => cookieOf(n));
    expect(staleLoginCookies(request(cookies), auth, AT)).toEqual([{
      name: 'ocm.login.state-1',
      options: { httpOnly: true, secure: false, sameSite: 'lax', path: '/auth' },
    }]);
  });

  test('clears the __Host- cookies, Secure, on Path=/, over HTTPS', () => {
    const cookies = [1, 2, 3].map((n) => cookieOf(n, '__Host-ocm.login.'));
    expect(staleLoginCookies(request(cookies, true), auth, AT)).toEqual([{
      name: '__Host-ocm.login.state-1',
      options: { httpOnly: true, secure: true, sameSite: 'lax', path: '/' },
    }]);
  });
});
