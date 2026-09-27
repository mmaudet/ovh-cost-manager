/**
 * Tests for the accounts that the configuration gives the import (#113), against a simulated
 * OVH API: the accounts section, with an optional name and budget for each account, the
 * single credentials section and the legacy flat form, which each give one unnamed account,
 * and the values that stop the import, naming the setting and the file.
 */

const {
  routes, ok, calls, clientCredentials, CREDENTIALS, CONFIG_FILES, serveAccount, useConfig,
  useConfigFiles, useThrowawayImport,
} = require('./support/simulated-ovh');
const { ACCOUNT } = require('./support/accounts');

jest.mock('ovh', () => require('./support/simulated-ovh').ovh);
jest.mock('jsonfile', () => require('./support/simulated-ovh').jsonfile);

const throwaway = useThrowawayImport('ocm-accounts-configuration-');
let db;
let importer;
beforeAll(() => {
  ({ db, importer } = throwaway);
});

beforeEach(() => {
  // The progress of the bills
  jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
});

// Two accounts that OVH serves, invented
const LYON = { nic: 'xx1111-ovh', currency: 'EUR' };
const PARIS = { nic: 'yy2222-ovh', currency: 'EUR' };

// Serves on these routes one bill of September, of one line, and no Public Cloud project
function serveBill(accountRoutes, billId) {
  accountRoutes.set('/cloud/project', ok([]));
  accountRoutes.set('/me/bill', ok([billId]));
  accountRoutes.set(`/me/bill/${billId}`, ok({
    billId,
    date: '2026-09-01T00:00:00+02:00',
    priceWithoutTax: { value: 10, currencyCode: 'EUR' },
    priceWithTax: { value: 12, currencyCode: 'EUR' },
    tax: { value: 2, currencyCode: 'EUR' },
  }));
  accountRoutes.set(`/me/bill/${billId}/details`, ok(['D1']));
  accountRoutes.set(`/me/bill/${billId}/details/D1`, ok({
    domain: 'example.com', description: 'Nom de domaine example.com', quantity: '1',
    unitPrice: { value: 10, currencyCode: 'EUR' }, totalPrice: { value: 10, currencyCode: 'EUR' },
  }));
}

// Serves on these routes no project and no bill
function serveNothing(accountRoutes) {
  accountRoutes.set('/cloud/project', ok([]));
  accountRoutes.set('/me/bill', ok([]));
}

// A period import of September, with none of the datasets that the bills do not give. Retry
// delays run on fake timers, so a retried call costs no real time.
async function importSeptember() {
  const done = importer.runImport({ from: '2026-09-01', to: '2026-09-30' });
  await jest.runAllTimersAsync();
  await done;
}

// The accounts recorded, as [NIC handle, name, budget, status of their last import]
const recordedAccounts = () => db.accounts.getAll()
  .map(account => [account.nic, account.name, account.budget, account.last_import_status]);

// The bills stored, as [id, NIC handle of their account]
const storedBills = () => db.getDb().prepare('SELECT id, account FROM bills ORDER BY id').all()
  .map(bill => [bill.id, bill.account]);

describe('the accounts section', () => {
  test('gives each account a name and a budget, or none, which the import records', async () => {
    const lyon = serveAccount(LYON);
    const paris = serveAccount(PARIS);
    serveNothing(lyon.routes);
    serveNothing(paris.routes);
    useConfig({
      accounts: [
        { name: 'Lyon subsidiary', budget: 20000, credentials: lyon.credentials },
        { credentials: paris.credentials },
      ],
    });

    await importSeptember();

    expect(recordedAccounts()).toEqual([
      [LYON.nic, 'Lyon subsidiary', 20000, 'success'],
      [PARIS.nic, null, null, 'success'],
    ]);
  });

  // The account is its NIC handle: an entry of config.json only names it
  test('takes a new name or budget at the next import, the account keeping its data',
    async () => {
      const lyon = serveAccount(LYON);
      serveBill(lyon.routes, 'FR1');
      useConfig({ accounts: [{ name: 'Lyon', budget: 20000, credentials: lyon.credentials }] });
      await importSeptember();

      useConfig({ accounts: [{ name: 'Lyon subsidiary', credentials: lyon.credentials }] });
      await importSeptember();

      expect(recordedAccounts()).toEqual([[LYON.nic, 'Lyon subsidiary', null, 'success']]);
      expect(storedBills()).toEqual([['FR1', LYON.nic]]);
    });
});

