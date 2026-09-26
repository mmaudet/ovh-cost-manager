/**
 * The rate limiter of the API leaves the health check out, matched as every
 * auth check matches it: /api/health in any case, with or without a trailing
 * slash. The server runs in a child process, with a limit of 2 API requests.
 */

const { startOcm } = require('./support/ocm-server');

let ocm;

beforeAll(async () => {
  ocm = await startOcm(() => ({ RATE_LIMIT_ENABLED: 'true', RATE_LIMIT_API_MAX: '2' }));
}, 30000);

afterAll(() => ocm?.stop());

const status = async (path) => (await fetch(`${ocm.url}${path}`)).status;

test.each(['/api/health', '/api/health/', '/API/HEALTH'])(
  'never limits %s',
  async (path) => {
    const statuses = [];
    for (let i = 0; i < 4; i += 1) {
      statuses.push(await status(path));
    }
    expect(statuses).toEqual([200, 200, 200, 200]);
  }
);

test('limits the rest of the API', async () => {
  const statuses = [];
  for (let i = 0; i < 3; i += 1) {
    statuses.push(await status('/api/months'));
  }
  expect(statuses).toEqual([200, 200, 429]);
});
