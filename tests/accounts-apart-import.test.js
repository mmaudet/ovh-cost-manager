/**
 * Tests for keeping the accounts of one database apart (#114), against a simulated OVH API
 * that serves each account through its own credentials: importing an account never touches
 * another account's data, and a service that two accounts list is stored once.
 */

const {
  ok, calls, serveAccount, useConfig, useThrowawayImport,
} = require('./support/simulated-ovh');
const { asBefore114 } = require('./support/database-before');

jest.mock('ovh', () => require('./support/simulated-ovh').ovh);
jest.mock('jsonfile', () => require('./support/simulated-ovh').jsonfile);

const throwaway = useThrowawayImport('ocm-accounts-apart-');
let db;
let importer;
beforeAll(() => {
  ({ db, importer } = throwaway);
});

beforeEach(() => {
  // The day the differential imports run to
  jest.setSystemTime(new Date('2026-09-15T10:00:00Z'));
  // The progress of the bills
  jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
});

// The accounts that OVH serves, invented
const LYON = { nic: 'xx1111-ovh', currency: 'EUR' };
const PARIS = { nic: 'yy2222-ovh', currency: 'EUR' };

// Credentials that lead to no account, as a revoked key
const REVOKED = {
  credentials: {
    appKey: 'app-revoked', appSecret: 'secret-revoked', consumerKey: 'consumer-revoked',
    endpoint: 'ovh-eu',
  },
};

// Configures these accounts, in this order, under the accounts section: each entry is an
// account that OVH serves, with the fields of its entry, such as its name
const useAccounts = (...entries) => useConfig({
  accounts: entries.map(({ served, ...fields }) => ({
    ...fields, credentials: served.credentials,
  })),
});

// Serves on these routes these bills, as [id, date, domains]: each line of a bill names one
// of its domains, the service it bills, for 10. The bill list gives those of the dates asked
// for, as OVH filters it on date.from and date.to, both included.
function serveBills(accountRoutes, bills) {
  accountRoutes.set('/me/bill', (params = {}) => Promise.resolve(bills
    .filter(([, date]) => (!params['date.from'] || date >= params['date.from'])
      && (!params['date.to'] || date <= params['date.to']))
    .map(([id]) => id)));
  for (const [id, date, domains = ['example.com']] of bills) {
    const amount = (value) => ({ value, currencyCode: 'EUR' });
    accountRoutes.set(`/me/bill/${id}`, ok({
      billId: id,
      date: `${date}T00:00:00+02:00`,
      priceWithoutTax: amount(10 * domains.length),
      priceWithTax: amount(12 * domains.length),
      tax: amount(2 * domains.length),
    }));
    accountRoutes.set(`/me/bill/${id}/details`, ok(domains.map((_, index) => `D${index + 1}`)));
    domains.forEach((domain, index) => accountRoutes.set(`/me/bill/${id}/details/D${index + 1}`,
      ok({
        domain, description: `Service ${domain}`, quantity: '1', unitPrice: amount(10),
        totalPrice: amount(10),
      })));
  }
}

// Serves on these routes these Public Cloud projects, named by their ids
function serveProjects(accountRoutes, ids = []) {
  accountRoutes.set('/cloud/project', ok(ids));
  for (const id of ids) {
    accountRoutes.set(`/cloud/project/${id}`, ok({ description: id, status: 'ok' }));
  }
}

// Serves on these routes the inventories: these dedicated servers, VPS and NetApp storage
// services, and their details
function serveInventories(accountRoutes, { servers = [], vps = [], storage = [] } = {}) {
  accountRoutes.set('/dedicated/server', ok(servers));
  for (const name of servers) {
    accountRoutes.set(`/dedicated/server/${name}`, ok({ datacenter: 'rbx8', state: 'ok' }));
  }
  accountRoutes.set('/vps', ok(vps));
  for (const name of vps) {
    accountRoutes.set(`/vps/${name}`, ok({ name, state: 'running', model: { vcore: 2, disk: 40 } }));
  }
  accountRoutes.set('/storage/netapp', ok(storage));
  for (const id of storage) {
    accountRoutes.set(`/storage/netapp/${id}`, ok({ name: id, region: 'eu-west-gra' }));
  }
}

