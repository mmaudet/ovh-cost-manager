/**
 * The CORS check as the server builds it at startup, from config.json. An
 * allowedOrigins string is a comma-separated list, as ALLOWED_ORIGINS gives:
 * used as it was, it let through any origin it contained, compared as a
 * substring. The server runs in a child process, with a throwaway HOME, which
 * holds the test's config.json.
 */

const { startOcm, runOcmUntilExit } = require('./support/ocm-server');

describe('an allowedOrigins string in config.json', () => {
  let ocm;

  beforeAll(async () => {
    ocm = await startOcm(() => ({}), {
      config: { allowedOrigins: 'https://ocm.example.com, https://reports.example.com' },
    });
  }, 30000);

  afterAll(() => ocm?.stop());

  // The origin that the server allows a request from this Origin, if any
  async function allowedOrigin(origin) {
    const res = await fetch(`${ocm.url}/api/health`, { headers: { Origin: origin } });
    return res.headers.get('access-control-allow-origin');
  }

  test.each(['https://ocm.example.com', 'https://reports.example.com'])(
    'allows %s, which it lists',
    async (origin) => {
      expect(await allowedOrigin(origin)).toBe(origin);
    }
  );

  test.each([
    'https://ocm.example',
    'https://ocm.example.com.evil.example',
    'https://reports.example.co',
  ])('refuses %s, a part or an extension of a listed origin', async (origin) => {
    expect(await allowedOrigin(origin)).toBeNull();
    expect(ocm.output()).toContain(`CORS: Blocked request from origin: "${origin}"`);
  });
});

test('refuses to start with an allowedOrigins neither a list nor a string', async () => {
  const { code, output } = await runOcmUntilExit({}, { config: { allowedOrigins: true } });
  expect(code).toBe(1);
  expect(output).toMatch(
    /allowedOrigins in .*config\.json must be an array of strings or a comma-separated string/
  );
}, 20000);
