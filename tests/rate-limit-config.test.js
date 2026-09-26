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

  // The numbers are read as before: a positive integer, or the default
  test('reads the limits from config.json and the environment', () => {
    const file = { rateLimit: { api: { max: 300 }, auth: { windowMs: 60000 } } };
    const env = { RATE_LIMIT_API_WINDOW_MS: '120000', RATE_LIMIT_AUTH_MAX: '50' };
    expect(buildRateLimitConfig(file, env)).toMatchObject({
      api: { windowMs: 120000, max: 300 },
      auth: { windowMs: 60000, max: 50 },
    });
  });

  test.each(['abc', '0', '-5'])('ignores RATE_LIMIT_API_MAX=%s', (value) => {
    expect(buildRateLimitConfig({}, { RATE_LIMIT_API_MAX: value }).api.max).toBe(100);
  });
});
