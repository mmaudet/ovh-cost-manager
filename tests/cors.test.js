/**
 * Tests for the origin check of the CORS middleware.
 *
 * The dashboard's own origin must pass: Chromium sends an Origin header on the
 * page's module script and stylesheet, which Vite marks crossorigin, even
 * though they are same-origin (#76).
 */

const { isAllowedOrigin } = require('../server/cors');

// A production server with no listed origins, reached without a trusted proxy
const production = { trustProxy: false, allowedOrigins: [], isDev: false };

describe('isAllowedOrigin', () => {
  test('allows a request without an Origin header', () => {
    expect(isAllowedOrigin({ ...production, origin: undefined, host: 'ocm.example.com' }))
      .toBe(true);
  });

  test.each([
    ['http://localhost:3001', 'localhost:3001'],
    ['https://ocm.example.com', 'ocm.example.com'],
  ])('allows a same-origin request: %s with Host %s', (origin, host) => {
    expect(isAllowedOrigin({ ...production, origin, host })).toBe(true);
  });

  test('rejects an origin on another host', () => {
    expect(isAllowedOrigin({
      ...production,
      origin: 'https://evil.example',
      host: 'ocm.example.com',
    })).toBe(false);
  });

  test('rejects an origin on the same hostname but another port', () => {
    expect(isAllowedOrigin({
      ...production,
      origin: 'https://ocm.example.com:8443',
      host: 'ocm.example.com',
    })).toBe(false);
  });

  test.each(['ocm.example.com', 'null'])(
    'rejects the malformed Origin %s without throwing',
    (origin) => {
      expect(isAllowedOrigin({ ...production, origin, host: 'ocm.example.com' })).toBe(false);
    }
  );

  test('allows a listed origin on another host', () => {
    expect(isAllowedOrigin({
      ...production,
      allowedOrigins: ['https://reports.example.com'],
      origin: 'https://reports.example.com',
      host: 'ocm.example.com',
    })).toBe(true);
  });

  // The Vite dev server calls the API from another port
  test.each(['http://localhost:5173', 'http://127.0.0.1:5173'])(
    'allows %s in development',
    (origin) => {
      expect(isAllowedOrigin({ ...production, isDev: true, origin, host: 'localhost:3001' }))
        .toBe(true);
    }
  );

  test.each(['http://localhost:5173', 'http://127.0.0.1:5173'])(
    'rejects %s in production when it is not the request\'s own host',
    (origin) => {
      expect(isAllowedOrigin({ ...production, origin, host: 'localhost:3001' })).toBe(false);
    }
  );

  describe('behind a proxy that sets Host to the container', () => {
    // The page is on https://ocm.example.com, the proxy reaches the container by its name
    const proxied = {
      ...production,
      origin: 'https://ocm.example.com',
      host: 'ovh-cost-manager:3001',
    };

    test('allows the host of X-Forwarded-Host when the proxy is trusted', () => {
      expect(isAllowedOrigin({ ...proxied, trustProxy: true, forwardedHost: 'ocm.example.com' }))
        .toBe(true);
    });

    test('ignores X-Forwarded-Host when the proxy is not trusted', () => {
      expect(isAllowedOrigin({ ...proxied, trustProxy: false, forwardedHost: 'ocm.example.com' }))
        .toBe(false);
    });

    test('reads the first host of an X-Forwarded-Host list', () => {
      expect(isAllowedOrigin({
        ...proxied,
        trustProxy: true,
        forwardedHost: 'ocm.example.com, ocm.internal',
      })).toBe(true);
    });

    test('rejects the origin when the trusted proxy sends no X-Forwarded-Host', () => {
      expect(isAllowedOrigin({ ...proxied, trustProxy: true, forwardedHost: undefined }))
        .toBe(false);
    });
  });
});
