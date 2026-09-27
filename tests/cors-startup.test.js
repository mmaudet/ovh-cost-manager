/**
 * The CORS check as the server builds it at startup, from config.json, and
 * the server's answers to the origins it refuses and allows. An allowedOrigins
 * string is a comma-separated list, as ALLOWED_ORIGINS gives: used as it was,
 * it let through any origin it contained, compared as a substring. The server
 * runs in a child process, with a throwaway HOME, which holds the test's
 * config.json.
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
    await ocm.logged(`CORS: Blocked request from origin: "${origin}"`);
  });
});

test('refuses to start with an allowedOrigins neither a list nor a string', async () => {
  const { code, output } = await runOcmUntilExit({}, { config: { allowedOrigins: true } });
  expect(code).toBe(1);
  expect(output).toMatch(
    /allowedOrigins in .*config\.json must be an array of strings or a comma-separated string/
  );
}, 20000);

// The server as index.js wires it: the origin check before CORS, which adds no
// header to its 403, and before the API and the static files, the dashboard's
// page at / included, whether the dashboard is built or not. cors.test.js
// tests the check's answer and log.
describe('with https://reports.example.com listed', () => {
  const listedOrigin = 'https://reports.example.com';
  let ocm;

  beforeAll(async () => {
    ocm = await startOcm(() => ({}), { config: { allowedOrigins: [listedOrigin] } });
  }, 30000);

  afterAll(() => ocm?.stop());

  test.each(['/api/months', '/'])('answers 403 to %s from a refused origin', async (path) => {
    const res = await fetch(`${ocm.url}${path}`, { headers: { Origin: 'https://evil.example' } });
    expect(res.status).toBe(403);
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });

  test.each([
    ['the listed origin', () => listedOrigin],
    ['the dashboard\'s own origin', () => ocm.url],
  ])('answers %s, with the CORS headers', async (_, originOf) => {
    const origin = originOf();
    const res = await fetch(`${ocm.url}/api/months`, { headers: { Origin: origin } });
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe(origin);
    expect(res.headers.get('access-control-allow-credentials')).toBe('true');
  });
});