// A service of the account, as an earlier import stored it
const storeServer = (id, nic) => db.inventory.upsertServer({
  id, display_name: id, reverse: '', datacenter: 'rbx8', os: '', state: 'ok', cpu: '',
  ram_size: 0, disk_info: '[]', bandwidth: 0, expiration_date: null, renewal_type: '',
  account: nic,
});
const storeVps = (id, nic) => db.inventory.upsertVps({
  id, display_name: id, model: '', zone: '', state: 'running', os: '', vcpus: 2, ram_mb: 2048,
  disk_gb: 40, expiration_date: null, renewal_type: '', ip_addresses: '[]', account: nic,
});
const storeStorage = (id, nic) => db.inventory.upsertStorage({
  id, service_type: 'netapp', display_name: id, region: 'eu-west-gra', total_size_gb: 1024,
  used_size_gb: 0, share_count: 0, expiration_date: null, account: nic,
});

// Runs an import as import.js runs it with these options. Retry delays run on fake timers,
// so a retried call costs no real time.
async function runImport(params) {
  const done = importer.runImport(params);
  await jest.runAllTimersAsync();
  await done;
}

// A period import of September, with the datasets and the options given
const importSeptember = (options = {}) =>
  runImport({ from: '2026-09-01', to: '2026-09-30', ...options });

// The rows of a table as [id, NIC handle of their account], by id
const accountsOf = (table) => db.getDb()
  .prepare(`SELECT id, account FROM ${table} ORDER BY id`)
  .all()
  .map(row => [row.id, row.account]);

// The services of the inventories, as [id, NIC handle of their account] by kind
const storedServices = () => ({
  servers: accountsOf('dedicated_servers'),
  vps: accountsOf('vps_instances'),
  storage: accountsOf('storage_services'),
});

describe('the removal of the services that OVH no longer lists', () => {
  test('removes those of the importing account only', async () => {
    const lyon = serveAccount(LYON);
    const paris = serveAccount(PARIS);
    // Cancelled since an earlier import of Lyon
    storeServer('ns-lyon-cancelled', LYON.nic);
    storeVps('vps-lyon-cancelled', LYON.nic);
    storeStorage('netapp-lyon-cancelled', LYON.nic);
    // Paris's, which Lyon's API does not list
    storeServer('ns-paris', PARIS.nic);
    storeVps('vps-paris', PARIS.nic);
    storeStorage('netapp-paris', PARIS.nic);
    serveProjects(lyon.routes);
    serveBills(lyon.routes, []);
    serveInventories(lyon.routes, { servers: ['ns-lyon'], vps: ['vps-lyon'], storage: ['netapp-lyon'] });
    useAccounts({ served: lyon }, { served: paris });

    await importSeptember({ account: LYON.nic, includeInventory: true });

    expect(storedServices()).toEqual({
      servers: [['ns-lyon', LYON.nic], ['ns-paris', PARIS.nic]],
      vps: [['vps-lyon', LYON.nic], ['vps-paris', PARIS.nic]],
      storage: [['netapp-lyon', LYON.nic], ['netapp-paris', PARIS.nic]],
    });
  });
});

// A Public Cloud project of the account, as an earlier import stored it
const storeProject = (id, nic) => db.projects.upsert({
  id, name: id, description: null, status: 'ok', created_at: null, account: nic,
});

// The services that two accounts' APIs can list: the table that stores each kind, how an
// account's API lists it, and how an earlier import stored one
const KINDS = {
  'Public Cloud project': {
    table: 'projects', serve: (routes, ids) => serveProjects(routes, ids), store: storeProject,
  },
  'dedicated server': {
    table: 'dedicated_servers',
    serve: (routes, ids) => serveInventories(routes, { servers: ids }),
    store: storeServer,
  },
  VPS: {
    table: 'vps_instances',
    serve: (routes, ids) => serveInventories(routes, { vps: ids }),
    store: storeVps,
  },
  'NetApp storage service': {
    table: 'storage_services',
    serve: (routes, ids) => serveInventories(routes, { storage: ids }),
    store: storeStorage,
  },
};

