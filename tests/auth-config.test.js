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
