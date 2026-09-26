/**
 * The server stops at startup on a setting that would turn a protection off,
 * naming the setting, rather than run without it. It runs in a child process,
 * with a throwaway HOME, which holds the test's config.json.
 */

const { startOcm, runOcmUntilExit } = require('./support/ocm-server');

// express-rate-limit compared each count to "abc", and limited nothing
test('refuses a rate limit that is not a number', async () => {
  const { code, output } = await runOcmUntilExit({}, {
    config: { rateLimit: { api: { max: 'abc' } } },
  });
  expect(code).toBe(1);
  expect(output).toMatch(/rateLimit\.api\.max in .*config\.json must be a positive integer/);
}, 20000);

// Authentication was off, its settings read from true
test('refuses an auth section that is not an object', async () => {
  const { code, output } = await runOcmUntilExit({}, { config: { auth: true } });
  expect(code).toBe(1);
  expect(output).toMatch(/auth in .*config\.json must be an object, not true/);
}, 20000);

test('refuses an IMPORT_ENABLED other than true or false', async () => {
  const { code, output } = await runOcmUntilExit({ IMPORT_ENABLED: 'no' });
  expect(code).toBe(1);
  expect(output).toContain('IMPORT_ENABLED must be true or false, not "no"');
}, 20000);

// It left the imports and the resync on
test('reads IMPORT_ENABLED=FALSE as false', async () => {
  const ocm = await startOcm(() => ({ IMPORT_ENABLED: 'FALSE' }));
  try {
    const res = await fetch(`${ocm.url}/api/config`);
    expect((await res.json()).importEnabled).toBe(false);
  } finally {
    await ocm.stop();
  }
}, 30000);
