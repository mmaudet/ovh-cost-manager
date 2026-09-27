/**
 * Tests for keeping the accounts of one database apart (#114), against a simulated OVH API
 * that serves each account through its own credentials: importing an account never touches
 * another account's data, and a service that two accounts list is stored once.
 */

const {
  ok, fail, calls, serveAccount, useConfig, useThrowawayImport,
} = require('./support/simulated-ovh');
const { LYON, PARIS, bill, project } = require('./support/accounts');
const { ROOT_TABLES, asBefore114 } = require('./support/database-before');

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

// Serves the account of this NIC handle, such as LYON or PARIS, which bills in euros
const serveInEuros = (nic) => serveAccount({ nic, currency: 'EUR' });

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

// A differential import, as the cron runs it, once a day, with every dataset
const importAsTheCron = () => runImport({
  diff: true, includeConsumption: true, includeAccount: true, includeInventory: true,
  includeCloudDetails: true,
});

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
    const lyon = serveInEuros(LYON);
    const paris = serveInEuros(PARIS);
    // Cancelled since an earlier import of Lyon
    storeServer('ns-lyon-cancelled', LYON);
    storeVps('vps-lyon-cancelled', LYON);
    storeStorage('netapp-lyon-cancelled', LYON);
    // Paris's, which Lyon's API does not list
    storeServer('ns-paris', PARIS);
    storeVps('vps-paris', PARIS);
    storeStorage('netapp-paris', PARIS);
    serveProjects(lyon.routes);
    serveBills(lyon.routes, []);
    serveInventories(lyon.routes, { servers: ['ns-lyon'], vps: ['vps-lyon'], storage: ['netapp-lyon'] });
    useAccounts({ served: lyon }, { served: paris });

    await importSeptember({ account: LYON, includeInventory: true });

    expect(storedServices()).toEqual({
      servers: [['ns-lyon', LYON], ['ns-paris', PARIS]],
      vps: [['vps-lyon', LYON], ['vps-paris', PARIS]],
      storage: [['netapp-lyon', LYON], ['netapp-paris', PARIS]],
    });
  });
});

// A Public Cloud project of the account, as an earlier import stored it, named by its id
const storeProject = (id, nic) => project(db, id, id, nic);

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
    const lyon = serveInEuros(LYON);
    const paris = serveInEuros(PARIS);
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
      const bills = [['FR-1', '2026-09-01', [SHARED]]];
      serveBoth(billing === LYON ? { lyonBills: bills } : { parisBills: bills });

      await importSeptember({ includeInventory: true });

      expect(accountsOf(table)).toEqual([[SHARED, billing]]);
    });

  test('goes to the first configured account that lists it, when no bill line names it',
    async () => {
      serveBoth();

      await importSeptember({ includeInventory: true });

      expect(accountsOf(table)).toEqual([[SHARED, LYON]]);
    });

  test('is never taken over by another account that lists it', async () => {
    serveBoth();
    store(SHARED, PARIS);

    await importSeptember({ account: LYON, includeInventory: true });

    expect(accountsOf(table)).toEqual([[SHARED, PARIS]]);
  });
});

// Serves on these routes an account's consumption: nothing yet this month, and a history of
// these months, which OVH gives for the past year, each for this total
function serveHistory(accountRoutes, months, total = 100) {
  accountRoutes.set('/me/consumption/usage/current', ok([]));
  accountRoutes.set('/me/consumption/usage/forecast', ok([]));
  accountRoutes.set('/me/consumption/usage/history', ok(months.map(month => ({
    beginDate: `${month}-01T00:00:00+02:00`,
    endDate: `${month}-28T23:59:59+02:00`,
    price: { value: total, currencyCode: 'EUR' },
    elements: [{ planFamily: 'consumption' }],
  }))));
}

// The same, with a history of one month
const serveConsumption = (accountRoutes, month, total) =>
  serveHistory(accountRoutes, [month], total);

// A month of the account's consumption history, as an earlier import stored it
const storeHistory = (month, nic) => db.consumption.insertHistory({
  period_start: `${month}-01`, period_end: `${month}-28`, service_type: 'consumption',
  total: 90, currency: 'EUR', raw_data: '{}', account: nic,
});

