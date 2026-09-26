/**
 * Tests for the session cookie of OIDC sign-in. Its Secure flag follows the
 * request's scheme: a browser does not store a Secure cookie from an http://
 * page, so a Secure cookie on an HTTP stack made the sign-in loop.
 */

const crypto = require('crypto');
const {
  cookieSecure,
  sessionCookieOptions,
  sessionCookie,
  signValue,
  unsignValue,
  sessionSecretWarning,
} = require('../server/auth/session-cookie');

const HTTP_BASE_URL = 'http://ocm.example.com';
const HTTPS_BASE_URL = 'https://ocm.example.com';

// req.secure, as Express sets it: true over HTTPS, as the connection says or,
// with TRUST_PROXY, the X-Forwarded-Proto of the proxy
const overHttp = { secure: false };
const overHttps = { secure: true };

describe('cookieSecure, by default (auto)', () => {
  test('leaves the flag off over plain HTTP, so that sign-in works on an HTTP stack', () => {
    expect(cookieSecure(overHttp, 'auto', HTTP_BASE_URL)).toBe(false);
  });

  test('sets the flag over HTTPS', () => {
    expect(cookieSecure(overHttps, 'auto', HTTP_BASE_URL)).toBe(true);
  });

  // The callback, which sets the cookie, is on the base URL: over HTTPS when it
  // is https, even when a proxy that is not trusted makes req.secure false
  test.each([HTTPS_BASE_URL, 'HTTPS://ocm.example.com'])(
    'sets the flag when the base URL is %s, whatever req.secure says',
    (baseUrl) => {
      expect(cookieSecure(overHttp, 'auto', baseUrl)).toBe(true);
    }
  );
});

describe('cookieSecure, set explicitly', () => {
  test.each([
    [overHttp, HTTP_BASE_URL],
    [overHttps, HTTPS_BASE_URL],
  ])('sets the flag with true: request %j, base URL %s', (req, baseUrl) => {
    expect(cookieSecure(req, true, baseUrl)).toBe(true);
  });

  test.each([
    [overHttp, HTTP_BASE_URL],
    [overHttps, HTTPS_BASE_URL],
  ])('leaves the flag off with false: request %j, base URL %s', (req, baseUrl) => {
    expect(cookieSecure(req, false, baseUrl)).toBe(false);
  });
});

describe('sessionCookieOptions', () => {
  const auth = { baseUrl: HTTP_BASE_URL, session: { secure: 'auto' } };

  test('keeps the cookie HttpOnly and SameSite=Lax', () => {
    expect(sessionCookieOptions(overHttp, auth)).toEqual({
      httpOnly: true,
      secure: false,
      sameSite: 'lax',
    });
  });

  test('sets Secure over HTTPS', () => {
    expect(sessionCookieOptions(overHttps, auth).secure).toBe(true);
  });

  test('follows the setting', () => {
    const forced = { ...auth, session: { secure: true } };
    expect(sessionCookieOptions(overHttp, forced).secure).toBe(true);
  });
});

// A sibling host can plant a plain ocm.sid for the whole domain, on Path=/api,
// which the browser then sends first. A browser accepts a __Host- cookie only
// Secure, from the host itself, without Domain and on Path=/
describe('sessionCookie', () => {
  const auth = { baseUrl: HTTP_BASE_URL, session: { name: 'ocm.sid', secure: 'auto' } };

  test('is __Host-ocm.sid, Secure, on Path=/, over HTTPS', () => {
    expect(sessionCookie(overHttps, auth)).toEqual({
      name: '__Host-ocm.sid',
      options: { httpOnly: true, secure: true, sameSite: 'lax', path: '/' },
    });
  });

  // Browsers refuse a __Host- cookie without Secure
  test('keeps its plain name over plain HTTP', () => {
    expect(sessionCookie(overHttp, auth)).toEqual({
      name: 'ocm.sid',
      options: { httpOnly: true, secure: false, sameSite: 'lax', path: '/' },
    });
  });

  test('is __Host- whenever the cookie is Secure', () => {
    expect(sessionCookie(overHttp, { ...auth, baseUrl: HTTPS_BASE_URL }).name)
      .toBe('__Host-ocm.sid');
    expect(sessionCookie(overHttp, { ...auth, session: { name: 'ocm.sid', secure: true } }).name)
      .toBe('__Host-ocm.sid');
    expect(sessionCookie(overHttps, { ...auth, session: { name: 'ocm.sid', secure: false } }))
      .toMatchObject({ name: 'ocm.sid', options: { secure: false } });
  });

  test('prefixes the name that auth.session.name sets', () => {
    expect(sessionCookie(overHttps, { ...auth, session: { name: 'sid', secure: 'auto' } }).name)
      .toBe('__Host-sid');
  });
});

