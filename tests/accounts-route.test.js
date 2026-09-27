/**
 * The accounts route, GET /api/accounts (#112), of the server started in a child process,
 * with a throwaway HOME and DATA_DIR, over a database that the test seeds as the import
 * writes it.
 */

const { startOcm } = require('./support/ocm-server');
const { SQLITE_TIME, LYON, PARIS, NEW_ACCOUNT, bill } = require('./support/accounts');
const { asBefore114 } = require('./support/database-before');

// The entry of the Unknown account (see CONTEXT.md): the rows that no account claims (#114)
const UNKNOWN = {
  id: 'unknown', nic: null, name: null, currency: null, configured: false, unknown: true,
  lastImport: null,
};

// The accounts that the server lists, over a database that `seed` writes to, if given, with
// this config.json, if given
async function listAccounts(seed, config) {
  const ocm = await startOcm(() => ({}), { seed, config });
  try {
    const { status, body } = await ocm.get('/api/accounts');
    expect(status).toBe(200);
    return body;
  } finally {
    await ocm.stop();
  }
}

// Records these accounts as an import does, and the configuration of its run, which lists
// them in this order
function recordAccounts(db, ...accounts) {
  for (const account of accounts) db.accounts.upsert({ currency: 'EUR', ...account });
  db.accounts.recordConfiguration(accounts.map(({ nic }) => nic));
}

// A bill that an import stored before the accounts, which no account claimed since: the
// writers refuse such rows now, so it is written as the database held it
const storeBillWithoutAccount = (db, id) => db.getDb().prepare(`
  INSERT INTO bills (id, date, price_without_tax, currency, account)
  VALUES (?, '2026-06-01', 10, 'EUR', NULL)
`).run(id);

test('lists no account before any import since the upgrade', async () => {
  expect(await listAccounts()).toEqual([]);
}, 30000);

test('lists the account that an import recorded, named by its NIC handle', async () => {
  const accounts = await listAccounts((db) => {
    recordAccounts(db, { nic: LYON });
    db.accounts.recordImport(LYON, { status: 'success' });
  });

  expect(accounts).toEqual([{
    id: LYON,
    nic: LYON,
    name: LYON,
    currency: 'EUR',
    configured: true,
    unknown: false,
    lastImport: { at: expect.stringMatching(SQLITE_TIME), status: 'success', error: null },
  }]);
}, 30000);

// The import records the account as soon as GET /me names it
test('gives no last import while the first import of the account runs', async () => {
  const accounts = await listAccounts((db) => {
    recordAccounts(db, { nic: LYON });
  });

  expect(accounts).toEqual([{
    id: LYON, nic: LYON, name: LYON, currency: 'EUR', configured: true, unknown: false,
    lastImport: null,
  }]);
}, 30000);

test('gives why the last import of the account failed', async () => {
  const accounts = await listAccounts((db) => {
    recordAccounts(db, { nic: LYON });
    db.accounts.recordImport(LYON, { status: 'failed', error: 'Internal server error' });
  });

  expect(accounts.map(account => account.lastImport)).toEqual([{
    at: expect.stringMatching(SQLITE_TIME), status: 'failed', error: 'Internal server error',
  }]);
}, 30000);

// Each account named as the entry of config.json that its last import read names it (#113)
test('lists every account recorded, by its name, or else its NIC handle', async () => {
  const accounts = await listAccounts((db) => {
    recordAccounts(db, { nic: LYON, name: 'Lyon subsidiary', budget: 20000 }, { nic: PARIS });
    db.accounts.recordImport(LYON, { status: 'success' });
    db.accounts.recordImport(PARIS, { status: 'failed', error: 'Internal server error' });
  });

  expect(accounts).toEqual([
    {
      id: LYON,
      nic: LYON,
      name: 'Lyon subsidiary',
      currency: 'EUR',
      configured: true,
      unknown: false,
      lastImport: { at: expect.stringMatching(SQLITE_TIME), status: 'success', error: null },
    },
    {
      id: PARIS,
      nic: PARIS,
      name: PARIS,
      currency: 'EUR',
      configured: true,
      unknown: false,
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
      recordAccounts(db, { nic: LYON, name: 'Lyon' });
      db.accounts.recordImport(LYON, { status: 'success' });
    }, {
      accounts: [
        { name: 'Lyon subsidiary', credentials: credentials('lyon') },
        { name: 'Paris', credentials: credentials('paris') },
      ],
    });

    expect(accounts.map(account => [account.nic, account.name])).toEqual([[LYON, 'Lyon']]);
  }, 30000);

// The configured accounts first, in the order of the configuration that the last import
// read, then those that it no longer lists, and the Unknown account last (#114)
test('lists the configured accounts in their order, then the others, then the Unknown account',
  async () => {
    const accounts = await listAccounts((db) => {
      recordAccounts(db, { nic: NEW_ACCOUNT }, { nic: 'ab4444-ovh' }, { nic: PARIS },
        { nic: LYON });
      // The last import's configuration lists Paris, then Lyon
      db.accounts.recordConfiguration([PARIS, LYON]);
      bill(db, 'FR-1', '2026-06-01', LYON);
      storeBillWithoutAccount(db, 'FR-0');
    });

    expect(accounts.map(({ id, configured, unknown }) => ({ id, configured, unknown })))
      .toEqual([
        { id: PARIS, configured: true, unknown: false },
        { id: LYON, configured: true, unknown: false },
        { id: 'ab4444-ovh', configured: false, unknown: false },
        { id: NEW_ACCOUNT, configured: false, unknown: false },
        { id: 'unknown', configured: false, unknown: true },
      ]);
    expect(accounts.at(-1)).toEqual(UNKNOWN);
  }, 30000);

// Rows stored before the accounts that no account claimed: whatever table holds them
test('lists the Unknown account while some table holds rows without an account', async () => {
  const accounts = await listAccounts((db) => {
    recordAccounts(db, { nic: LYON });
    bill(db, 'FR-1', '2026-06-01', LYON);
    db.getDb().prepare(`
      INSERT INTO consumption_history (period_start, period_end, total, currency)
      VALUES ('2026-07-01', '2026-07-31', 90, 'EUR')
    `).run();
  });

  expect(accounts.map(account => account.id)).toEqual([LYON, 'unknown']);
}, 30000);

// Every account recorded then was configured at its last import: until the next import
// records the configuration, they are listed as configured, in the order first recorded
test('lists the accounts recorded before the upgrade as configured', async () => {
  const accounts = await listAccounts((db) => {
    db.accounts.upsert({ nic: PARIS, currency: 'EUR' });
    db.accounts.upsert({ nic: LYON, currency: 'EUR' });
    asBefore114(db.getDb());
  });

  expect(accounts.map(({ id, configured }) => [id, configured]))
    .toEqual([[PARIS, true], [LYON, true]]);
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