describe('a single account without a name', () => {
  // As before the accounts section, which reads it as unnamed. The account of the tests has
  // no endpoint, which the OVH client does without, except in the accounts section.
  test.each([
    ['the credentials section', () => useConfig({ credentials: CREDENTIALS })],
    ['the credentials at the top of config.json, in the legacy form',
      () => useConfig({ ...CREDENTIALS })],
    ['the legacy credentials file', () => useConfig({ ...CREDENTIALS }, 'legacy')],
    ['an accounts section of one account without a name',
      () => useConfig({ accounts: [{ credentials: { ...CREDENTIALS, endpoint: 'ovh-eu' } }] })],
  ])('is read from %s', async (_, configure) => {
    configure();
    serveNothing(routes);

    await importSeptember();

    expect(recordedAccounts()).toEqual([[ACCOUNT.nic, null, null, 'success']]);
  });

  // As before: the client takes the API's host from an endpoint, or a host, or else the EU
  // one. The legacy flat form gives it the whole file.
  test.each([
    ['a credentials section without an endpoint', { credentials: { ...CREDENTIALS } },
      { ...CREDENTIALS }],
    ['a credentials section with a host',
      { credentials: { ...CREDENTIALS, host: 'ca.api.ovh.com' } },
      { ...CREDENTIALS, host: 'ca.api.ovh.com' }],
    ['the legacy flat form, with other settings',
      { ...CREDENTIALS, endpoint: 'ovh-ca', dashboard: { budget: 50000 } },
      { ...CREDENTIALS, endpoint: 'ovh-ca', dashboard: { budget: 50000 } }],
  ])('is given to the OVH client as it is, from %s', async (_, config, credentials) => {
    useConfig(config);
    serveNothing(routes);

    await importSeptember();

    expect(clientCredentials).toEqual([credentials]);
    expect(recordedAccounts()).toEqual([[ACCOUNT.nic, null, null, 'success']]);
  });

  // As before: a config.json of other settings leaves the credentials to the next place
  test('is read from the first configuration file that configures an account', async () => {
    useConfigFiles({ project: { dashboard: { budget: 50000 } }, legacy: { ...CREDENTIALS } });
    serveNothing(routes);

    await importSeptember();

    expect(recordedAccounts()).toEqual([[ACCOUNT.nic, null, null, 'success']]);
  });
});