describe.each(Object.entries(KINDS))('a %s that two accounts list', (_, { table, serve, store }) => {
  const SHARED = 'svc-shared';

  // Both accounts' APIs list it, with these bills, as serveBills() takes them. Lyon is
  // configured first.
  function serveBoth({ lyonBills = [], parisBills = [] } = {}) {
    const lyon = serveAccount(LYON);
    const paris = serveAccount(PARIS);
    for (const [served, bills] of [[lyon, lyonBills], [paris, parisBills]]) {
      serveProjects(served.routes);
      serveInventories(served.routes);
      serve(served.routes, [SHARED]);
      serveBills(served.routes, bills);
    }
    useAccounts({ served: lyon }, { served: paris });
  }

  // Whichever lists it first: Lyon stores it before Paris's bills are imported
  test.each([['Lyon', LYON], ['Paris', PARIS]])(
    'is stored once, as %s, whose bill lines name it', async (__, billing) => {
      const bill = [['FR-1', '2026-09-01', [SHARED]]];
      serveBoth(billing === LYON ? { lyonBills: bill } : { parisBills: bill });

      await importSeptember({ includeInventory: true });

      expect(accountsOf(table)).toEqual([[SHARED, billing.nic]]);
    });

  test('goes to the first configured account that lists it, when no bill line names it',
    async () => {
      serveBoth();

      await importSeptember({ includeInventory: true });

      expect(accountsOf(table)).toEqual([[SHARED, LYON.nic]]);
    });

  test('is never taken over by another account that lists it', async () => {
    serveBoth();
    store(SHARED, PARIS.nic);

    await importSeptember({ account: LYON.nic, includeInventory: true });

    expect(accountsOf(table)).toEqual([[SHARED, PARIS.nic]]);
  });
});

// Serves on these routes an account's consumption: nothing yet this month, and a history of
// one month, which OVH gives for the past year
function serveConsumption(accountRoutes, month, total) {
  accountRoutes.set('/me/consumption/usage/current', ok([]));
  accountRoutes.set('/me/consumption/usage/forecast', ok([]));
  accountRoutes.set('/me/consumption/usage/history', ok([{
    beginDate: `${month}-01T00:00:00+02:00`,
    endDate: `${month}-28T23:59:59+02:00`,
    price: { value: total, currencyCode: 'EUR' },
    elements: [{ planFamily: 'consumption' }],
  }]));
}

// The consumption history stored, as [NIC handle of its account, month, total]
const storedHistory = () => db.getDb().prepare(`
  SELECT account, period_start, total FROM consumption_history ORDER BY account, period_start
`).all().map(row => [row.account, row.period_start, row.total]);

describe('the consumption history', () => {
  test('is replaced for the importing account only', async () => {
    const lyon = serveAccount(LYON);
    const paris = serveAccount(PARIS);
    for (const served of [lyon, paris]) {
      serveProjects(served.routes);
      serveBills(served.routes, []);
    }
    serveConsumption(lyon.routes, '2026-07', 100);
    serveConsumption(paris.routes, '2026-07', 200);
    useAccounts({ served: lyon }, { served: paris });
    await importSeptember({ includeConsumption: true });
    // A month later, OVH gives Lyon a history that has moved on
    serveConsumption(lyon.routes, '2026-08', 110);

    await importSeptember({ account: LYON.nic, includeConsumption: true });

    expect(storedHistory()).toEqual([
      [LYON.nic, '2026-08-01', 110], [PARIS.nic, '2026-07-01', 200],
    ]);
  });
});

