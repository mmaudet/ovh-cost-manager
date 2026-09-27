/**
 * The budgets that the server gives the dashboard (#117), started in a child process, with a
 * throwaway HOME and DATA_DIR, over a database that the test seeds as the import writes it.
 * The configuration route, GET /api/config, gives the dashboard budget, that of config.json,
 * which the dashboard compares the figures of all accounts with, as before the accounts. The
 * accounts route, GET /api/accounts, gives each account's own, which it compares that
 * account's figures with: the budget of its entry of config.json, which only an import can
 * match with the account, as its name (#113), and records in the accounts table. Imported
 * data, as the name: the dashboard reloads it with the accounts once an import is over.
 */

const { startOcm } = require('./support/ocm-server');
const {
  LYON, PARIS, NEW_ACCOUNT, UNKNOWN_ACCOUNT, recordAccounts, credentials, bill,
} = require('./support/accounts');

// The answers of the server to these routes, over a database that `seed` writes to, with
// this config.json, if given
async function answersOf(routes, seed, config) {
  const ocm = await startOcm(() => ({}), { seed, config });
  try {
    const answers = [];
    for (const route of routes) {
      const { status, body } = await ocm.get(route);
      expect(status).toBe(200);
      answers.push(body);
    }
    return answers;
  } finally {
    await ocm.stop();
  }
}

// Each account that the accounts route lists, as [id, budget]
const budgetsOf = (accounts) => accounts.map(({ id, budget }) => [id, budget]);

// Its account's budget is on the accounts route: the configuration route answers as it did
// before the accounts. The server runs the tests with imports turned off.
test('gives the dashboard budget alone on the configuration route, as before the accounts',
  async () => {
    const [config, accounts] = await answersOf(['/api/config', '/api/accounts'], (db) => {
      recordAccounts(db, { nic: LYON, name: 'Lyon', budget: 20000 });
    }, {
      accounts: [{ name: 'Lyon', budget: 20000, credentials: credentials('lyon') }],
      dashboard: { budget: 80000, currency: 'EUR' },
    });

    expect(config).toEqual({ budget: 80000, currency: 'EUR', importEnabled: false });
    expect(budgetsOf(accounts)).toEqual([[LYON, 20000]]);
  }, 30000);

test("gives each account's budget on the accounts route, none for an account without one",
  async () => {
    const [accounts] = await answersOf(['/api/accounts'], (db) => {
      recordAccounts(db, { nic: LYON, name: 'Lyon subsidiary', budget: 20000 }, { nic: PARIS },
        { nic: NEW_ACCOUNT, budget: 5000 });
      // A bill that an import stored before the accounts, which no account claimed since:
      // the Unknown account's, which config.json does not configure
      bill(db, 'FR-0', '2026-06-01', null);
      bill(db, 'FR-1', '2026-06-01', LYON);
    });

    expect(budgetsOf(accounts)).toEqual([
      [LYON, 20000], [PARIS, null], [NEW_ACCOUNT, 5000], [UNKNOWN_ACCOUNT, null],
    ]);
  }, 30000);

// A budget changed in config.json shows once the account is imported again, as a new name
test('gives the budgets that the last imports recorded, not those that config.json gives now',
  async () => {
    const [accounts] = await answersOf(['/api/accounts'], (db) => {
      recordAccounts(db, { nic: LYON, name: 'Lyon', budget: 20000 });
    }, {
      accounts: [
        { name: 'Lyon', budget: 30000, credentials: credentials('lyon') },
        { name: 'Paris', budget: 10000, credentials: credentials('paris') },
      ],
    });

    expect(budgetsOf(accounts)).toEqual([[LYON, 20000]]);
  }, 30000);

// Which keeps its data and its name too (#114)
test('keeps the budget of an account that config.json no longer lists', async () => {
  const [accounts] = await answersOf(['/api/accounts'], (db) => {
    recordAccounts(db, { nic: LYON, budget: 20000 }, { nic: PARIS, budget: 8000 });
    // The configuration of the last run lists Paris alone
    db.accounts.recordConfiguration([PARIS]);
  });

  expect(accounts.map(({ id, budget, configured }) => [id, budget, configured]))
    .toEqual([[PARIS, 8000, true], [LYON, 20000, false]]);
}, 30000);
