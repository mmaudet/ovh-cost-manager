/**
 * Tests for the origin check, and for its middleware, which runs before the
 * CORS one.
 *
 * The dashboard's own origin must pass: Chromium sends an Origin header on the
 * page's module script and stylesheet, which Vite marks crossorigin, even
 * though they are same-origin (#76).
 */

const express = require('express');
const {
  createOriginCheck,
  createOriginCheckMiddleware,
  readAllowedOrigins,
} = require('../server/cors');
const { serve } = require('./support/http');

// Built as the server builds it at startup, with trustProxy the number of
// proxies it trusts: in production, with no listed origins, and trusting none
// unless the check's name says otherwise
const settings = { allowedOrigins: [], isDev: false, trustProxy: 0 };
const production = createOriginCheck(settings);
const development = createOriginCheck({ ...settings, isDev: true });
const behindTrustedProxy = createOriginCheck({ ...settings, trustProxy: 1 });

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

  // Hosts compare as URL writes them: lowercase, without the scheme's default port
  test.each([
    ['https://ocm.example.com', 'ocm.example.com:443'],
    ['https://ocm.example.com', 'OCM.example.com'],
    // What the LemonLDAP relay of docker-compose.sso.yml sends
    ['http://ocm.example.com', 'ocm.example.com:80'],
    // What the same relay passes behind a TLS terminator: the port it listens
    // on, 80, which an https origin on its default port matches too
    ['https://ocm.example.com', 'ocm.example.com:80'],
    // The same with an IPv6 address, which URL writes in brackets
    ['https://[2001:db8::1]', '[2001:db8::1]:80'],
  ])('allows %s with Host %s', (origin, host) => {
    expect(production(origin, { host })).toBe(true);
  });

  // Other ports and other hostnames still differ: port 80 stands only for the
  // default port of an https origin, on its own hostname
  test.each([
    ['https://ocm.example.com:8443', 'ocm.example.com'],
    ['https://ocm.example.com:8443', 'ocm.example.com:80'],
    ['https://ocm.example.com', 'ocm.example.com:8080'],
    // The https port: an http page can be a network attacker's
    ['http://ocm.example.com', 'ocm.example.com:443'],
    ['https://evil.example', 'ocm.example.com:80'],
    ['https://ocm.example.com', 'evil.example:80'],
    ['https://ocm.example.com', 'ocm.example.com.evil.example:80'],
  ])('rejects %s with Host %s', (origin, host) => {
    expect(production(origin, { host })).toBe(false);
  });

  test('rejects an origin when the request has no Host header, not reading it as a host', () => {
    expect(production('http://undefined', {})).toBe(false);
  });

  // As the Host check reads it: URL alone would read the host after the user
  test('rejects an origin when the request\'s Host is malformed', () => {
    expect(production('http://ocm.example.com', { host: 'user@ocm.example.com' })).toBe(false);
  });

  // 'ocm.example.com:3001' parses, but as the scheme 'ocm.example.com:' without a host
  test.each(['ocm.example.com', 'ocm.example.com:3001', 'null'])(
    'rejects the malformed Origin %s without throwing',
    (origin) => {
      expect(production(origin, { host: 'ocm.example.com' })).toBe(false);
    }
  );

  test('rejects a non-HTTP origin on the request\'s own host', () => {
    expect(production('ftp://ocm.example.com', { host: 'ocm.example.com' })).toBe(false);
  });

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

  test('rejects a non-HTTP origin on localhost in development', () => {
    expect(development('tauri://localhost', { host: 'localhost:3001' })).toBe(false);
  });

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

    test('compares X-Forwarded-Host as it compares Host', () => {
      expect(behindTrustedProxy(origin, { ...proxied, forwardedHost: 'OCM.example.com:443' }))
        .toBe(true);
    });

    test('allows the origin with X-Forwarded-Host on port 80, as with Host', () => {
      expect(behindTrustedProxy(origin, { ...proxied, forwardedHost: 'ocm.example.com:80' }))
        .toBe(true);
    });

    // As the Host check reads it: the last host is the one the nearest proxy
    // set or appended, where a client may have sent the others
    test('reads the last host of an X-Forwarded-Host list', () => {
      expect(behindTrustedProxy(origin, {
        ...proxied,
        forwardedHost: 'ocm.internal, ocm.example.com',
      })).toBe(true);
    });

    test('does not take the first host of a list, which a client may send, as its own', () => {
      expect(behindTrustedProxy('https://evil.example', {
        ...proxied,
        forwardedHost: 'evil.example, ocm.example.com',
      })).toBe(false);
    });

    test('rejects the origin when the trusted proxy sends no X-Forwarded-Host', () => {
      expect(behindTrustedProxy(origin, { host: 'ovh-cost-manager:3001' })).toBe(false);
    });
  });

  // Behind a TLS-terminating proxy, the connection is plain HTTP whatever the
  // page's scheme: the server only knows the scheme from the X-Forwarded-Proto of
  // a trusted proxy, or from a TLS connection, and compares hosts only otherwise
  describe('scheme', () => {
    const host = 'ocm.example.com';

    test('rejects an http page on https behind a trusted proxy', () => {
      expect(behindTrustedProxy('http://ocm.example.com', { host, forwardedProto: 'https' }))
        .toBe(false);
    });

    test('allows an https page on https behind a trusted proxy', () => {
      expect(behindTrustedProxy('https://ocm.example.com', { host, forwardedProto: 'https' }))
        .toBe(true);
    });

    // Even when the host matches, here only through X-Forwarded-Host on port 80
    test('rejects an https page on http behind a trusted proxy', () => {
      expect(behindTrustedProxy('https://ocm.example.com', {
        host: 'ovh-cost-manager:3001',
        forwardedHost: 'ocm.example.com:80',
        forwardedProto: 'http',
      })).toBe(false);
    });

    test('reads the first scheme of an X-Forwarded-Proto list', () => {
      expect(behindTrustedProxy('https://ocm.example.com', {
        host,
        forwardedProto: 'https, http',
      })).toBe(true);
    });

    test('rejects an http page on a TLS connection', () => {
      expect(production('http://ocm.example.com', { host, encrypted: true })).toBe(false);
    });

    test('allows an https page on a TLS connection', () => {
      expect(production('https://ocm.example.com', { host, encrypted: true })).toBe(true);
    });

    test('compares hosts only when the proxy is not trusted', () => {
      expect(production('http://ocm.example.com', { host, forwardedProto: 'https' })).toBe(true);
    });

    // As the LemonLDAP relay of docker-compose.sso.yml does, with TLS
    test('compares hosts only when the trusted proxy sends no X-Forwarded-Proto', () => {
      expect(behindTrustedProxy('https://ocm.example.com', { host: 'ocm.example.com:443' }))
        .toBe(true);
    });
  });

  // TRUST_PROXY=2, behind a TLS terminator and the relay: the server trusts
  // two proxies, and the check reads the headers as behind one
  test.each([
    ['1', behindTrustedProxy],
    ['2', createOriginCheck({ ...settings, trustProxy: 2 })],
  ])('reads X-Forwarded-Host and X-Forwarded-Proto with trustProxy: %s', (_, check) => {
    expect(check('https://ocm.example.com', {
      host: 'ovh-cost-manager:3001',
      forwardedHost: 'ocm.internal, ocm.example.com',
    })).toBe(true);
    expect(check('http://ocm.example.com', { host: 'ocm.example.com', forwardedProto: 'https' }))
      .toBe(false);
  });

  // A string compared as a list compares by substring
  test('refuses a list of origins that is not an array', () => {
    expect(() => createOriginCheck({ ...settings, allowedOrigins: 'https://ocm.example.com' }))
      .toThrow(TypeError);
  });
});

