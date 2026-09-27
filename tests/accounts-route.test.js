/**
 * The accounts route, GET /api/accounts (#112), of the server started in a child process,
 * with a throwaway HOME and DATA_DIR, over a database that the test seeds as the import
 * writes it.
 */

const { startOcm } = require('./support/ocm-server');
const { SQLITE_TIME } = require('./support/accounts');

const NIC = 'xx1111-ovh';
const OTHER_NIC = 'yy2222-ovh';

// The accounts that the server lists, over a database that `seed` writes to, if given, with
// this config.json, if given
async function listAccounts(seed, config) {
  const ocm = await startOcm(() => ({}), { seed, config });
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

// Each account named as the entry of config.json that its last import read names it (#113)
test('lists every account recorded, by its name, or else its NIC handle', async () => {
  const accounts = await listAccounts((db) => {
    db.accounts.upsert({ nic: NIC, currency: 'EUR', name: 'Lyon subsidiary', budget: 20000 });
    db.accounts.recordImport(NIC, { status: 'success' });
    db.accounts.upsert({ nic: OTHER_NIC, currency: 'EUR' });
    db.accounts.recordImport(OTHER_NIC, { status: 'failed', error: 'Internal server error' });
  });

  expect(accounts).toEqual([
    {
      nic: NIC,
      name: 'Lyon subsidiary',
      currency: 'EUR',
      lastImport: { at: expect.stringMatching(SQLITE_TIME), status: 'success', error: null },
    },
    {
      nic: OTHER_NIC,
      name: OTHER_NIC,
      currency: 'EUR',
      lastImport: {
        at: expect.stringMatching(SQLITE_TIME), status: 'failed', error: 'Internal server error',
      },
    },
  ]);
}, 30000);

// Only an import can tell which account an entry's credentials lead to: a rename shows once
// the account is imported again, and an entry never imported is not listed
test('names the accounts as their last import recorded them, not as config.json does now',
  async () => {
    const credentials = (key) => ({
      appKey: `app-${key}`, appSecret: `secret-${key}`, consumerKey: `consumer-${key}`,
      endpoint: 'ovh-eu',
    });
    const accounts = await listAccounts((db) => {
      db.accounts.upsert({ nic: NIC, currency: 'EUR', name: 'Lyon' });
      db.accounts.recordImport(NIC, { status: 'success' });
    }, {
      accounts: [
        { name: 'Lyon subsidiary', credentials: credentials('lyon') },
        { name: 'Paris', credentials: credentials('paris') },
      ],
    });

    expect(accounts.map(account => [account.nic, account.name])).toEqual([[NIC, 'Lyon']]);
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
