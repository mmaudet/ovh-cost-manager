/**
 * The accounts route, GET /api/accounts (#112), of the server started in a child process,
 * with a throwaway HOME and DATA_DIR, over a database that the test seeds as the import
 * writes it.
 */

const { startOcm } = require('./support/ocm-server');
const { SQLITE_TIME } = require('./support/accounts');

const NIC = 'xx1111-ovh';

// The accounts that the server lists, over a database that `seed` writes to, if given
async function listAccounts(seed) {
  const ocm = await startOcm(() => ({}), { seed });
  try {
    const res = await fetch(`${ocm.url}/api/accounts`);
    expect(res.status).toBe(200);
    return await res.json();
  } finally {
    await ocm.stop();
  }
}

test('lists no account before any import since the upgrade', async () => {
  expect(await listAccounts()).toEqual([]);
}, 30000);

test('lists the account that an import recorded, named by its NIC handle', async () => {
  const accounts = await listAccounts((db) => {
    db.accounts.upsert({ nic: NIC, currency: 'EUR' });
    db.accounts.recordImport(NIC, { status: 'success' });
  });

  expect(accounts).toEqual([{
    nic: NIC,
    name: NIC,
    currency: 'EUR',
    lastImport: { at: expect.stringMatching(SQLITE_TIME), status: 'success', error: null },
  }]);
}, 30000);

// The import records the account as soon as GET /me names it
test('gives no last import while the first import of the account runs', async () => {
  const accounts = await listAccounts((db) => {
    db.accounts.upsert({ nic: NIC, currency: 'EUR' });
  });

  expect(accounts).toEqual([{ nic: NIC, name: NIC, currency: 'EUR', lastImport: null }]);
}, 30000);

test('gives why the last import of the account failed', async () => {
  const accounts = await listAccounts((db) => {
    db.accounts.upsert({ nic: NIC, currency: 'EUR' });
    db.accounts.recordImport(NIC, { status: 'failed', error: 'Internal server error' });
  });

  expect(accounts.map(account => account.lastImport)).toEqual([{
    at: expect.stringMatching(SQLITE_TIME), status: 'failed', error: 'Internal server error',
  }]);
}, 30000);

// As every other API route, behind the Host and CORS checks and rate limiting too
test('answers only a signed-in user when authentication is required', async () => {
  const ocm = await startOcm(() => ({ AUTH_REQUIRED: 'true' }));
  try {
    const anonymous = await fetch(`${ocm.url}/api/accounts`);
    const signedIn = await fetch(`${ocm.url}/api/accounts`, { headers: { 'Auth-User': 'alice' } });
    expect([anonymous.status, signedIn.status]).toEqual([401, 200]);
  } finally {
    await ocm.stop();
  }
}, 30000);