// ALLOWED_ORIGINS, or allowedOrigins in config.json, as the server reads them
// at startup: an array, or a comma-separated string, as for the allowed hosts
describe('readAllowedOrigins', () => {
  const SOURCE = '/etc/ocm/config.json';

  test('reads ALLOWED_ORIGINS, comma-separated', () => {
    const env = { ALLOWED_ORIGINS: 'https://a.example, https://b.example:8443' };
    expect(readAllowedOrigins({}, env)).toEqual(['https://a.example', 'https://b.example:8443']);
  });

  test.each([
    ['an array', ['https://a.example', 'https://b.example']],
    ['a comma-separated string', 'https://a.example, https://b.example'],
  ])('reads allowedOrigins of config.json as %s', (label, allowedOrigins) => {
    expect(readAllowedOrigins({ allowedOrigins }, {}))
      .toEqual(['https://a.example', 'https://b.example']);
  });

  test('lists no origin when neither is set', () => {
    expect(readAllowedOrigins({}, {})).toEqual([]);
  });

  test('lets ALLOWED_ORIGINS override config.json, unless it is empty', () => {
    const file = { allowedOrigins: ['https://a.example'] };
    expect(readAllowedOrigins(file, { ALLOWED_ORIGINS: 'https://b.example' }))
      .toEqual(['https://b.example']);
    expect(readAllowedOrigins(file, { ALLOWED_ORIGINS: '' })).toEqual(['https://a.example']);
  });

  test.each([
    ['true', true],
    ['null', null],
    ['{"origin":"https://a.example"}', { origin: 'https://a.example' }],
  ])('refuses allowedOrigins: %s, naming the file', (shown, allowedOrigins) => {
    expect(() => readAllowedOrigins({ allowedOrigins }, {}, SOURCE)).toThrow(
      `allowedOrigins in ${SOURCE} must be an array of strings or a comma-separated string, `
        + `not ${shown}`
    );
  });

  test('refuses a wrong allowedOrigins that ALLOWED_ORIGINS overrides', () => {
    const env = { ALLOWED_ORIGINS: 'https://b.example' };
    expect(() => readAllowedOrigins({ allowedOrigins: 42 }, env, SOURCE))
      .toThrow(`allowedOrigins in ${SOURCE}`);
  });
});

