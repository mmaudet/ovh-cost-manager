/**
 * Tests for the session cookie of OIDC sign-in. Its Secure flag follows the
 * request's scheme: a browser does not store a Secure cookie from an http://
 * page, so a Secure cookie on an HTTP stack made the sign-in loop.
 */

const { cookieSecure, sessionCookieOptions } = require('../server/auth/session-cookie');

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
