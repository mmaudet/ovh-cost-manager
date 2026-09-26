/**
 * Tests for the returnTo of /auth/login: where the callback redirects after
 * sign-in. Only a path of this site is kept; anything else gives '/', so that
 * the sign-in cannot send the user to another site.
 */

const { safeReturnTo } = require('../server/auth/return-to');

describe('safeReturnTo', () => {
  test.each([
    '/',
    '/dashboard',
    '/some/page?tab=trends#top',
    // What the dashboard sends: window.location.pathname
    '/projects/abc-123',
    // Encoded slashes stay in the path: the browser does not decode them
    '/%2F%2Fevil.example',
    '/caf%C3%A9',
  ])('keeps the path %s', (path) => {
    expect(safeReturnTo(path)).toBe(path);
  });

  test.each([
    ['an absolute URL', 'https://evil.example/'],
    ['an absolute URL without TLS', 'http://evil.example'],
    ['a protocol-relative URL', '//evil.example/'],
    ['a slash then a backslash, read as //', '/\\evil.example/'],
    ['two backslashes, read as //', '\\\\evil.example/'],
    ['a backslash then a slash', '\\/evil.example/'],
    ['a tab between the slashes, which browsers drop', '/\t/evil.example/'],
    ['a newline between the slashes, which browsers drop', '/\n/evil.example/'],
    ['a backslash further on', '/ok/..\\..\\/evil.example'],
    ['a javascript: URL', 'javascript:alert(1)'],
    ['a scheme and a path', 'data:text/html,<script>alert(1)</script>'],
    ['a host without a scheme', 'evil.example'],
    ['a relative path', 'dashboard'],
    ['a leading space', ' /dashboard'],
    ['the empty string', ''],
  ])('gives / for %s: %j', (label, value) => {
    expect(safeReturnTo(value)).toBe('/');
  });

  // req.query can hold an array (?returnTo=a&returnTo=b) or an object
  test.each([
    ['nothing', undefined],
    ['null', null],
    ['a repeated parameter', ['/a', 'https://evil.example/']],
    ['an object', { url: '/a' }],
    ['a number', 42],
  ])('gives / for %s', (label, value) => {
    expect(safeReturnTo(value)).toBe('/');
  });
});