// Serves on these routes an account's balance: no debt, no deposit, and these credit
// balances, by name, each with its movements as [number, amount]
function serveBalance(accountRoutes, balances) {
  const amount = (value) => ({ value, currencyCode: 'EUR' });
  accountRoutes.set('/me/debtAccount', ok({ todoAmount: amount(0) }));
  accountRoutes.set('/me/deposit', ok([]));
  accountRoutes.set('/me/credit/balance', ok(Object.keys(balances)));
  for (const [name, movements] of Object.entries(balances)) {
    const total = movements.reduce((sum, [, value]) => sum + value, 0);
    accountRoutes.set(`/me/credit/balance/${name}`, ok({ amount: amount(total) }));
    accountRoutes.set(`/me/credit/balance/${name}/movement`, ok(movements.map(([id]) => id)));
    for (const [id, value] of movements) {
      accountRoutes.set(`/me/credit/balance/${name}/movement/${id}`, ok({
        amount: amount(value), creationDate: '2026-09-01T00:00:00+02:00',
        description: `Movement ${id}`, type: 'VOUCHER',
      }));
    }
  }
}

// The credit movements stored, as [NIC handle of their account, id, amount]
const storedMovements = () => db.getDb().prepare(`
  SELECT account, id, amount FROM credit_movements ORDER BY account, id
`).all().map(row => [row.account, row.id, row.amount]);

describe('the credit movements', () => {
  // Their ids join the name of their balance and their number, which two accounts can share
  test('of two accounts are kept apart, even with the same ids', async () => {
    const lyon = serveAccount(LYON);
    const paris = serveAccount(PARIS);
    for (const served of [lyon, paris]) {
      serveProjects(served.routes);
      serveBills(served.routes, []);
    }
    serveBalance(lyon.routes, { PREPAID_ACCOUNT: [[1, 50]] });
    serveBalance(paris.routes, { PREPAID_ACCOUNT: [[1, 20]] });
    useAccounts({ served: lyon }, { served: paris });

    await importSeptember({ includeAccount: true });

    expect(storedMovements()).toEqual([
      [LYON.nic, 'PREPAID_ACCOUNT_1', 50], [PARIS.nic, 'PREPAID_ACCOUNT_1', 20],
    ]);
  });

  // Keyed by their id alone before #114
  test('stored before the upgrade are kept, and replaced when imported again', async () => {
    const lyon = serveAccount(LYON);
    serveProjects(lyon.routes);
    serveBills(lyon.routes, []);
    serveBalance(lyon.routes, { PREPAID_ACCOUNT: [[1, 50], [2, -20]] });
    useAccounts({ served: lyon });
    await importSeptember({ includeAccount: true });
    asBefore114(db.getDb());
    db.closeDb();
    // Since then, OVH has corrected the second one
    serveBalance(lyon.routes, { PREPAID_ACCOUNT: [[1, 50], [2, -25]] });

    await importSeptember({ includeAccount: true });

    expect(storedMovements()).toEqual([
      [LYON.nic, 'PREPAID_ACCOUNT_1', 50], [LYON.nic, 'PREPAID_ACCOUNT_2', -25],
    ]);
  });
});

// Serves on these routes the usage of a Public Cloud project over the month of `from`, up to
// `to`: without any usage, which is enough for the month to be recorded
function serveUsage(accountRoutes, projectId, from, to) {
  accountRoutes.set(`/cloud/project/${projectId}/usage/current`, ok({
    period: { from: `${from}T00:00:00+02:00`, to: `${to}T12:00:00+02:00` }, hourlyUsage: {},
  }));
}

// The month of the current consumption that each account's import recorded, as [NIC handle
// of the account, first day of the month]
const recordedMonths = () => db.getDb().prepare(`
  SELECT account, value FROM import_state WHERE key = 'consumption_month' ORDER BY account
`).all().map(row => [row.account, row.value]);

