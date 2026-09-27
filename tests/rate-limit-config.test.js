/**
 * Tests for the rate limiting settings and TRUST_PROXY, which the CORS and Host
 * checks read too: config.json, which the environment overrides.
 * RATE_LIMIT_ENABLED takes true or false only, as the auth settings, and
 * TRUST_PROXY these or a number of proxies from 1 to 10: TRUST_PROXY=TRUE was
 * read as false.
 */

const { buildRateLimitConfig } = require('../server/rate-limit-config');

const SOURCE = '/etc/ocm/config.json';

describe('buildRateLimitConfig', () => {
  test('gives the defaults without settings', () => {
    expect(buildRateLimitConfig({}, {})).toEqual({
      enabled: true,
      trustProxy: 0,
      api: { windowMs: 900000, max: 100 },
      auth: { windowMs: 900000, max: 20 },
    });
  });

  // trustProxy is the number of proxies the server trusts: true stands for
  // one, as before a number could be given
  test.each([
    ['true', 1],
    ['TRUE', 1],
    ['True', 1],
    ['false', 0],
    ['FALSE', 0],
  ])('reads TRUST_PROXY=%s in any case', (value, expected) => {
    expect(buildRateLimitConfig({}, { TRUST_PROXY: value }).trustProxy).toBe(expected);
  });

  test.each([
    ['1', 1],
    ['2', 2],
  ])('reads TRUST_PROXY=%s as the number of proxies to trust', (value, expected) => {
    expect(buildRateLimitConfig({}, { TRUST_PROXY: value }).trustProxy).toBe(expected);
  });

  test.each([
    ['true', true],
    ['False', false],
  ])('reads RATE_LIMIT_ENABLED=%s in any case', (value, expected) => {
    expect(buildRateLimitConfig({}, { RATE_LIMIT_ENABLED: value }).enabled).toBe(expected);
  });

  test.each(['yes', '0', '11', '-1', '1.5'])(
    'refuses TRUST_PROXY=%s, rather than read it as false',
    (value) => {
      expect(() => buildRateLimitConfig({}, { TRUST_PROXY: value }))
        .toThrow(`TRUST_PROXY must be true, false or an integer from 1 to 10, not "${value}"`);
    }
  );

  test.each(['no', '0'])('refuses RATE_LIMIT_ENABLED=%s, rather than read it as false', (value) => {
    expect(() => buildRateLimitConfig({}, { RATE_LIMIT_ENABLED: value }))
      .toThrow(`RATE_LIMIT_ENABLED must be true or false, not "${value}"`);
  });

  test('ignores an empty variable, as an unset one', () => {
    const file = { rateLimit: { trustProxy: true } };
    expect(buildRateLimitConfig(file, { TRUST_PROXY: '' }).trustProxy).toBe(1);
  });

  test('reads the JSON booleans of config.json', () => {
    const file = { rateLimit: { enabled: false, trustProxy: true } };
    expect(buildRateLimitConfig(file, {})).toMatchObject({ enabled: false, trustProxy: 1 });
  });

  test('reads a number of proxies in config.json, as a JSON number', () => {
    expect(buildRateLimitConfig({ rateLimit: { trustProxy: 2 } }, {}).trustProxy).toBe(2);
  });

  test('refuses rateLimit.enabled: 1, naming the file and the key', () => {
    expect(() => buildRateLimitConfig({ rateLimit: { enabled: 1 } }, {}, SOURCE))
      .toThrow(`rateLimit.enabled in ${SOURCE} must be true or false (JSON booleans), not 1`);
  });

  test.each([
    ['"true"', 'true'],
    ['"2"', '2'],
    ['0', 0],
    ['11', 11],
    ['1.5', 1.5],
  ])('refuses rateLimit.trustProxy: %s, naming the file and the key', (shown, trustProxy) => {
    expect(() => buildRateLimitConfig({ rateLimit: { trustProxy } }, {}, SOURCE)).toThrow(
      `rateLimit.trustProxy in ${SOURCE} must be true or false (JSON booleans), `
        + `or an integer from 1 to 10 (a JSON number), not ${shown}`
    );
  });

  test('lets the environment override config.json', () => {
    const file = { rateLimit: { enabled: false, trustProxy: true } };
    expect(buildRateLimitConfig(file, { RATE_LIMIT_ENABLED: 'true', TRUST_PROXY: 'false' }))
      .toMatchObject({ enabled: true, trustProxy: 0 });
  });

  test('lets TRUST_PROXY override config.json, with a number on either side', () => {
    const twoInFile = { rateLimit: { trustProxy: 2 } };
    const oneInFile = { rateLimit: { trustProxy: true } };
    expect(buildRateLimitConfig(twoInFile, { TRUST_PROXY: 'true' }).trustProxy).toBe(1);
    expect(buildRateLimitConfig(oneInFile, { TRUST_PROXY: '3' }).trustProxy).toBe(3);
  });

  test('refuses a wrong value of config.json that the environment overrides', () => {
    const file = { rateLimit: { trustProxy: 'yes' } };
    expect(() => buildRateLimitConfig(file, { TRUST_PROXY: 'true' }))
      .toThrow('rateLimit.trustProxy');
  });

  test('reads the limits from config.json and the environment', () => {
    const file = { rateLimit: { api: { max: 300 }, auth: { windowMs: 60000 } } };
    const env = { RATE_LIMIT_API_WINDOW_MS: '120000', RATE_LIMIT_AUTH_MAX: '50' };
    expect(buildRateLimitConfig(file, env)).toMatchObject({
      api: { windowMs: 120000, max: 300 },
      auth: { windowMs: 60000, max: 50 },
    });
  });

  test('ignores an empty limit variable, as an unset one', () => {
    const file = { rateLimit: { api: { max: 300 } } };
    expect(buildRateLimitConfig(file, { RATE_LIMIT_API_MAX: '' }).api.max).toBe(300);
  });

  // parseInt read 100abc as 100, and abc, 0 or -5 as the default
  test.each([
    'RATE_LIMIT_API_WINDOW_MS',
    'RATE_LIMIT_API_MAX',
    'RATE_LIMIT_AUTH_WINDOW_MS',
    'RATE_LIMIT_AUTH_MAX',
  ])('refuses %s=abc, rather than keep the default', (name) => {
    expect(() => buildRateLimitConfig({}, { [name]: 'abc' }))
      .toThrow(`${name} must be a positive integer, not "abc"`);
  });

  test.each(['0', '-5', '100abc', '1.5'])('refuses RATE_LIMIT_API_MAX=%s', (value) => {
    expect(() => buildRateLimitConfig({}, { RATE_LIMIT_API_MAX: value }))
      .toThrow(`RATE_LIMIT_API_MAX must be a positive integer, not "${value}"`);
  });

  // express-rate-limit compared each count to "abc", and limited nothing
  test.each([
    ['rateLimit.api.max', { api: { max: 'abc' } }, '"abc"'],
    ['rateLimit.api.max', { api: { max: '100' } }, '"100"'],
    ['rateLimit.api.windowMs', { api: { windowMs: 0 } }, '0'],
    ['rateLimit.auth.max', { auth: { max: -1 } }, '-1'],
    ['rateLimit.auth.windowMs', { auth: { windowMs: 1.5 } }, '1.5'],
    ['rateLimit.auth.max', { auth: { max: null } }, 'null'],
  ])('refuses %s: %j, naming the file', (key, rateLimit, shown) => {
    expect(() => buildRateLimitConfig({ rateLimit }, {}, SOURCE))
      .toThrow(`${key} in ${SOURCE} must be a positive integer (a JSON number), not ${shown}`);
  });

  test('refuses a wrong limit of config.json that the environment overrides', () => {
    const file = { rateLimit: { api: { max: 'abc' } } };
    expect(() => buildRateLimitConfig(file, { RATE_LIMIT_API_MAX: '100' }, SOURCE))
      .toThrow(`rateLimit.api.max in ${SOURCE}`);
  });

  test.each([
    ['rateLimit', { rateLimit: true }, 'true'],
    ['rateLimit', { rateLimit: [] }, 'an array'],
    ['rateLimit.api', { rateLimit: { api: 100 } }, '100'],
    ['rateLimit.auth', { rateLimit: { auth: 'strict' } }, 'a string'],
  ])('refuses %s that is not an object: %j', (key, file, shown) => {
    expect(() => buildRateLimitConfig(file, {}, SOURCE))
      .toThrow(`${key} in ${SOURCE} must be an object, not ${shown}`);
  });
});
