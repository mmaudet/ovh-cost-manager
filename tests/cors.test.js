/**
 * Tests for the origin check of the CORS middleware.
 *
 * The dashboard's own origin must pass: Chromium sends an Origin header on the
 * page's module script and stylesheet, which Vite marks crossorigin, even
 * though they are same-origin (#76).
 */

const { createOriginCheck } = require('../server/cors');

// Built as the server builds it at startup: in production, with no listed
// origins, and without a trusted proxy unless the check's name says otherwise
const settings = { allowedOrigins: [], isDev: false, trustProxy: false };
const production = createOriginCheck(settings);
const development = createOriginCheck({ ...settings, isDev: true });
const behindTrustedProxy = createOriginCheck({ ...settings, trustProxy: true });

describe('createOriginCheck', () => {
  test('allows a request without an Origin header', () => {
    expect(production(undefined, { host: 'ocm.example.com' })).toBe(true);
  });

  test.each([
    ['http://localhost:3001', 'localhost:3001'],
    ['https://ocm.example.com', 'ocm.example.com'],
  ])('allows a same-origin request: %s with Host %s', (origin, host) => {
    expect(production(origin, { host })).toBe(true);
  });

  test('rejects an origin on another host', () => {
    expect(production('https://evil.example', { host: 'ocm.example.com' })).toBe(false);
  });

  test('rejects an origin on the same hostname but another port', () => {
    expect(production('https://ocm.example.com:8443', { host: 'ocm.example.com' })).toBe(false);
  });

  test.each(['ocm.example.com', 'null'])(
    'rejects the malformed Origin %s without throwing',
    (origin) => {
      expect(production(origin, { host: 'ocm.example.com' })).toBe(false);
    }
  );

  test('allows a listed origin on another host', () => {
    const check = createOriginCheck({
      ...settings,
      allowedOrigins: ['https://reports.example.com'],
    });
    expect(check('https://reports.example.com', { host: 'ocm.example.com' })).toBe(true);
  });

  // The Vite dev server calls the API from another port
  test.each(['http://localhost:5173', 'http://127.0.0.1:5173', 'http://[::1]:5173'])(
    'allows %s in development',
    (origin) => {
      expect(development(origin, { host: 'localhost:3001' })).toBe(true);
    }
  );

  test.each(['http://localhost.evil.example', 'https://notlocalhost.com'])(
    'rejects %s in development, as its hostname is not localhost',
    (origin) => {
      expect(development(origin, { host: 'localhost:3001' })).toBe(false);
    }
  );

  test.each(['http://localhost:5173', 'http://127.0.0.1:5173'])(
    'rejects %s in production when it is not the request\'s own host',
    (origin) => {
      expect(production(origin, { host: 'localhost:3001' })).toBe(false);
    }
  );

  describe('behind a proxy that sets Host to the container', () => {
    // The page is on https://ocm.example.com, the proxy reaches the container by its name
    const origin = 'https://ocm.example.com';
    const proxied = { host: 'ovh-cost-manager:3001', forwardedHost: 'ocm.example.com' };

    test('allows the host of X-Forwarded-Host when the proxy is trusted', () => {
      expect(behindTrustedProxy(origin, proxied)).toBe(true);
    });

    test('ignores X-Forwarded-Host when the proxy is not trusted', () => {
      expect(production(origin, proxied)).toBe(false);
    });

    test('reads the first host of an X-Forwarded-Host list', () => {
      expect(behindTrustedProxy(origin, {
        ...proxied,
        forwardedHost: 'ocm.example.com, ocm.internal',
      })).toBe(true);
    });

    test('rejects the origin when the trusted proxy sends no X-Forwarded-Host', () => {
      expect(behindTrustedProxy(origin, { host: 'ovh-cost-manager:3001' })).toBe(false);
    });
  });
});
