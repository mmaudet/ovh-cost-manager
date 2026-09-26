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
    expect(buildAuthConfig(enabledInFile, { ...OIDC_ENV, OIDC_ENABLED: 'false' }).enabled)
      .toBe(false);
  });

  test('true enables OIDC, even when config.json disables it', () => {
    expect(buildAuthConfig(disabledInFile, OIDC_ENV).enabled).toBe(true);
  });

  test.each([
    ['TRUE', true],
    ['True', true],
    ['FALSE', false],
  ])('reads %s in any case', (value, expected) => {
    expect(buildAuthConfig(disabledInFile, { ...OIDC_ENV, OIDC_ENABLED: value }).enabled)
      .toBe(expected);
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
  test.each(['1', 'yes', 'on', 'enabled'])('refuses %s', (value) => {
    expect(() => buildAuthConfig(enabledInFile, { ...OIDC_ENV, OIDC_ENABLED: value }))
      .toThrow(`OIDC_ENABLED must be true or false, not "${value}"`);
  });
});

// AUTH_REQUIRED, of header mode: read whatever the mode, so that a mistake
// stops the server rather than leave the API open
describe('AUTH_REQUIRED', () => {
  const required = (value, env = {}) => buildAuthConfig({}, { ...env, AUTH_REQUIRED: value })
    .required;

  test.each([undefined, ''])('is false when %p', (value) => {
    expect(required(value)).toBe(false);
  });

  test.each([
    ['true', true],
    ['TRUE', true],
    ['False', false],
  ])('reads %s in any case', (value, expected) => {
    expect(required(value)).toBe(expected);
  });

  test.each(['1', 'yes', 'required'])('refuses %s', (value) => {
    expect(() => required(value)).toThrow(`AUTH_REQUIRED must be true or false, not "${value}"`);
  });

  test('refuses a wrong value with OIDC too', () => {
    expect(() => required('1', OIDC_ENV)).toThrow('AUTH_REQUIRED must be true or false');
  });
});

// config.json holds JSON: its booleans are true or false without quotes
describe('the booleans of config.json', () => {
  const SOURCE = '/etc/ocm/config.json';

  test.each([
    ['auth.enabled', { enabled: 'true' }, '"true"'],
    ['auth.enabled', { enabled: 1 }, '1'],
    ['auth.enabled', { enabled: null }, 'null'],
    ['auth.backChannelLogout', { backChannelLogout: 'no' }, '"no"'],
    ['auth.session.secure', { session: { secure: 'yes' } }, '"yes"'],
    ['auth.session.secure', { session: { secure: 0 } }, '0'],
  ])('refuses %s: %j, naming the file and the key', (key, auth, shown) => {
    expect(() => buildAuthConfig({ auth }, OIDC_ENV, SOURCE))
      .toThrow(new RegExp(`^${key} in ${SOURCE} must be .*, not ${shown}$`));
  });

  test('refuses a wrong value that the environment overrides', () => {
    expect(() => buildAuthConfig({ auth: { enabled: 'yes' } }, { OIDC_ENABLED: 'false' }, SOURCE))
      .toThrow(`auth.enabled in ${SOURCE}`);
  });

  test('refuses a wrong value of OIDC settings when OIDC is disabled', () => {
    expect(() => buildAuthConfig({ auth: { backChannelLogout: 'false' } }, {}, SOURCE))
      .toThrow(`auth.backChannelLogout in ${SOURCE}`);
  });

  test.each([
    [{}, true],
    [{ backChannelLogout: true }, true],
    [{ backChannelLogout: false }, false],
  ])('reads backChannelLogout from %j', (auth, expected) => {
    expect(buildAuthConfig({ auth }, OIDC_ENV).backChannelLogout).toBe(expected);
  });
});

// "auth": true turned authentication off: its settings were read from true
describe('the sections of config.json', () => {
  const SOURCE = '/etc/ocm/config.json';

  test.each([
    ['auth', { auth: true }, 'true'],
    ['auth', { auth: 'oidc' }, 'a string'],
    ['auth', { auth: null }, 'null'],
    ['auth.provider', { auth: { provider: 'https://sso.example.com' } }, 'a string'],
    ['auth.session', { auth: { session: [] } }, 'an array'],
  ])('refuses %s that is not an object: %j', (key, file, shown) => {
    expect(() => buildAuthConfig(file, {}, SOURCE))
      .toThrow(`${key} in ${SOURCE} must be an object, not ${shown}`);
  });

  test('refuses them when the environment enables OIDC too', () => {
    expect(() => buildAuthConfig({ auth: true }, OIDC_ENV, SOURCE)).toThrow(`auth in ${SOURCE}`);
  });
});

describe('auth.session.maxAge', () => {
  const SOURCE = '/etc/ocm/config.json';
  const withMaxAge = (maxAge) => ({ auth: { session: { maxAge } } });

  test('is 24 hours by default', () => {
    expect(buildAuthConfig({}, OIDC_ENV).session.maxAge).toBe(86400000);
  });

  test('is read from config.json', () => {
    expect(buildAuthConfig(withMaxAge(3600000), OIDC_ENV).session.maxAge).toBe(3600000);
  });

  test.each([
    ['"abc"', 'abc'],
    ['"3600000"', '3600000'],
    ['0', 0],
    ['-1', -1],
    ['1.5', 1.5],
  ])('refuses %s', (shown, value) => {
    expect(() => buildAuthConfig(withMaxAge(value), OIDC_ENV, SOURCE)).toThrow(
      `auth.session.maxAge in ${SOURCE} must be a positive integer (a JSON number), not ${shown}`
    );
  });

  test('refuses a wrong value when OIDC is disabled', () => {
    expect(() => buildAuthConfig(withMaxAge('abc'), {}, SOURCE))
      .toThrow(`auth.session.maxAge in ${SOURCE}`);
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
    ['TRUE', true],
  ])('is forced by COOKIE_SECURE=%s', (value, expected) => {
    expect(secureSetting({}, { ...OIDC_ENV, COOKIE_SECURE: value })).toBe(expected);
  });

  // auto, the default, can be written too, as the documentation names it
  test.each(['auto', 'Auto'])('is auto with COOKIE_SECURE=%s', (value) => {
    expect(secureSetting(fileWith(true), { ...OIDC_ENV, COOKIE_SECURE: value })).toBe('auto');
  });

  test.each([true, false, 'auto'])(
    'is set by auth.session.secure: %p in config.json',
    (value) => {
      expect(secureSetting(fileWith(value), OIDC_ENV)).toBe(value);
    }
  );

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

  test.each(['yes', '1', 'on'])('refuses COOKIE_SECURE=%s', (value) => {
    expect(() => buildAuthConfig({}, { ...OIDC_ENV, COOKIE_SECURE: value }))
      .toThrow(`COOKIE_SECURE must be true, false or auto, not "${value}"`);
  });
});
