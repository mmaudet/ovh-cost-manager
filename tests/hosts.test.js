/**
 * Tests for the Host check, against DNS rebinding (#78).
 *
 * A page on another domain can point that domain at the server's address: the
 * browser then treats the server as the page's own origin, and sends the
 * page's domain in the Host header. When ALLOWED_HOSTS is set, the server only
 * answers the hosts it lists and the loopback names.
 */

const { createHostCheck } = require('../server/hosts');

// Built as the server builds it at startup, without a trusted proxy unless the
// check's name says otherwise
const allowedHosts = ['ocm.example.com', 'ocm.lan:3001'];
const direct = createHostCheck({ allowedHosts, trustProxy: false });
const behindTrustedProxy = createHostCheck({ allowedHosts, trustProxy: true });

describe('createHostCheck', () => {
  describe('when ALLOWED_HOSTS is not set', () => {
    const unset = createHostCheck({ allowedHosts: [], trustProxy: false });

    test.each(['ocm.example.com', 'evil.example', 'ocm.example.com/admin', '', undefined])(
      'allows the Host %p',
      (host) => {
        expect(unset(host)).toBe(true);
      }
    );

    test('allows any X-Forwarded-Host behind a trusted proxy', () => {
      const check = createHostCheck({ allowedHosts: [], trustProxy: true });
      expect(check('ocm.example.com', 'evil.example')).toBe(true);
    });

    // As ALLOWED_HOSTS=" , ", or blank entries in config.json, give
    test('takes a list of empty entries as not set', () => {
      const check = createHostCheck({ allowedHosts: ['', ' '], trustProxy: false });
      expect(check('evil.example')).toBe(true);
    });
  });

  test.each(['ocm.example.com', 'ocm.lan:3001'])('allows the listed host %s', (host) => {
    expect(direct(host)).toBe(true);
  });

  test.each([
    ['evil.example', 'is not listed'],
    ['ocm.example.com.evil.example', 'only starts with a listed host'],
    ['ocm.lan', 'is listed with a port only'],
    ['ocm.lan:8080', 'is listed on another port'],
    ['ocm.example.com:3001', 'is listed without a port, so on the default ports only'],
  ])('rejects %s, which %s', (host) => {
    expect(direct(host)).toBe(false);
  });

  // As ALLOWED_HOSTS=ocm.example.com, ocm.lan:3001 gives
  test('ignores the blanks around the listed hosts', () => {
    const check = createHostCheck({
      allowedHosts: ['ocm.example.com', ' ocm.lan:3001 '],
      trustProxy: false,
    });
    expect(check('ocm.lan:3001')).toBe(true);
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
    expect(direct(host)).toBe(true);
  });

  test('reads the listed hosts as it reads Host', () => {
    const check = createHostCheck({ allowedHosts: ['OCM.Example.com:443'], trustProxy: false });
    expect(check('ocm.example.com')).toBe(true);
  });

  // The Docker healthcheck, the import cron and local tools call localhost
  test.each(['localhost', 'localhost:3001', '127.0.0.1:3001', '[::1]:3001', 'LOCALHOST:5173'])(
    'always allows the loopback host %s, on any port',
    (host) => {
      expect(direct(host)).toBe(true);
    }
  );

  test.each(['localhost.evil.example', 'notlocalhost:3001', '127.0.0.1.evil.example:3001'])(
    'rejects %s, whose name is not a loopback name',
    (host) => {
      expect(direct(host)).toBe(false);
    }
  );

  describe('behind a proxy that sets Host to the container', () => {
    // The page is on ocm.example.com, the proxy reaches the container by its name
    const container = 'ovh-cost-manager:3001';

    test('allows a listed X-Forwarded-Host when the proxy is trusted', () => {
      expect(behindTrustedProxy(container, 'ocm.example.com')).toBe(true);
    });

    test('ignores X-Forwarded-Host when the proxy is not trusted', () => {
      expect(direct(container, 'ocm.example.com')).toBe(false);
    });

    // The host the browser asked for is then X-Forwarded-Host, not Host
    test('rejects an X-Forwarded-Host that is not listed, even with a listed Host', () => {
      expect(behindTrustedProxy('ocm.example.com', 'evil.example')).toBe(false);
    });

    test('reads the first host of an X-Forwarded-Host list', () => {
      expect(behindTrustedProxy(container, 'ocm.example.com, evil.example')).toBe(true);
    });

    test('rejects an X-Forwarded-Host list whose first host is not listed', () => {
      expect(behindTrustedProxy(container, 'evil.example, ocm.example.com')).toBe(false);
    });

    test('compares X-Forwarded-Host as it compares Host', () => {
      expect(behindTrustedProxy(container, 'OCM.example.com:443')).toBe(true);
    });

    // As the LemonLDAP relay of docker-compose.sso.yml does
    test('reads Host when the trusted proxy sends no X-Forwarded-Host', () => {
      expect(behindTrustedProxy('ocm.example.com:80', undefined)).toBe(true);
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
    expect(direct(host)).toBe(false);
  });

  test('rejects a request without Host, not reading it as the host undefined', () => {
    const check = createHostCheck({ allowedHosts: ['undefined'], trustProxy: false });
    expect(check(undefined)).toBe(false);
  });

  test('rejects a malformed X-Forwarded-Host of a trusted proxy, even with a listed Host', () => {
    expect(behindTrustedProxy('ocm.example.com', 'user@ocm.example.com')).toBe(false);
  });

  // As a URL or a typo in ALLOWED_HOSTS gives: the check must not turn off
  const misconfigured = {
    allowedHosts: ['https://ocm.example.com', 'ocm.lan:port'],
    trustProxy: false,
  };

  test('keeps the check on when no listed host is well-formed', () => {
    expect(createHostCheck(misconfigured)('ocm.example.com')).toBe(false);
  });

  test('allows the loopback hosts when no listed host is well-formed', () => {
    expect(createHostCheck(misconfigured)('localhost:3001')).toBe(true);
  });
});