// The consumption history stored, as [NIC handle of its account, month, total]
const storedHistory = () => db.getDb().prepare(`
  SELECT account, period_start, total FROM consumption_history ORDER BY account, period_start
`).all().map(row => [row.account, row.period_start, row.total]);

describe('the consumption history', () => {
  test('is replaced for the importing account only', async () => {
    const lyon = serveInEuros(LYON);
    const paris = serveInEuros(PARIS);
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

    await importSeptember({ account: LYON, includeConsumption: true });

    expect(storedHistory()).toEqual([
      [LYON, '2026-08-01', 110], [PARIS, '2026-07-01', 200],
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
    const lyon = serveInEuros(LYON);
    const paris = serveInEuros(PARIS);
    for (const served of [lyon, paris]) {
      serveProjects(served.routes);
      serveBills(served.routes, []);
    }
    serveBalance(lyon.routes, { PREPAID_ACCOUNT: [[1, 50]] });
    serveBalance(paris.routes, { PREPAID_ACCOUNT: [[1, 20]] });
    useAccounts({ served: lyon }, { served: paris });

    await importSeptember({ includeAccount: true });

    expect(storedMovements()).toEqual([
      [LYON, 'PREPAID_ACCOUNT_1', 50], [PARIS, 'PREPAID_ACCOUNT_1', 20],
    ]);
  });

  // Keyed by their id alone before #114
  test('stored before the upgrade are kept, and replaced when imported again', async () => {
    const lyon = serveInEuros(LYON);
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
      [LYON, 'PREPAID_ACCOUNT_1', 50], [LYON, 'PREPAID_ACCOUNT_2', -25],
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
    const lyon = serveInEuros(LYON);
    const paris = serveInEuros(PARIS);
    serveProjects(lyon.routes, ['proj-lyon']);
    serveProjects(paris.routes, ['proj-paris']);
    for (const served of [lyon, paris]) serveBills(served.routes, []);
    serveUsage(lyon.routes, 'proj-lyon', '2026-09-01', '2026-09-15');
    serveUsage(paris.routes, 'proj-paris', '2026-08-01', '2026-08-31');
    useAccounts({ served: lyon }, { served: paris });

    await importSeptember({ includeCloudDetails: true });

    expect(db.cloudDetails.getCurrentConsumptionMonth()).toBe('2026-09-01');
    expect(recordedMonths()).toEqual([[LYON, '2026-09-01'], [PARIS, '2026-08-01']]);
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
    const lyon = serveInEuros(LYON);
    const paris = serveInEuros(PARIS);
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

      await importSeptember({ account: PARIS });

      expect(placesInConfiguration()).toEqual([[LYON, 1], [PARIS, 0]]);
    });

  // Its GET /me cannot name it, but its entry's name is the one that an import recorded it with
  test('include an account whose key fails, by the name of its entry', async () => {
    const { lyon, paris } = serveLyonAndParis();
    useAccounts({ served: lyon, name: 'Lyon' }, { served: paris });
    await importSeptember();
    // Its key revoked since
    useAccounts({ served: REVOKED, name: 'Lyon' }, { served: paris });

    await importSeptember();

    expect(placesInConfiguration()).toEqual([[LYON, 0], [PARIS, 1]]);
  });

  // Every account was configured then: the next run records which ones still are
  test('include those recorded before the upgrade, in the order they were first recorded',
    () => {
      db.accounts.upsert({ nic: PARIS, currency: 'EUR' });
      db.accounts.upsert({ nic: LYON, currency: 'EUR' });
      asBefore114(db.getDb());
      db.closeDb();

      expect(placesInConfiguration()).toEqual([[LYON, 1], [PARIS, 0]]);
    });

  describe('once an account is removed from them', () => {
    test('keep its data, and neither import it nor list it any more', async () => {
      const { lyon, paris } = serveLyonAndParis();
      useAccounts({ served: lyon }, { served: paris });
      await importSeptember();
      useAccounts({ served: lyon });
      calls.length = 0;

      await importSeptember();

      expect(accountsOf('bills')).toEqual([['FR-L1', LYON], ['FR-P1', PARIS]]);
      expect(accountsOf('projects')).toEqual([['proj-paris', PARIS]]);
      expect(routesCalledWith(paris)).toEqual([]);
      expect(placesInConfiguration()).toEqual([[LYON, 0], [PARIS, null]]);
    });
  });
});

// A bill of the account, as an earlier import stored it, with one line
function storeBill(id, date, nic) {
  bill(db, id, date, nic);
  db.details.insert({
    id: `${id}_D1`, bill_id: id, project_id: null, domain: 'example.com',
    description: 'Service example.com', quantity: 1, unit_price: 10, total_price: 10,
    service_type: 'Other',
  });
}

// What an earlier import stored for the account, whose rows `tag` tells apart: a bill of
// August, a service of each inventory, its balance and consumption snapshots, a credit
// movement, its consumption history, a project whose consumption is kept, with the month of
// that consumption, and a project with an instance
function storeDataOf(nic, tag) {
  storeBill(`FR-${tag}0`, '2026-08-01', nic);
  storeServer(`ns-${tag}`, nic);
  storeVps(`vps-${tag}`, nic);
  storeStorage(`netapp-${tag}`, nic);
  db.balance.insertBalance({
    debt_balance: 0, credit_balance: 50, deposit_total: 0, currency: 'EUR', account: nic,
  });
  db.consumption.insertSnapshot({
    period_start: '2026-09-01', period_end: '2026-09-14', current_total: 100,
    forecast_total: 200, currency: 'EUR', raw_data: '{}', account: nic,
  });
  db.balance.insertCreditMovement({
    id: 'PREPAID_ACCOUNT_1', balance_name: 'PREPAID_ACCOUNT', amount: 50, date: '2026-09-01',
    description: 'Voucher', movement_type: 'VOUCHER', account: nic,
  });
  db.consumption.insertHistory({
    period_start: '2026-07-01', period_end: '2026-07-31', service_type: 'consumption',
    total: 90, currency: 'EUR', raw_data: '{}', account: nic,
  });
  storeProject(`proj-${tag}-used`, nic);
  db.cloudDetails.insertConsumption({
    project_id: `proj-${tag}-used`, period_start: '2026-09-01', period_end: '2026-09-14',
    resource_type: 'instance', resource_id: 'inst-1', resource_name: 'b2-7', quantity: 100,
    unit: 'Hour', unit_price: 0, total_price: 12.25, region: 'GRA11',
  });
  db.cloudDetails.setCurrentConsumptionMonth('2026-09-01', nic);
  storeProject(`proj-${tag}-idle`, nic);
  db.cloudDetails.upsertInstance({
    id: `inst-${tag}`, project_id: `proj-${tag}-idle`, name: 'web-1', flavor: 'b2-7',
    region: 'GRA11', status: 'ACTIVE', created_at: null, monthly_billing: 0,
  });
}

// The rows of the account in each table that the imports feed: those that carry its NIC
// handle, and those whose bill or project does
function contentOf(nic) {
  const rows = (sql) => db.getDb().prepare(sql).all(nic);
  const ofItsProjects = (table) => rows(`
    SELECT child.* FROM ${table} child JOIN projects p ON p.id = child.project_id
    WHERE p.account = ?
  `);
  return {
    ...Object.fromEntries(ROOT_TABLES.map(table =>
      [table, rows(`SELECT * FROM ${table} WHERE account = ?`)])),
    bill_details: rows(`
      SELECT d.* FROM bill_details d JOIN bills b ON b.id = d.bill_id WHERE b.account = ?
    `),
    project_consumption: ofItsProjects('project_consumption'),
    cloud_instances: ofItsProjects('cloud_instances'),
    import_state: rows('SELECT * FROM import_state WHERE account = ?'),
  };
}

// The ids of the account's rows in each table, as contentOf() gives them
const idsOf = (nic) => Object.fromEntries(Object.entries(contentOf(nic))
  .map(([table, rows]) => [table, rows.map(row => row.id ?? row.key)]));

// What the account holds once a full import cleared it, and imported again a bill of
// September and no project: the consumption of a project, which OVH cannot give again, is
// kept, with the project and the month of its last import
const clearedAndImportedAgain = (tag) => ({
  bills: [`FR-${tag}1`],
  projects: [`proj-${tag}-used`],
  dedicated_servers: [],
  vps_instances: [],
  storage_services: [],
  account_balance: [],
  consumption_snapshots: [],
  consumption_history: [],
  credit_movements: [],
  bill_details: [`FR-${tag}1_D1`],
  project_consumption: [expect.any(Number)],
  cloud_instances: [],
  import_state: ['consumption_month'],
});

// How each run of the import log ended, as [status, error]
const runs = () => db.importLog.getAll().map(entry => [entry.status, entry.error_message]);

describe('a full import of one account (--full --account)', () => {
  // Lyon and Paris with what an earlier import stored for each; Lyon's API now lists a bill
  // of September and no project
  function storeLyonAndParis() {
    const lyon = serveInEuros(LYON);
    const paris = serveInEuros(PARIS);
    storeDataOf(LYON, 'L');
    storeDataOf(PARIS, 'P');
    serveProjects(lyon.routes);
    serveBills(lyon.routes, [['FR-L1', '2026-09-01']]);
    return { lyon, paris };
  }

  test('clears that account\'s data only, and imports it again', async () => {
    const { lyon, paris } = storeLyonAndParis();
    const ofParis = contentOf(PARIS);
    useAccounts({ served: lyon }, { served: paris });

    await runImport({ full: true, account: LYON });

    expect(idsOf(LYON)).toEqual(clearedAndImportedAgain('L'));
    expect(contentOf(PARIS)).toEqual(ofParis);
    expect(runs()).toEqual([['success', null]]);
    expect(routesCalledWith(paris)).toEqual(['/me']);
  });

  // It holds the imports of the other accounts
  test('keeps the log of the imports', async () => {
    const { lyon, paris } = storeLyonAndParis();
    const earlier = db.importLog.start('differential', '2026-08-01', '2026-09-14');
    db.importLog.complete(earlier, { bills: 2, details: 2, projects: 4 });
    useAccounts({ served: lyon }, { served: paris });

    await runImport({ full: true, account: LYON });

    expect(db.importLog.getAll().map(entry => [entry.type, entry.status]))
      .toEqual([['full', 'success'], ['differential', 'success']]);
  });

  test('clears nothing when that account cannot be read', async () => {
    const { paris } = storeLyonAndParis();
    db.accounts.upsert({ nic: LYON, currency: 'EUR', name: 'Lyon' });
    const before = [contentOf(LYON), contentOf(PARIS)];
    useAccounts({ served: REVOKED, name: 'Lyon' }, { served: paris });

    await runImport({ full: true, account: LYON });

    expect([contentOf(LYON), contentOf(PARIS)]).toEqual(before);
    expect(runs()).toEqual([[
      'failed',
      '1 of 1 account failed: "Lyon": This credential is not valid. A full import clears only '
        + 'the accounts that it can import: the data of "Lyon" was kept',
    ]]);
  });
});

describe('a full import of every account', () => {
  // Each account that it can import again: Paris's key is revoked, and its entry's name is
  // the one that an import recorded it with
  test('clears only the accounts that it can import, and says so', async () => {
    const lyon = serveInEuros(LYON);
    storeDataOf(LYON, 'L');
    storeDataOf(PARIS, 'P');
    db.accounts.upsert({ nic: PARIS, currency: 'EUR', name: 'Paris' });
    const ofParis = contentOf(PARIS);
    serveProjects(lyon.routes);
    serveBills(lyon.routes, [['FR-L1', '2026-09-01']]);
    useAccounts({ served: lyon }, { served: REVOKED, name: 'Paris' });

    await runImport({ full: true });

    expect(idsOf(LYON)).toEqual(clearedAndImportedAgain('L'));
    expect(contentOf(PARIS)).toEqual(ofParis);
    expect(runs()).toEqual([[
      'partial',
      '1 of 2 accounts failed: "Paris": This credential is not valid. A full import clears '
        + 'only the accounts that it can import: the data of "Paris" was kept',
    ]]);
  });

  test('keeps the data of an account removed from the configuration', async () => {
    const lyon = serveInEuros(LYON);
    storeDataOf(LYON, 'L');
    storeDataOf(PARIS, 'P');
    const ofParis = contentOf(PARIS);
    serveProjects(lyon.routes);
    serveBills(lyon.routes, [['FR-L1', '2026-09-01']]);
    useAccounts({ served: lyon });

    await runImport({ full: true });

    expect(idsOf(LYON)).toEqual(clearedAndImportedAgain('L'));
    expect(contentOf(PARIS)).toEqual(ofParis);
    expect(runs()).toEqual([['success', null]]);
  });
});

// Makes every row one that the version before the accounts stored: without an account, as
// the migration of its database leaves them
function forgetAccounts() {
  for (const table of [...ROOT_TABLES, 'import_state']) {
    db.getDb().exec(`UPDATE ${table} SET account = NULL`);
  }
}

// The ids of the rows without an account in each table, whose account is unknown
const idsWithoutAccount = () => Object.fromEntries(ROOT_TABLES.map(table => [table,
  db.getDb().prepare(`SELECT id FROM ${table} WHERE account IS NULL ORDER BY id`).all()
    .map(row => row.id)]));

// The ids of the rows of the tables of the snapshots and the history, whatever their account
const allIdsIn = (table) => db.getDb().prepare(`SELECT id FROM ${table} ORDER BY id`).all()
  .map(row => row.id);

describe('the rows stored before the accounts, with several accounts configured', () => {
  // Lyon and Paris, whose APIs list nothing but what each test serves
  function serveLyonAndParis() {
    const lyon = serveInEuros(LYON);
    const paris = serveInEuros(PARIS);
    for (const served of [lyon, paris]) {
      serveProjects(served.routes);
      serveInventories(served.routes);
      serveBills(served.routes, []);
    }
    useAccounts({ served: lyon }, { served: paris });
    return { lyon, paris };
  }

  // Each account's differential import starts from its own latest bill, and skips those
  // stored: the bills of before are claimed from the account's whole list, without dates
  test('are claimed by each account whose full bill list names them', async () => {
    const { lyon, paris } = serveLyonAndParis();
    storeBill('FR-P0', '2026-08-01', PARIS);
    storeBill('FR-X0', '2026-07-01', PARIS);
    forgetAccounts();
    serveBills(lyon.routes, [['FR-L1', '2026-09-01']]);
    serveBills(paris.routes, [['FR-P0', '2026-08-01'], ['FR-P1', '2026-09-01']]);

    await runImport({ diff: true });

    expect(accountsOf('bills')).toEqual([
      ['FR-L1', LYON], ['FR-P0', PARIS], ['FR-P1', PARIS], ['FR-X0', null],
    ]);
    const undated = calls.filter(call => call.route === '/me/bill' && call.params === undefined);
    expect(undated.map(call => call.consumerKey))
      .toEqual([lyon.credentials.consumerKey, paris.credentials.consumerKey]);
  });

  // A project's consumption reaches its account through its project
  test('are claimed by each account whose API lists them: projects, with their consumption, '
    + 'and services', async () => {
    const { paris } = serveLyonAndParis();
    storeDataOf(PARIS, 'P');
    forgetAccounts();
    serveProjects(paris.routes, ['proj-P-used']);
    serveInventories(paris.routes, { servers: ['ns-P'], vps: ['vps-P'] });

    await runImport({ diff: true, includeInventory: true });

    expect(accountsOf('projects')).toEqual([['proj-P-idle', null], ['proj-P-used', PARIS]]);
    expect(contentOf(PARIS).project_consumption).toHaveLength(1);
    expect(storedServices()).toEqual({
      servers: [['ns-P', PARIS]], vps: [['vps-P', PARIS]], storage: [['netapp-P', null]],
    });
  });

  test('leave the services to the run that imports the inventories', async () => {
    const { paris } = serveLyonAndParis();
    storeServer('ns-P', PARIS);
    forgetAccounts();
    serveInventories(paris.routes, { servers: ['ns-P'] });

    await runImport({ diff: true });

    expect(accountsOf('dedicated_servers')).toEqual([['ns-P', null]]);
  });

  // Those of a balance that its API lists, even those that OVH no longer gives
  test('are claimed, for the credit movements, by the account that lists their balance',
    async () => {
      const { paris } = serveLyonAndParis();
      for (const [id, balance] of [['PREPAID_ACCOUNT_1', 'PREPAID_ACCOUNT'], ['OLD_1', 'OLD']]) {
        db.balance.insertCreditMovement({
          id, balance_name: balance, amount: 50, date: '2026-08-01', description: 'Voucher',
          movement_type: 'VOUCHER', account: PARIS,
        });
      }
      forgetAccounts();
      serveBalance(paris.routes, { PREPAID_ACCOUNT: [[2, -5]] });

      await runImport({ diff: true, includeAccount: true });

      expect(storedMovements()).toEqual([
        [null, 'OLD_1', 50],
        [PARIS, 'PREPAID_ACCOUNT_1', 50],
        [PARIS, 'PREPAID_ACCOUNT_2', -5],
      ]);
    });

  // No account can claim them, and each account's import records its own
  test('lose their balance and consumption snapshots', async () => {
    serveLyonAndParis();
    storeDataOf(PARIS, 'P');
    forgetAccounts();
    db.balance.insertBalance({
      debt_balance: 0, credit_balance: 10, deposit_total: 0, currency: 'EUR', account: LYON,
    });

    await runImport({ diff: true });

    expect(db.getDb().prepare('SELECT account FROM account_balance').all())
      .toEqual([{ account: LYON }]);
    expect(allIdsIn('consumption_snapshots')).toEqual([]);
  });

  // They are the Unknown account's: OVH cannot give some of them again, such as the
  // consumption of past months
  test('keep no account when no account claims them, and none is deleted', async () => {
    const { lyon, paris } = serveLyonAndParis();
    storeDataOf(PARIS, 'P');
    forgetAccounts();
    const history = allIdsIn('consumption_history');
    for (const served of [lyon, paris]) {
      serveConsumption(served.routes, '2026-08', 100);
      serveBalance(served.routes, {});
    }

    await importAsTheCron();

    expect(idsWithoutAccount()).toEqual({
      bills: ['FR-P0'],
      projects: ['proj-P-idle', 'proj-P-used'],
      dedicated_servers: ['ns-P'],
      vps_instances: ['vps-P'],
      storage_services: ['netapp-P'],
      account_balance: [],
      consumption_snapshots: [],
      consumption_history: history,
      credit_movements: ['PREPAID_ACCOUNT_1'],
    });
  });

  // It clears the accounts that it imports, not the Unknown account. A bill that no account
  // lists keeps the database from being Paris's alone.
  test('are kept by a full import, but for those that an account claims', async () => {
    const { paris } = serveLyonAndParis();
    storeDataOf(PARIS, 'P');
    storeBill('FR-X0', '2026-07-01', PARIS);
    forgetAccounts();
    const history = allIdsIn('consumption_history');
    serveBills(paris.routes, [['FR-P0', '2026-08-01']]);

    await runImport({ full: true });

    expect(accountsOf('bills')).toEqual([['FR-P0', PARIS], ['FR-X0', null]]);
    expect(idsWithoutAccount()).toEqual({
      bills: ['FR-X0'],
      projects: ['proj-P-idle', 'proj-P-used'],
      dedicated_servers: ['ns-P'],
      vps_instances: ['vps-P'],
      storage_services: ['netapp-P'],
      account_balance: [],
      consumption_snapshots: [],
      consumption_history: history,
      credit_movements: ['PREPAID_ACCOUNT_1'],
    });
  });
});

describe('the rows that no account claims, once a single account is left configured', () => {
  // A migration of two accounts leaves rows to the Unknown account, here those of a base that
  // held the bills of both, then Paris is removed from the configuration: the rows it left
  // could be its own, and Lyon's imports would remove them as its own
  test('stay the Unknown account\'s, through its imports and its full import', async () => {
    const lyon = serveInEuros(LYON);
    const paris = serveInEuros(PARIS);
    for (const served of [lyon, paris]) {
      serveProjects(served.routes);
      serveInventories(served.routes);
      serveConsumption(served.routes, '2026-08', 100);
      serveBalance(served.routes, {});
    }
    storeBill('FR-L0', '2026-08-01', LYON);
    storeBill('FR-P0', '2026-08-01', PARIS);
    // Paris's server, cancelled since, and its history of May to July
    storeServer('ns-P-cancelled', PARIS);
    for (const month of ['2026-05', '2026-06', '2026-07']) storeHistory(month, PARIS);
    forgetAccounts();
    const history = allIdsIn('consumption_history');
    serveBills(lyon.routes, [['FR-L0', '2026-08-01'], ['FR-L1', '2026-09-01']]);
    serveBills(paris.routes, [['FR-P0', '2026-08-01']]);
    useAccounts({ served: lyon }, { served: paris });
    await importAsTheCron();
    const leftUnknown = idsWithoutAccount();
    useAccounts({ served: lyon });

    await importAsTheCron();
    await runImport({ full: true, account: LYON });

    expect(leftUnknown).toMatchObject({
      bills: [], dedicated_servers: ['ns-P-cancelled'], consumption_history: history,
    });
    expect(idsWithoutAccount()).toEqual(leftUnknown);
  });
});

// A database from before the accounts held the data of the single account that OCM took the
// credentials of: once every bill stored then is claimed, and by one account, it was that
// account's, which gets every other row without an account
describe('the rows stored before the accounts, whose bills one account claims', () => {
  // Lyon and Paris, whose APIs list no project, service or balance, and no history for Lyon
  function serveLyonAndParis() {
    const lyon = serveInEuros(LYON);
    const paris = serveInEuros(PARIS);
    for (const served of [lyon, paris]) {
      serveProjects(served.routes);
      serveInventories(served.routes);
      serveBalance(served.routes, {});
      serveHistory(served.routes, []);
    }
    return { lyon, paris };
  }

  // What the version before the accounts stored of Paris, with its history of June and July,
  // and, to make the base hold two accounts' bills, a bill of Lyon's
  function storeBase({ withLyonsBill = false } = {}) {
    storeDataOf(PARIS, 'P');
    storeHistory('2026-06', PARIS);
    storeServer('ns-P-cancelled', PARIS);
    if (withLyonsBill) storeBill('FR-L0', '2026-08-01', LYON);
    forgetAccounts();
  }

  // The months of the consumption history stored, whatever their account
  const historyMonths = () => db.consumption.getHistory().map(entry => entry.period_start);

  test.each([['Lyon, then Paris', [LYON, PARIS]], ['Paris, then Lyon', [PARIS, LYON]]])(
    'go to the account that claims them, configured %s, with no month or movement twice',
    async (_, order) => {
      const { lyon, paris } = serveLyonAndParis();
      storeBase();
      serveBills(lyon.routes, [['FR-L1', '2026-09-01']]);
      serveBills(paris.routes, [['FR-P0', '2026-08-01'], ['FR-P1', '2026-09-01']]);
      // OVH gives Paris its history of June and July again, and the movement stored then
      serveHistory(paris.routes, ['2026-06', '2026-07', '2026-08']);
      serveBalance(paris.routes, { PREPAID_ACCOUNT: [[1, 50]] });
      const served = { [LYON]: lyon, [PARIS]: paris };
      useAccounts(...order.map(nic => ({ served: served[nic] })));

      await importAsTheCron();

      expect(idsWithoutAccount()).toEqual(Object.fromEntries(ROOT_TABLES.map(t => [t, []])));
      expect(historyMonths()).toEqual(['2026-08-01', '2026-07-01', '2026-06-01']);
      expect(storedMovements()).toEqual([[PARIS, 'PREPAID_ACCOUNT_1', 50]]);
      expect(accountsOf('projects')).toEqual([['proj-P-idle', PARIS], ['proj-P-used', PARIS]]);
    });

  // Neither was its account: the spec's default
  test('stay without an account when two accounts claim them', async () => {
    const { lyon, paris } = serveLyonAndParis();
    storeBase({ withLyonsBill: true });
    const history = allIdsIn('consumption_history');
    serveBills(lyon.routes, [['FR-L0', '2026-08-01']]);
    serveBills(paris.routes, [['FR-P0', '2026-08-01']]);
    useAccounts({ served: lyon }, { served: paris });

    await importAsTheCron();

    expect(idsWithoutAccount()).toMatchObject({
      bills: [], dedicated_servers: ['ns-P', 'ns-P-cancelled'], consumption_history: history,
    });
  });

  // Each account's claims count, whichever run made them
  test('stay without an account when a second account claims them in a later run',
    async () => {
      const { lyon, paris } = serveLyonAndParis();
      storeBase({ withLyonsBill: true });
      const history = allIdsIn('consumption_history');
      serveBills(lyon.routes, [['FR-L0', '2026-08-01']]);
      paris.routes.set('/me/bill', fail(500, 'Internal server error'));
      useAccounts({ served: lyon }, { served: paris });
      await importAsTheCron();
      serveBills(paris.routes, [['FR-P0', '2026-08-01']]);

      await importAsTheCron();

      expect(accountsOf('bills')).toEqual([['FR-L0', LYON], ['FR-P0', PARIS]]);
      expect(idsWithoutAccount()).toMatchObject({
        dedicated_servers: ['ns-P', 'ns-P-cancelled'], consumption_history: history,
      });
    });
});