// The check built as the server builds it at startup, from an allowedOrigins
// string of config.json. It used the string as the list, and includes compared
// the Origin as a substring of it
describe('the origin check, from an allowedOrigins string of config.json', () => {
  const check = createOriginCheck({
    ...settings,
    allowedOrigins: readAllowedOrigins({
      allowedOrigins: 'https://ocm.example.com,https://reports.example.com',
    }, {}),
  });
  const elsewhere = { host: 'dashboard.example.org' };

  test.each(['https://ocm.example.com', 'https://reports.example.com'])(
    'allows %s, which it lists',
    (origin) => {
      expect(check(origin, elsewhere)).toBe(true);
    }
  );

  test.each([
    'https://ocm.example',
    'https://ocm.example.co',
    'https://ocm.example.com.evil.example',
    'https://reports.example.co',
    'https://ocm',
  ])('rejects %s, a part or an extension of a listed origin', (origin) => {
    expect(check(origin, elsewhere)).toBe(false);
  });
});

describe('createOriginCheckMiddleware', () => {
  const refused = { Origin: 'https://evil.example' };
  // A stand-in for the console
  const logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
  let server;

  // The check, then a route: server/index.js mounts it before the API and the
  // static files
  beforeAll(async () => {
    const app = express();
    app.use(createOriginCheckMiddleware(
      { ...settings, allowedOrigins: ['https://reports.example.com'] },
      logger
    ));
    app.all('/api/months', (req, res) => res.json({ route: 'months' }));
    server = await serve(app);
  });

  afterAll(() => server.close());

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // A preflight, and the simple requests a page sends without one, such as a
  // form's POST: the route must not run
  test.each(['GET', 'POST', 'OPTIONS'])(
    'answers 403 to %s from a refused origin, with a JSON error',
    async (method) => {
      const res = await server.request(method, '/api/months', refused);
      expect(res.status).toBe(403);
      expect(JSON.parse(res.body)).toEqual({ error: 'Origin not allowed' });
    }
  );

  // The answer depends on the Origin: a cache must not give it for another
  test('varies its 403 on Origin', async () => {
    const res = await server.request('GET', '/api/months', refused);
    expect(res.headers.vary).toBe('Origin');
  });

  test('logs a refused request on one line, the origin quoted, and nothing else', async () => {
    await server.request('GET', '/api/months', refused);
    expect(logger.warn.mock.calls).toEqual([
      ['CORS: Blocked request from origin: "https://evil.example"'],
    ]);
    expect(logger.log).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  // An Origin header may hold kilobytes: the log keeps 267 characters, the
  // length of the longest origin, https:// with a domain name of 253
  // characters and :65535
  test('shortens a long origin in the log', async () => {
    await server.request('GET', '/api/months', { Origin: `https://${'a'.repeat(8000)}.example` });
    expect(logger.warn.mock.calls).toEqual([
      [`CORS: Blocked request from origin: "https://${'a'.repeat(256)}..."`],
    ]);
  });

  test.each([
    ['no Origin', {}],
    ['a listed origin', { Origin: 'https://reports.example.com' }],
    ['the request\'s own origin', { Origin: 'https://ocm.example.com', Host: 'ocm.example.com' }],
  ])('passes a request with %s on, and logs nothing', async (_, headers) => {
    const res = await server.request('GET', '/api/months', headers);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ route: 'months' });
    expect(logger.warn).not.toHaveBeenCalled();
  });
});
