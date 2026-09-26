/**
 * Tests for the health check's path, which every auth check leaves open, for
 * the container's healthcheck: /api/health as Express routes it, in any case
 * and with or without a trailing slash, and nothing else.
 */

const { isHealthCheck } = require('../server/auth/health');

// A request as a middleware sees it: req.originalUrl is the path the request
// writes; req.baseUrl the path the middleware is mounted on, as matched, and
// req.path what follows
const request = (originalUrl, baseUrl = '', path = originalUrl.split('?')[0]) => ({
  originalUrl,
  baseUrl,
  path,
});

describe('isHealthCheck', () => {
  test.each([
    ['/api/health'],
    ['/API/HEALTH'],
    ['/Api/Health'],
    ['/api/health/'],
    ['/api/health?probe=1'],
    ['/api/health', '/api', '/health'],
    ['/API/Health/', '/API', '/Health/'],
  ])('matches the health check: %s, mounted on %p', (...args) => {
    expect(isHealthCheck(request(...args))).toBe(true);
  });

  test.each([
    ['/api/health/x'],
    ['/api/healthz'],
    ['/api/health//'],
    ['/api//health'],
    ['//api/health'],
    ['/api/%68ealth'],
    ['/health'],
    ['/api'],
    ['/api/months', '/api', '/months'],
    ['/auth/health', '/auth', '/health'],
    // Mounted on /api, the path lost its second slash, which the routes keep:
    // no route serves the health check there
    ['/api//health', '/api', '/health'],
    ['/API//Health/', '/API', '/Health/'],
  ])('matches nothing else: %s, mounted on %p', (...args) => {
    expect(isHealthCheck(request(...args))).toBe(false);
  });
});
