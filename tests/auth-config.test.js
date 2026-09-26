/**
 * Tests for the OIDC settings: read from the environment and config.json, the
 * environment overriding the file, and required before the server starts.
 */

const { buildAuthConfig, missingSettings } = require('../server/auth/config');

// Every setting OIDC needs, as the environment of docker-compose.sso.yml sets them
const OIDC_ENV = {
  OIDC_ENABLED: 'true',
  OIDC_ISSUER: 'https://sso.example.com',
  OIDC_CLIENT_ID: 'ocm-dashboard',
  OIDC_CLIENT_SECRET: 'client-secret',
  OIDC_BASE_URL: 'https://ocm.example.com',
  SESSION_SECRET: '0123456789abcdef0123456789abcdef',
};

describe('OIDC_ENABLED', () => {
  const enabledInFile = { auth: { enabled: true } };
  const disabledInFile = { auth: { enabled: false } };

  test('false disables OIDC, even when config.json enables it', () => {
    expect(buildAuthConfig(enabledInFile, { ...OIDC_ENV, OIDC_ENABLED: 'false' }))
      .toEqual({ enabled: false });
  });

  test('true enables OIDC, even when config.json disables it', () => {
    expect(buildAuthConfig(disabledInFile, OIDC_ENV).enabled).toBe(true);
  });

  test.each([
    ['unset', undefined],
    ['empty', ''],
  ])('leaves it to config.json when %s', (label, value) => {
    const env = { ...OIDC_ENV, OIDC_ENABLED: value };
    expect(buildAuthConfig(enabledInFile, env).enabled).toBe(true);
    expect(buildAuthConfig(disabledInFile, env).enabled).toBe(false);
    expect(buildAuthConfig({}, env).enabled).toBe(false);
  });

  // Rather than guess: with config.json enabling OIDC, reading 1 as false
  // would disable it
  test.each(['1', 'yes', 'TRUE', 'on'])('refuses %s', (value) => {
    expect(() => buildAuthConfig(enabledInFile, { ...OIDC_ENV, OIDC_ENABLED: value }))
      .toThrow(`OIDC_ENABLED must be true or false, not '${value}'`);
  });
});

describe('missingSettings', () => {
  test('finds none when every setting is set', () => {
    expect(missingSettings(buildAuthConfig({}, OIDC_ENV))).toEqual([]);
  });

  test.each([
    ['OIDC_ISSUER', 'OIDC_ISSUER or auth.provider.issuer'],
    ['OIDC_CLIENT_ID', 'OIDC_CLIENT_ID or auth.provider.clientId'],
    ['OIDC_CLIENT_SECRET', 'OIDC_CLIENT_SECRET or auth.provider.clientSecret'],
    ['OIDC_BASE_URL', 'OIDC_BASE_URL or auth.baseUrl'],
    ['SESSION_SECRET', 'SESSION_SECRET or auth.session.secret'],
  ])('names %s when it is not set', (variable, name) => {
    const env = { ...OIDC_ENV };
    delete env[variable];
    expect(missingSettings(buildAuthConfig({}, env))).toEqual([name]);
  });

  test('finds the settings of config.json', () => {
    const fileConfig = {
      auth: {
        enabled: true,
        provider: {
          issuer: 'https://sso.example.com',
          clientId: 'ocm-dashboard',
          clientSecret: 'client-secret',
        },
        session: { secret: '0123456789abcdef0123456789abcdef' },
        baseUrl: 'https://ocm.example.com',
      },
    };
    expect(missingSettings(buildAuthConfig(fileConfig, {}))).toEqual([]);
  });

  test('names all the missing settings at once', () => {
    expect(missingSettings(buildAuthConfig({}, { OIDC_ENABLED: 'true' }))).toHaveLength(5);
  });
});

describe('the Secure flag of the session cookie', () => {
  // config.json with auth.session.secure set to value
  const fileWith = (value) => ({ auth: { session: { secure: value } } });
  const secureSetting = (fileConfig, env) => buildAuthConfig(fileConfig, env).session.secure;

  test('is auto by default', () => {
    expect(secureSetting({}, OIDC_ENV)).toBe('auto');
  });

  test.each([
    ['true', true],
    ['false', false],
  ])('is forced by COOKIE_SECURE=%s', (value, expected) => {
    expect(secureSetting({}, { ...OIDC_ENV, COOKIE_SECURE: value })).toBe(expected);
  });

  test.each([true, false])('is forced by auth.session.secure: %s in config.json', (value) => {
    expect(secureSetting(fileWith(value), OIDC_ENV)).toBe(value);
  });

  test.each([
    ['false', true, false],
    ['true', false, true],
  ])('COOKIE_SECURE=%s overrides auth.session.secure: %s', (envValue, fileValue, expected) => {
    expect(secureSetting(fileWith(fileValue), { ...OIDC_ENV, COOKIE_SECURE: envValue }))
      .toBe(expected);
  });

  test('ignores an empty COOKIE_SECURE, as an unset one', () => {
    expect(secureSetting(fileWith(true), { ...OIDC_ENV, COOKIE_SECURE: '' })).toBe(true);
  });

  test.each(['yes', '1', 'TRUE', 'auto'])('refuses COOKIE_SECURE=%s', (value) => {
    expect(() => buildAuthConfig({}, { ...OIDC_ENV, COOKIE_SECURE: value }))
      .toThrow(`COOKIE_SECURE must be true or false, not '${value}'`);
  });
});
