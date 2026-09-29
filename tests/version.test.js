/**
 * The version of OCM that the server runs (#188), which the dashboard's footer shows, so that
 * whoever uses it knows which version is deployed: the configuration route gives it, which the
 * page reads as it starts, behind authentication as the rest of the API. The health check,
 * which every auth check leaves open for the container's healthcheck, does not give it: no one
 * learns the version without signing in. On the server started in a child process.
 */
const { version } = require('../package.json');
const { startOcm } = require('./support/ocm-server');

test('is the version that package.json holds, in the answer of GET /api/config', async () => {
  const ocm = await startOcm(() => ({}));
  try {
    const { status, body } = await ocm.get('/api/config');
    expect(status).toBe(200);
    expect(body.version).toBe(version);
  } finally {
    await ocm.stop();
  }
}, 30000);

test('is given to a signed-in user only when authentication is required, and never by the '
  + 'health check', async () => {
  const ocm = await startOcm(() => ({ AUTH_REQUIRED: 'true' }));
  try {
    const anonymous = await fetch(`${ocm.url}/api/config`);
    const signedIn = await fetch(`${ocm.url}/api/config`, { headers: { 'Auth-User': 'alice' } });
    const health = await fetch(`${ocm.url}/api/health`);
    expect([anonymous.status, signedIn.status, health.status]).toEqual([401, 200, 200]);
    expect((await signedIn.json()).version).toBe(version);
    expect(await health.json()).not.toHaveProperty('version');
  } finally {
    await ocm.stop();
  }
}, 30000);