// The cookie holds the session id signed with SESSION_SECRET: a session id
// alone, as the sessions table stores it, is not a valid cookie
describe('signValue and unsignValue, on the session id', () => {
  const SECRET = '0123456789abcdef0123456789abcdef';
  const SID = 'c9b5b670-72c2-4b5d-a30b-c623b2d0a777';
  // HMAC-SHA256 of the purpose, a colon and SID under SECRET, in base64url,
  // computed apart with:
  // printf %s "session:$SID" | openssl dgst -sha256 -hmac "$SECRET" -binary \
  //   | base64 | tr +/ -_ | tr -d =
  const SIGNATURE = 'jdJcFvsHYQBOlQbPXgQv8lc8A33Mfuq8lbNlPv6TbP4';
  const COOKIE = `${SID}.${SIGNATURE}`;

  test('appends the HMAC-SHA256 of its purpose and the session id to it', () => {
    expect(signValue(SID, SECRET, 'session')).toBe(COOKIE);
  });

  test('reads the session id back', () => {
    expect(unsignValue(COOKIE, SECRET, 'session')).toBe(SID);
  });

  test('refuses a bare session id, as the cookies of 2.4.0 hold', () => {
    expect(unsignValue(SID, SECRET, 'session')).toBeNull();
  });

  test('refuses the cookie under another secret', () => {
    expect(unsignValue(COOKIE, 'another-secret-another-secret-12', 'session')).toBeNull();
  });

  // A value signed for the sign-in cookie is no session, and the other way
  test('refuses a value signed for another purpose', () => {
    expect(unsignValue(signValue(SID, SECRET, 'login'), SECRET, 'session')).toBeNull();
    expect(unsignValue(COOKIE, SECRET, 'login')).toBeNull();
  });

  test.each([undefined, '', 'a:b'])('requires a purpose without colon, not %p', (purpose) => {
    expect(() => signValue(SID, SECRET, purpose)).toThrow('purpose');
    expect(() => unsignValue(COOKIE, SECRET, purpose)).toThrow('purpose');
  });

  test.each([
    ['an altered signature', `${SID}.${SIGNATURE.slice(0, -1)}A`],
    ['an empty signature', `${SID}.`],
    ['a shorter signature', `${SID}.${SIGNATURE.slice(0, -1)}`],
    ['a longer signature', `${COOKIE}A`],
    ['another session id', `d0000000-72c2-4b5d-a30b-c623b2d0a777.${SIGNATURE}`],
    ['no session id', `.${SIGNATURE}`],
    ['the signature alone', SIGNATURE],
  ])('refuses %s', (label, value) => {
    expect(unsignValue(value, SECRET, 'session')).toBeNull();
  });

  test.each([undefined, null, '', 42, [COOKIE]])(
    'refuses %p, which is no cookie value',
    (value) => {
      expect(unsignValue(value, SECRET, 'session')).toBeNull();
    }
  );

  test('compares the signatures in constant time', () => {
    const timingSafeEqual = jest.spyOn(crypto, 'timingSafeEqual');
    try {
      unsignValue(`${SID}.${SIGNATURE.slice(0, -1)}A`, SECRET, 'session');
      expect(timingSafeEqual).toHaveBeenCalledTimes(1);
    } finally {
      timingSafeEqual.mockRestore();
    }
  });
});

describe('sessionSecretWarning', () => {
  test.each([
    // The defaults of docker-compose.sso.yml and config.example.json
    'change-me-in-production',
    'CHANGE_THIS_TO_A_RANDOM_SECRET',
    'short',
  ])('warns about %s, shorter than 32 characters', (secret) => {
    expect(sessionSecretWarning(secret)).toMatch(/at least 32 characters/);
  });

  test('says nothing about 32 characters or more', () => {
    // openssl rand -hex 32
    const secret = '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08';
    expect(sessionSecretWarning(secret)).toBeNull();
    expect(sessionSecretWarning('0123456789abcdef0123456789abcdef')).toBeNull();
  });
});
