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

// 0 says what false says, and a count above 10, far above any real chain of
// proxies, would let a client choose the address that rate limiting sees
test.each(['0', '11'])('refuses TRUST_PROXY=%s, naming it', async (value) => {
  const { code, output } = await runOcmUntilExit({ TRUST_PROXY: value });
  expect(code).toBe(1);
  expect(output)
    .toContain(`TRUST_PROXY must be true, false or an integer from 1 to 10, not "${value}"`);
}, 20000);

// TRUST_PROXY drives the CORS and Host checks and the session cookie too:
// the log says it with rate limiting off, as the server runs here by default
test('logs the proxies it trusts at startup, with rate limiting off too', async () => {
  const ocm = await startOcm(() => ({ TRUST_PROXY: '2' }));
  try {
    await ocm.logged('Trust proxy: 2 proxies');
  } finally {
    await ocm.stop();
  }
}, 30000);

// The accounts of config.json (#113), which the server checks as the import reads them,
// though it never uses their keys. Invented credentials.
const credentials = {
  appKey: 'app-lyon', appSecret: 'secret-lyon', consumerKey: 'consumer-lyon', endpoint: 'ovh-eu',
};

test('refuses a malformed accounts section, naming the setting and the file', async () => {
  const { code, output } = await runOcmUntilExit({}, {
    config: { accounts: [{ name: 'Lyon', budget: '20000', credentials }] },
  });
  expect(code).toBe(1);
  expect(output).toMatch(new RegExp('accounts\\[0\\]\\.budget in .*config\\.json must be a '
    + 'positive integer \\(a JSON number\\), not "20000"'));
}, 20000);

// It would be ambiguous which accounts the import imports
test('refuses the credentials and the accounts sections together', async () => {
  const { code, output } = await runOcmUntilExit({}, {
    config: { credentials, accounts: [{ credentials }] },
  });
  expect(code).toBe(1);
  expect(output).toMatch(/credentials and accounts in .*config\.json cannot both be set/);
}, 20000);

test('starts with an accounts section', async () => {
  const ocm = await startOcm(() => ({}), {
    config: {
      accounts: [
        { name: 'Lyon', budget: 20000, credentials },
        { credentials: { ...credentials, consumerKey: 'consumer-paris' } },
      ],
    },
  });
  try {
    expect((await fetch(`${ocm.url}/api/accounts`)).status).toBe(200);
  } finally {
    await ocm.stop();
  }
}, 30000);

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
