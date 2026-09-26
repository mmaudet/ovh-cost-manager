/**
 * Tests for the health check's path, which every auth check leaves open, for
 * the container's healthcheck: /api/health as Express routes it, in any case
 * and with or without a trailing slash, and nothing else.
 */

const { isHealthCheck } = require('../server/auth/health');

// A request as a middleware sees it: req.baseUrl is the path it is mounted
// on, as the request writes it, and req.path what follows
const request = (baseUrl, path) => ({ baseUrl, path });

describe('isHealthCheck', () => {
  test.each([
    ['', '/api/health'],
    ['', '/API/HEALTH'],
    ['', '/Api/Health'],
    ['', '/api/health/'],
    ['/api', '/health'],
    ['/API', '/Health/'],
  ])('matches the health check: mounted on %p, path %s', (baseUrl, path) => {
    expect(isHealthCheck(request(baseUrl, path))).toBe(true);
  });

  test.each([
    ['', '/api/health/x'],
    ['', '/api/healthz'],
    ['', '/api/health//'],
    ['', '/api//health'],
    ['', '//api/health'],
    ['', '/api/%68ealth'],
    ['', '/health'],
    ['', '/api'],
    ['/api', '/months'],
    ['/auth', '/health'],
  ])('matches nothing else: mounted on %p, path %s', (baseUrl, path) => {
    expect(isHealthCheck(request(baseUrl, path))).toBe(false);
  });
});
