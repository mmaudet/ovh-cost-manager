/**
 * Tests for the Host check, against DNS rebinding (#78).
 *
 * A page on another domain can point that domain at the server's address: the
 * browser then treats the server as the page's own origin, and sends the
 * page's domain in the Host header. When ALLOWED_HOSTS is set, the server only
 * answers the hosts it lists and the loopback names.
 */

const { createHostCheck, createHostCheckMiddleware } = require('../server/hosts');

// Built as the server builds it at startup, without a trusted proxy unless the
// check's name says otherwise
const allowedHosts = ['ocm.example.com', 'ocm.lan:3001'];
const direct = createHostCheck({ allowedHosts, trustProxy: false });
const behindTrustedProxy = createHostCheck({ allowedHosts, trustProxy: true });

// Whether the check passes a request with these headers, named as Node names them
function passes(check, headers) {
  return check(headers).allowed;
}

describe('createHostCheck', () => {
  describe('when ALLOWED_HOSTS is not set', () => {
    const unset = createHostCheck({ allowedHosts: [], trustProxy: false });

    test.each(['ocm.example.com', 'evil.example', 'ocm.example.com/admin', '', undefined])(
      'allows the Host %p',
      (host) => {
        expect(passes(unset, { host })).toBe(true);
      }
    );

    test('allows any X-Forwarded-Host behind a trusted proxy', () => {
      const check = createHostCheck({ allowedHosts: [], trustProxy: true });
      expect(passes(check, { host: 'ocm.example.com', 'x-forwarded-host': 'evil.example' }))
        .toBe(true);
    });

    // As ALLOWED_HOSTS=" , ", or blank entries in config.json, give
    test('takes a list of empty entries as not set', () => {
      const check = createHostCheck({ allowedHosts: ['', ' '], trustProxy: false });
      expect(passes(check, { host: 'evil.example' })).toBe(true);
    });
  });

  test.each(['ocm.example.com', 'ocm.lan:3001'])('allows the listed host %s', (host) => {
    expect(passes(direct, { host })).toBe(true);
  });

  test.each([
    ['evil.example', 'is not listed'],
    ['ocm.example.com.evil.example', 'only starts with a listed host'],
    ['ocm.lan', 'is listed with a port only'],
    ['ocm.lan:8080', 'is listed on another port'],
    ['ocm.example.com:3001', 'is listed without a port, so on the default ports only'],
  ])('rejects %s, which %s', (host) => {
    expect(passes(direct, { host })).toBe(false);
  });

  // As ALLOWED_HOSTS=ocm.example.com, ocm.lan:3001 gives
  test('ignores the blanks around the listed hosts', () => {
    const check = createHostCheck({
      allowedHosts: ['ocm.example.com', ' ocm.lan:3001 '],
      trustProxy: false,
    });
    expect(passes(check, { host: 'ocm.lan:3001' })).toBe(true);
  });

  // Hosts compare as URL writes them: lowercase, and without the default port
  // of http or https, as the check does not know the request's scheme
  test.each([
    'OCM.Example.COM',
    // What the LemonLDAP relay of docker-compose.sso.yml sends
    'ocm.example.com:80',
    'ocm.example.com:443',
    'OCM.LAN:3001',
  ])('allows %s, a listed host once lowercase and without a default port', (host) => {
    expect(passes(direct, { host })).toBe(true);
  });

  test('reads the listed hosts as it reads Host', () => {
    const check = createHostCheck({ allowedHosts: ['OCM.Example.com:443'], trustProxy: false });
    expect(passes(check, { host: 'ocm.example.com' })).toBe(true);
  });

  // The Docker healthcheck, the import cron and local tools call localhost
  test.each(['localhost', 'localhost:3001', '127.0.0.1:3001', '[::1]:3001', 'LOCALHOST:5173'])(
    'always allows the loopback host %s, on any port',
    (host) => {
      expect(passes(direct, { host })).toBe(true);
    }
  );

  test.each(['localhost.evil.example', 'notlocalhost:3001', '127.0.0.1.evil.example:3001'])(
    'rejects %s, whose name is not a loopback name',
    (host) => {
      expect(passes(direct, { host })).toBe(false);
    }
  );

  describe('behind a proxy that sets Host to the container', () => {
    // The page is on ocm.example.com, the proxy reaches the container by its name
    const container = 'ovh-cost-manager:3001';

    test('allows a listed X-Forwarded-Host when the proxy is trusted', () => {
      expect(passes(behindTrustedProxy, {
        host: container,
        'x-forwarded-host': 'ocm.example.com',
      })).toBe(true);
    });

    test('ignores X-Forwarded-Host when the proxy is not trusted', () => {
      expect(passes(direct, { host: container, 'x-forwarded-host': 'ocm.example.com' }))
        .toBe(false);
    });

    // The host the browser asked for is then X-Forwarded-Host, not Host
    test('rejects an X-Forwarded-Host that is not listed, even with a listed Host', () => {
      expect(passes(behindTrustedProxy, {
        host: 'ocm.example.com',
        'x-forwarded-host': 'evil.example',
      })).toBe(false);
    });

    test('reads the first host of an X-Forwarded-Host list', () => {
      expect(passes(behindTrustedProxy, {
        host: container,
        'x-forwarded-host': 'ocm.example.com, evil.example',
      })).toBe(true);
    });

    test('rejects an X-Forwarded-Host list whose first host is not listed', () => {
      expect(passes(behindTrustedProxy, {
        host: container,
        'x-forwarded-host': 'evil.example, ocm.example.com',
      })).toBe(false);
    });

    test('compares X-Forwarded-Host as it compares Host', () => {
      expect(passes(behindTrustedProxy, {
        host: container,
        'x-forwarded-host': 'OCM.example.com:443',
      })).toBe(true);
    });

    // As the LemonLDAP relay of docker-compose.sso.yml does
    test('reads Host when the trusted proxy sends no X-Forwarded-Host', () => {
      expect(passes(behindTrustedProxy, { host: 'ocm.example.com:80' })).toBe(true);
    });
  });

  // Browsers send a well-formed Host. URL alone would read a path, a user, a
  // query or a tab around ocm.example.com as ocm.example.com itself.
  test.each([
    undefined,
    '',
    ':3001',
    'ocm.example.com:abc',
    '[::1',
    'ocm example.com',
    'ocm.exa\tmple.com',
    'ocm.example.com/admin',
    'user@ocm.example.com',
    'ocm.example.com?',
    'http://ocm.example.com',
  ])('rejects the malformed Host %p without throwing', (host) => {
    expect(passes(direct, { host })).toBe(false);
  });

  test('rejects a request without Host, not reading it as the host undefined', () => {
    const check = createHostCheck({ allowedHosts: ['undefined'], trustProxy: false });
    expect(passes(check, {})).toBe(false);
  });

  test('rejects a malformed X-Forwarded-Host of a trusted proxy, even with a listed Host', () => {
    expect(passes(behindTrustedProxy, {
      host: 'ocm.example.com',
      'x-forwarded-host': 'user@ocm.example.com',
    })).toBe(false);
  });

  // As a URL or a typo in ALLOWED_HOSTS gives: the check must not turn off
  const misconfigured = {
    allowedHosts: ['https://ocm.example.com', 'ocm.lan:port'],
    trustProxy: false,
  };

  test('keeps the check on when no listed host is well-formed', () => {
    expect(passes(createHostCheck(misconfigured), { host: 'ocm.example.com' })).toBe(false);
  });

  test('allows the loopback hosts when no listed host is well-formed', () => {
    expect(passes(createHostCheck(misconfigured), { host: 'localhost:3001' })).toBe(true);
  });

  describe('what it read', () => {
    test('reports only that it passed a request it allows', () => {
      expect(direct({ host: 'ocm.example.com' })).toEqual({ allowed: true });
    });

    test('names the header and the host it refused', () => {
      expect(direct({ host: 'evil.example' }))
        .toEqual({ allowed: false, header: 'Host', host: 'evil.example' });
    });

    test('names X-Forwarded-Host when it read the host there', () => {
      expect(behindTrustedProxy({ host: 'ocm.example.com', 'x-forwarded-host': 'evil.example' }))
        .toEqual({ allowed: false, header: 'X-Forwarded-Host', host: 'evil.example' });
    });

    test('names the host as it compares it: lowercase, without a default port', () => {
      expect(direct({ host: 'EVIL.example:80' }))
        .toEqual({ allowed: false, header: 'Host', host: 'evil.example' });
    });

    test('names no host when the header holds none', () => {
      expect(direct({ host: 'user@ocm.example.com' }))
        .toEqual({ allowed: false, header: 'Host', host: null });
    });
  });
});

