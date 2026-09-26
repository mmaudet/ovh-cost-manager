/**
 * Tests for the rate limiting settings and TRUST_PROXY, which the CORS and Host
 * checks read too: config.json, which the environment overrides. Their
 * booleans take true or false only, as the auth settings: TRUST_PROXY=TRUE
 * was read as false.
 */

const { buildRateLimitConfig } = require('../server/rate-limit-config');

const SOURCE = '/etc/ocm/config.json';

describe('buildRateLimitConfig', () => {
  test('gives the defaults without settings', () => {
    expect(buildRateLimitConfig({}, {})).toEqual({
      enabled: true,
      trustProxy: false,
      api: { windowMs: 900000, max: 100 },
      auth: { windowMs: 900000, max: 20 },
    });
  });

  test.each([
    ['true', true],
    ['TRUE', true],
    ['True', true],
    ['false', false],
    ['FALSE', false],
  ])('reads TRUST_PROXY=%s in any case', (value, expected) => {
    expect(buildRateLimitConfig({}, { TRUST_PROXY: value }).trustProxy).toBe(expected);
  });

  test.each([
    ['true', true],
    ['False', false],
  ])('reads RATE_LIMIT_ENABLED=%s in any case', (value, expected) => {
    expect(buildRateLimitConfig({}, { RATE_LIMIT_ENABLED: value }).enabled).toBe(expected);
  });

  test.each([
    ['TRUST_PROXY', 'yes'],
    ['TRUST_PROXY', '1'],
    ['RATE_LIMIT_ENABLED', 'no'],
    ['RATE_LIMIT_ENABLED', '0'],
  ])('refuses %s=%s, rather than read it as false', (name, value) => {
    expect(() => buildRateLimitConfig({}, { [name]: value }))
      .toThrow(`${name} must be true or false, not "${value}"`);
  });

  test('ignores an empty variable, as an unset one', () => {
    const file = { rateLimit: { trustProxy: true } };
    expect(buildRateLimitConfig(file, { TRUST_PROXY: '' }).trustProxy).toBe(true);
  });

  test('reads the JSON booleans of config.json', () => {
    const file = { rateLimit: { enabled: false, trustProxy: true } };
    expect(buildRateLimitConfig(file, {})).toMatchObject({ enabled: false, trustProxy: true });
  });

  test.each([
    ['rateLimit.trustProxy', { trustProxy: 'true' }, '"true"'],
    ['rateLimit.enabled', { enabled: 1 }, '1'],
  ])('refuses %s: %j, naming the file and the key', (key, rateLimit, shown) => {
    expect(() => buildRateLimitConfig({ rateLimit }, {}, SOURCE))
      .toThrow(`${key} in ${SOURCE} must be true or false (JSON booleans), not ${shown}`);
  });

  test('lets the environment override config.json', () => {
    const file = { rateLimit: { enabled: false, trustProxy: true } };
    expect(buildRateLimitConfig(file, { RATE_LIMIT_ENABLED: 'true', TRUST_PROXY: 'false' }))
      .toMatchObject({ enabled: true, trustProxy: false });
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
