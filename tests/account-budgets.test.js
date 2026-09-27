/**
 * The budgets of the configuration route, GET /api/config (#117), of the server started in a
 * child process, with a throwaway HOME and DATA_DIR, over a database that the test seeds as
 * the import writes it. The route gives the dashboard budget, that of config.json, which the
 * dashboard compares the figures of all accounts with, and the budget of each account that
 * has one, which it compares that account's figures with. An account's budget is that of its
 * entry of config.json, which only an import can match with the account, as its name (#113):
 * the one that its last import recorded in the accounts table.
 */

const { startOcm } = require('./support/ocm-server');
const { LYON, PARIS, NEW_ACCOUNT, recordAccounts } = require('./support/accounts');

// The configuration that the server gives, over a database that `seed` writes to, with this
// config.json, if given
async function configOf(seed, config) {
  const ocm = await startOcm(() => ({}), { seed, config });
  try {
    const { status, body } = await ocm.get('/api/config');
    expect(status).toBe(200);
    return body;
  } finally {
    await ocm.stop();
  }
}

// Invented credentials of an entry of config.json
const credentials = (key) => ({
  appKey: `app-${key}`, appSecret: `secret-${key}`, consumerKey: `consumer-${key}`,
  endpoint: 'ovh-eu',
});

// A single-account installation, whose credentials section gives its account no budget
test('gives the dashboard budget of config.json, and none for an account without one',
  async () => {
    const config = await configOf((db) => {
      recordAccounts(db, { nic: LYON });
    }, { credentials: credentials('lyon'), dashboard: { budget: 80000, currency: 'EUR' } });

    // The server runs the tests with imports turned off
    expect(config).toEqual({
      budget: 80000, accountBudgets: {}, currency: 'EUR', importEnabled: false,
    });
  }, 30000);

test("gives each account's budget, by its NIC handle, for the accounts that have one",
  async () => {
    const config = await configOf((db) => {
      recordAccounts(db, { nic: LYON, name: 'Lyon subsidiary', budget: 20000 }, { nic: PARIS },
        { nic: NEW_ACCOUNT, budget: 5000 });
    });

    // The dashboard budget of a config.json that gives none
    expect(config.budget).toBe(50000);
    expect(config.accountBudgets).toEqual({ [LYON]: 20000, [NEW_ACCOUNT]: 5000 });
  }, 30000);

// A budget changed in config.json shows once the account is imported again, as a new name
test('gives the budgets that the last imports recorded, not those that config.json gives now',
  async () => {
    const config = await configOf((db) => {
      recordAccounts(db, { nic: LYON, name: 'Lyon', budget: 20000 });
    }, {
      accounts: [
        { name: 'Lyon', budget: 30000, credentials: credentials('lyon') },
        { name: 'Paris', budget: 10000, credentials: credentials('paris') },
      ],
    });

    expect(config.accountBudgets).toEqual({ [LYON]: 20000 });
  }, 30000);

// Which keeps its data and its name too (#114)
test('keeps the budget of an account that config.json no longer lists', async () => {
  const config = await configOf((db) => {
    recordAccounts(db, { nic: LYON, budget: 20000 }, { nic: PARIS, budget: 8000 });
    // The configuration of the last run lists Paris alone
    db.accounts.recordConfiguration([PARIS]);
  });

  expect(config.accountBudgets).toEqual({ [LYON]: 20000, [PARIS]: 8000 });
}, 30000);