describe('createHostCheckMiddleware', () => {
  const settings = { allowedHosts, trustProxy: false };
  const HOUR = 60 * 60 * 1000;

  // The log starts over every hour
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // A stand-in for the console
  function makeLogger() {
    return { log: jest.fn(), warn: jest.fn() };
  }

  // Runs the middleware on a request with these headers, as Express would, and
  // returns what it did: pass the request on, or answer it
  function run(middleware, headers) {
    const outcome = { next: false, status: null, body: null };
    const res = {
      status(code) {
        outcome.status = code;
        return res;
      },
      json(body) {
        outcome.body = body;
        return res;
      },
    };
    middleware({ headers }, res, () => {
      outcome.next = true;
    });
    return outcome;
  }

  test('is not built when ALLOWED_HOSTS is not set, so that nothing runs', () => {
    expect(createHostCheckMiddleware({ allowedHosts: [], trustProxy: false }, makeLogger()))
      .toBeNull();
  });

  test('passes an allowed request on', () => {
    const hostCheck = createHostCheckMiddleware(settings, makeLogger());
    expect(run(hostCheck, { host: 'ocm.example.com' }))
      .toEqual({ next: true, status: null, body: null });
  });

  test('answers any other request with a 421 and a JSON error', () => {
    const hostCheck = createHostCheckMiddleware(settings, makeLogger());
    expect(run(hostCheck, { host: 'evil.example' }))
      .toEqual({ next: false, status: 421, body: { error: 'Host not allowed' } });
  });

  test('logs a blocked host once', () => {
    const logger = makeLogger();
    const hostCheck = createHostCheckMiddleware(settings, logger);
    run(hostCheck, { host: 'evil.example' });
    run(hostCheck, { host: 'evil.example' });
    run(hostCheck, { host: 'other.example' });
    expect(logger.warn.mock.calls).toEqual([
      ['Host check: Blocked request for host: evil.example'],
      ['Host check: Blocked request for host: other.example'],
    ]);
  });

  test('logs a blocked host once, however it is written', () => {
    const logger = makeLogger();
    const hostCheck = createHostCheckMiddleware(settings, logger);
    run(hostCheck, { host: 'EVIL.example' });
    run(hostCheck, { host: 'evil.example:80' });
    run(hostCheck, { host: 'evil.example:443' });
    expect(logger.warn.mock.calls).toEqual([
      ['Host check: Blocked request for host: evil.example'],
    ]);
  });

  test('logs the requests without a well-formed host once, as invalid', () => {
    const logger = makeLogger();
    const hostCheck = createHostCheckMiddleware(settings, logger);
    run(hostCheck, { host: 'user@ocm.example.com' });
    run(hostCheck, { host: ':3001' });
    run(hostCheck, {});
    expect(logger.warn.mock.calls).toEqual([
      ['Host check: Blocked request for host: invalid'],
    ]);
  });

  test('logs a host again after an hour, once it said how many requests it left out', () => {
    const logger = makeLogger();
    const hostCheck = createHostCheckMiddleware(settings, logger);
    run(hostCheck, { host: 'evil.example' });
    run(hostCheck, { host: 'evil.example' });
    run(hostCheck, { host: 'evil.example' });
    jest.advanceTimersByTime(HOUR);
    run(hostCheck, { host: 'evil.example' });
    expect(logger.warn.mock.calls).toEqual([
      ['Host check: Blocked request for host: evil.example'],
      ['Host check: 2 more blocked requests in the last hour, not logged'],
      ['Host check: Blocked request for host: evil.example'],
    ]);
  });

  test('logs no count for an hour when it left no request out', () => {
    const logger = makeLogger();
    const hostCheck = createHostCheckMiddleware(settings, logger);
    run(hostCheck, { host: 'evil.example' });
    jest.advanceTimersByTime(HOUR);
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  test('logs at most 100 hosts an hour, and still rejects the others', () => {
    const logger = makeLogger();
    const hostCheck = createHostCheckMiddleware(settings, logger);
    for (let i = 1; i <= 100; i += 1) {
      run(hostCheck, { host: `evil${i}.example` });
    }
    expect(run(hostCheck, { host: 'evil101.example' }).status).toBe(421);
    expect(run(hostCheck, { host: 'evil1.example' }).status).toBe(421);
    expect(logger.warn).toHaveBeenCalledTimes(100);
    jest.advanceTimersByTime(HOUR);
    expect(logger.warn).toHaveBeenLastCalledWith(
      'Host check: 2 more blocked requests in the last hour, not logged'
    );
  });

  test('counts one request it left out in the singular', () => {
    const logger = makeLogger();
    const hostCheck = createHostCheckMiddleware(settings, logger);
    run(hostCheck, { host: 'evil.example' });
    run(hostCheck, { host: 'evil.example' });
    jest.advanceTimersByTime(HOUR);
    expect(logger.warn)
      .toHaveBeenLastCalledWith('Host check: 1 more blocked request in the last hour, not logged');
  });
});