describe('a configuration that the import refuses', () => {
  const FILE = CONFIG_FILES.project;
  // Credentials that the refusals never get to use
  const credentials = {
    appKey: 'app-lyon', appSecret: 'secret-lyon', consumerKey: 'consumer-lyon',
    endpoint: 'ovh-eu',
  };
  const other = { ...credentials, consumerKey: 'consumer-paris' };
  const { endpoint, ...withoutEndpoint } = credentials;

  // Stops the import before it takes the lock or calls the API
  async function expectRefused(message) {
    await importSeptember();

    expect(process.exit).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(`Error: ${message}`);
    expect(db.importLog.getAll()).toEqual([]);
    expect(calls).toEqual([]);
  }

  test.each([
    // It would be ambiguous which accounts are imported
    ['both the credentials and the accounts sections',
      { credentials, accounts: [{ credentials: other }] },
      `credentials and accounts in ${FILE} cannot both be set: list every account under `
        + 'accounts'],
    ['an accounts section that is not an array', { accounts: { name: 'Lyon', credentials } },
      `accounts in ${FILE} must be an array of accounts, not an object`],
    ['an accounts section that lists none', { accounts: [] },
      `accounts in ${FILE} must list at least one account`],
    // Not the text of a string, which could be a key put in the wrong place
    ['an account that is not an object', { accounts: ['app-lyon'] },
      `accounts[0] in ${FILE} must be an object, not a string`],
    ['a name that is not a string', { accounts: [{ name: 42, credentials }] },
      `accounts[0].name in ${FILE} must be a non-empty string, not 42`],
    ['a blank name', { accounts: [{ name: ' ', credentials }] },
      `accounts[0].name in ${FILE} must be a non-empty string, not " "`],
    // The account selector would show two identical entries
    ['two accounts of the same name',
      { accounts: [{ name: 'Lyon', credentials }, { name: 'Lyon', credentials: other }] },
      `accounts[1].name in ${FILE} must be unique among the accounts: accounts[0] is named `
        + '"Lyon" too'],
    ['a budget in a string', { accounts: [{ budget: '20000', credentials }] },
      `accounts[0].budget in ${FILE} must be a positive integer (a JSON number), not "20000"`],
    ['a budget of 0', { accounts: [{ budget: 0, credentials }] },
      `accounts[0].budget in ${FILE} must be a positive integer (a JSON number), not 0`],
    ['a budget with decimals', { accounts: [{ budget: 12.5, credentials }] },
      `accounts[0].budget in ${FILE} must be a positive integer (a JSON number), not 12.5`],
    ['an account without credentials', { accounts: [{ name: 'Lyon' }] },
      `accounts[0].credentials in ${FILE} is missing: it must be an object that holds appKey, `
        + 'appSecret, consumerKey and endpoint'],
    ['credentials that are not an object', { accounts: [{ credentials: 'app-lyon' }] },
      `accounts[0].credentials in ${FILE} must be an object, not a string`],
    ['credentials without an endpoint', { accounts: [{ credentials: withoutEndpoint }] },
      `accounts[0].credentials.endpoint in ${FILE} is missing: it must be a non-empty string`],
    ['an empty application key', { accounts: [{ credentials: { ...credentials, appKey: '' } }] },
      `accounts[0].credentials.appKey in ${FILE} must be a non-empty string, not an empty `
        + 'string'],
    // Not its value, which is a secret
    ['a consumer key that is not a string',
      { accounts: [{ credentials: { ...credentials, consumerKey: 12345 } }] },
      `accounts[0].credentials.consumerKey in ${FILE} must be a non-empty string, not a number`],
    ['a malformed credentials section', { credentials: { ...credentials, appSecret: null } },
      `credentials.appSecret in ${FILE} must be a non-empty string, not null`],
    ['legacy credentials without a consumer key', { appKey: 'app-lyon', appSecret: 'secret-lyon' },
      `consumerKey in ${FILE} is missing: it must be a non-empty string`],
  ])('stops the import on %s, naming the setting and the file', async (_, config, message) => {
    useConfig(config);

    await expectRefused(message);
  });

  test('stops the import on a configuration file that cannot be read, naming it', async () => {
    useConfig(new SyntaxError(`${FILE}: Unexpected token } in JSON at position 1`));

    await expectRefused(`${FILE} cannot be read: Unexpected token } in JSON at position 1`);
  });

  test('stops the import when no configuration file configures an account', async () => {
    useConfig({ dashboard: { budget: 50000 } });

    await expectRefused([
      'No valid configuration file found.',
      'Searched paths:',
      `  - ${CONFIG_FILES.project}`,
      `  - ${CONFIG_FILES.home}`,
      `  - ${CONFIG_FILES.legacy}`,
      '',
      'Please create config.json with valid OVH API credentials.',
    ].join('\n'));
  });
});