describe('the month of the current consumption', () => {
  // OVH can be late to start the month for some projects
  test('is recorded for each account, the latest being the current one', async () => {
    const lyon = serveAccount(LYON);
    const paris = serveAccount(PARIS);
    serveProjects(lyon.routes, ['proj-lyon']);
    serveProjects(paris.routes, ['proj-paris']);
    for (const served of [lyon, paris]) serveBills(served.routes, []);
    serveUsage(lyon.routes, 'proj-lyon', '2026-09-01', '2026-09-15');
    serveUsage(paris.routes, 'proj-paris', '2026-08-01', '2026-08-31');
    useAccounts({ served: lyon }, { served: paris });

    await importSeptember({ includeCloudDetails: true });

    expect(db.cloudDetails.getCurrentConsumptionMonth()).toBe('2026-09-01');
    expect(recordedMonths()).toEqual([[LYON.nic, '2026-09-01'], [PARIS.nic, '2026-08-01']]);
  });
});

// The accounts recorded, as [NIC handle, place in the configuration of the last run, from 0,
// or null when it does not list the account]
const placesInConfiguration = () => db.getDb()
  .prepare('SELECT nic, position FROM accounts ORDER BY nic')
  .all()
  .map(row => [row.nic, row.position]);

// The routes that the clients of an account's credentials called, in order
const routesCalledWith = ({ credentials }) => calls
  .filter(call => call.consumerKey === credentials.consumerKey)
  .map(call => call.route);

describe('the accounts that the configuration lists', () => {
  // Lyon and Paris, each with a bill of September, and Paris with a project
  function serveLyonAndParis() {
    const lyon = serveAccount(LYON);
    const paris = serveAccount(PARIS);
    serveProjects(lyon.routes);
    serveProjects(paris.routes, ['proj-paris']);
    serveBills(lyon.routes, [['FR-L1', '2026-09-01']]);
    serveBills(paris.routes, [['FR-P1', '2026-09-01']]);
    return { lyon, paris };
  }

  test('are recorded in the order of the configuration, whatever the run imports of them',
    async () => {
      const { lyon, paris } = serveLyonAndParis();
      useAccounts({ served: lyon }, { served: paris });
      await importSeptember();
      // Reordered since
      useAccounts({ served: paris }, { served: lyon });

      await importSeptember({ account: PARIS.nic });

      expect(placesInConfiguration()).toEqual([[LYON.nic, 1], [PARIS.nic, 0]]);
    });

  // Its GET /me cannot name it, but its entry's name is the one that an import recorded it with
  test('include an account whose key fails, by the name of its entry', async () => {
    const { lyon, paris } = serveLyonAndParis();
    useAccounts({ served: lyon, name: 'Lyon' }, { served: paris });
    await importSeptember();
    // Its key revoked since
    useAccounts({ served: REVOKED, name: 'Lyon' }, { served: paris });

    await importSeptember();

    expect(placesInConfiguration()).toEqual([[LYON.nic, 0], [PARIS.nic, 1]]);
  });

  // Every account was configured then: the next run records which ones still are
  test('include those recorded before the upgrade, in the order they were first recorded',
    () => {
      db.accounts.upsert({ nic: PARIS.nic, currency: 'EUR' });
      db.accounts.upsert({ nic: LYON.nic, currency: 'EUR' });
      asBefore114(db.getDb());
      db.closeDb();

      expect(placesInConfiguration()).toEqual([[LYON.nic, 1], [PARIS.nic, 0]]);
    });

  describe('once an account is removed from them', () => {
    test('keep its data, and neither import it nor list it any more', async () => {
      const { lyon, paris } = serveLyonAndParis();
      useAccounts({ served: lyon }, { served: paris });
      await importSeptember();
      useAccounts({ served: lyon });
      calls.length = 0;

      await importSeptember();

      expect(accountsOf('bills')).toEqual([['FR-L1', LYON.nic], ['FR-P1', PARIS.nic]]);
      expect(accountsOf('projects')).toEqual([['proj-paris', PARIS.nic]]);
      expect(routesCalledWith(paris)).toEqual([]);
      expect(placesInConfiguration()).toEqual([[LYON.nic, 0], [PARIS.nic, null]]);
    });
  });
});
