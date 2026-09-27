/**
 * Tests for the account that an import records (#112), against a simulated OVH API: GET /me
 * names the account that the API key reads, by its NIC handle, and every row that the import
 * writes carries it, or reaches it through its bill or its project.
 */

const { routes, ok, fail, me, useThrowawayImport } = require('./support/simulated-ovh');
const { ACCOUNT, PARIS, SQLITE_TIME } = require('./support/accounts');
const { ROOT_TABLES, asBeforeAccounts } = require('./support/database-before');

jest.mock('ovh', () => require('./support/simulated-ovh').ovh);
jest.mock('jsonfile', () => require('./support/simulated-ovh').jsonfile);

const PROJECT = 'proj-1';

const throwaway = useThrowawayImport('ocm-account-import-');
let db;
let importer;
beforeAll(() => {
  ({ db, importer } = throwaway);
});

beforeEach(() => {
  // The progress of the bills
  jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
});

// A line of a bill, as GET /me/bill/{billId}/details/{detailId} gives it
const billLine = (domain, description, price) => ok({
  domain, description, quantity: '1',
  unitPrice: { value: price, currencyCode: 'EUR' },
  totalPrice: { value: price, currencyCode: 'EUR' },
});

// OVH lists one Public Cloud project, and one bill of September with a line for the project
// and one for a domain
function serveBills() {
  routes.set('/cloud/project', ok([PROJECT]));
  routes.set(`/cloud/project/${PROJECT}`, ok({ description: 'Project 1', status: 'ok' }));
  routes.set('/me/bill', ok(['FR1']));
  routes.set('/me/bill/FR1', ok({
    billId: 'FR1',
    date: '2026-09-01T00:00:00+02:00',
    priceWithoutTax: { value: 30, currencyCode: 'EUR' },
    priceWithTax: { value: 36, currencyCode: 'EUR' },
    tax: { value: 6, currencyCode: 'EUR' },
  }));
  routes.set('/me/bill/FR1/details', ok(['D1', 'D2']));
  routes.set('/me/bill/FR1/details/D1',
    billLine(PROJECT, 'Consommation à l\'heure pour les instances b2-7 gra11', 20));
  routes.set('/me/bill/FR1/details/D2', billLine('example.com', 'Nom de domaine example.com', 10));
}

// The resources of the project, which the cloud details give: its usage of the month, an
// instance, its quotas, a volume, a snapshot and an S3 bucket
function serveProjectResources() {
  const base = `/cloud/project/${PROJECT}`;
  routes.set(`${base}/usage/current`, ok({
    period: { from: '2026-09-01T00:00:00+02:00', to: '2026-09-15T12:00:00+02:00' },
    hourlyUsage: {
      instance: [{
        reference: 'b2-7',
        region: 'GRA11',
        details: [
          { instanceId: 'inst-1', quantity: { value: 100, unit: 'Hour' }, totalPrice: 12.25 },
        ],
      }],
    },
  }));
  routes.set(`${base}/instance`, ok([
    { id: 'inst-1', name: 'web-1', flavor: { name: 'b2-7' }, region: 'GRA11' },
  ]));
  routes.set(`${base}/quota`, ok([{ region: 'GRA11', instance: { maxCores: 20, usedCores: 2 } }]));
  routes.set(`${base}/volume`, ok([
    { id: 'vol-1', name: 'data', region: 'GRA11', type: 'classic', size: 100, attachedTo: [] },
  ]));
  routes.set(`${base}/snapshot`, ok([
    { id: 'snap-1', name: 'before-upgrade', region: 'GRA11', size: 10, type: 'linux' },
  ]));
  routes.set(`${base}/region`, ok(['GRA']));
  routes.set(`${base}/region/GRA`,
    ok({ services: [{ name: 'storage-s3-standard', status: 'UP' }] }));
  routes.set(`${base}/region/GRA/storage`,
    ok([{ name: 'photos', objectsCount: 2, objectsSize: 2048 }]));
  routes.set(`${base}/storage`, ok([]));
}

// The inventories: a dedicated server, a VPS and a NetApp storage service
function serveInventories() {
  const server = 'ns3000001.ip-203-0-113.eu';
  const vps = 'vps-0a1b2c3d.vps.ovh.net';
  const storage = 'netapp-8c9d0e1f';
  routes.set('/dedicated/server', ok([server]));
  routes.set(`/dedicated/server/${server}`, ok({ datacenter: 'rbx8', state: 'ok' }));
  routes.set('/vps', ok([vps]));
  routes.set(`/vps/${vps}`, ok({ name: vps, state: 'running', model: { vcore: 2, disk: 40 } }));
  routes.set('/storage/netapp', ok([storage]));
  routes.set(`/storage/netapp/${storage}`, ok({ name: storage, region: 'eu-west-gra' }));
}

// The consumption of the account: the month's usage so far, its forecast and its history
function serveConsumption() {
  const usage = (total) => ok([{
    beginDate: '2026-09-01T00:00:00+02:00',
    endDate: '2026-09-15T00:00:00+02:00',
    price: { value: total, currencyCode: 'EUR' },
  }]);
  routes.set('/me/consumption/usage/current', usage(100));
  routes.set('/me/consumption/usage/forecast', usage(200));
  routes.set('/me/consumption/usage/history', ok([{
    beginDate: '2026-08-01T00:00:00+02:00',
    endDate: '2026-08-31T23:59:59+02:00',
    price: { value: 190, currencyCode: 'EUR' },
    elements: [{ planFamily: 'consumption' }],
  }]));
}

// The balance of the account: no debt, and a credit with one movement
function serveBalance() {
  routes.set('/me/debtAccount', ok({ todoAmount: { value: 0, currencyCode: 'EUR' } }));
  routes.set('/me/credit/balance', ok(['VOUCHER']));
  routes.set('/me/credit/balance/VOUCHER', ok({ amount: { value: 50, currencyCode: 'EUR' } }));
  routes.set('/me/credit/balance/VOUCHER/movement', ok([1]));
  routes.set('/me/credit/balance/VOUCHER/movement/1', ok({
    amount: { value: 50, currencyCode: 'EUR' },
    creationDate: '2026-09-01T00:00:00+02:00',
    description: 'Voucher',
    type: 'VOUCHER',
  }));
  routes.set('/me/deposit', ok([]));
}

// What an import of the account reads: every dataset that the OVH API gives
function serveAccount() {
  serveBills();
  serveProjectResources();
  serveInventories();
  serveConsumption();
  serveBalance();
}

// Runs an import as import.js runs it with these options. Retry delays run on fake timers,
// so a retried call costs no real time.
async function runImport(params) {
  const done = importer.runImport(params);
  await jest.runAllTimersAsync();
  await done;
}

// The datasets that --all adds to the bills, as parseArgs() sets them
const ALL_DATASETS = {
  includeConsumption: true, includeAccount: true, includeInventory: true, includeCloudDetails: true,
};

// A period import of September, with none of the datasets that the bills do not give
const importSeptember = () => runImport({ from: '2026-09-01', to: '2026-09-30' });

// The accounts that the rows of a table carry, NULL for a row without any
const accountsIn = (table) => db.getDb()
  .prepare(`SELECT DISTINCT account FROM ${table} ORDER BY account`)
  .all()
  .map(row => row.account);

// The tables whose rows belong to a bill or a project: the table of that parent, and the
// column that names it
const CHILD_TABLES = {
  bill_details: ['bills', 'bill_id'],
  project_consumption: ['projects', 'project_id'],
  cloud_instances: ['projects', 'project_id'],
  project_quotas: ['projects', 'project_id'],
  cloud_volumes: ['projects', 'project_id'],
  cloud_snapshots: ['projects', 'project_id'],
  object_storage_buckets: ['projects', 'project_id'],
};

// The accounts that the rows of a table reach through their bill or their project, NULL for
// a row whose parent carries none, or is not stored
function accountsThroughParent(table) {
  const [parent, column] = CHILD_TABLES[table];
  return db.getDb().prepare(`
    SELECT DISTINCT parent.account AS account
    FROM ${table} child
    LEFT JOIN ${parent} parent ON parent.id = child.${column}
    ORDER BY parent.account
  `).all().map(row => row.account);
}

// What `read` gives for each of these tables
const byTable = (tables, read) => Object.fromEntries(tables.map(table => [table, read(table)]));

// The accounts of the rows of each table: those they carry, and those the rows of the child
// tables reach through their bill or their project
const accountsOfRootTables = () => byTable(ROOT_TABLES, accountsIn);
const accountsOfChildTables = () => byTable(Object.keys(CHILD_TABLES), accountsThroughParent);

// What they give once every row carries, or reaches, the account of the tests alone
const onlyTheAccount = (tables) => byTable(tables, () => [ACCOUNT.nic]);

// Makes the database one that the version before the accounts wrote: its rows carry no
// account, and it has no accounts table. The next getDb() migrates it, as the server or the
// import that starts after the upgrade does.
function downgradeDatabase() {
  asBeforeAccounts(db.getDb());
  db.closeDb();
}

// What the version before the accounts imported, and how it left the database: a row in every
// table, none of which carries an account
async function storeRowsOfBefore() {
  serveAccount();
  await runImport({ from: '2026-09-01', to: '2026-09-30', ...ALL_DATASETS });
  downgradeDatabase();
}

// The rows of every table but the import log, which records each run, failed ones included
function contentOfDatabase() {
  const database = db.getDb();
  const tables = database.prepare(`
    SELECT name FROM sqlite_master
    WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> 'import_log'
    ORDER BY name
  `).all().map(row => row.name);
  return byTable(tables, table => database.prepare(`SELECT * FROM ${table}`).all());
}

// The time now, as SQLite writes it: UTC, to the second
const sqliteNow = () => db.getDb().prepare("SELECT datetime('now') AS now").get().now;

describe('an import', () => {
  test('records the account that GET /me names on the rows of every table the API feeds',
    async () => {
      serveAccount();

      await runImport({ from: '2026-09-01', to: '2026-09-30', ...ALL_DATASETS });

      expect(accountsOfRootTables()).toEqual(onlyTheAccount(ROOT_TABLES));
    });

  test('lets each bill line and each project resource reach it through its bill or project',
    async () => {
      serveBills();
      serveProjectResources();

      await runImport({ from: '2026-09-01', to: '2026-09-30', includeCloudDetails: true });

      expect(accountsOfChildTables()).toEqual(onlyTheAccount(Object.keys(CHILD_TABLES)));
    });

  test('records the account, its currency, and when and how its import ended', async () => {
    routes.set('/me', me({ nic: PARIS, currency: 'CAD' }));
    serveBills();
    const started = sqliteNow();

    await importSeptember();

    const accounts = db.accounts.getAll();
    // The legacy credentials give it no name and no budget (#113), and it is configured
    // (#114)
    expect(accounts).toEqual([{
      nic: PARIS,
      currency: 'CAD',
      last_import_at: expect.stringMatching(SQLITE_TIME),
      last_import_status: 'success',
      last_import_error: null,
      name: null,
      budget: null,
      configured: true,
    }]);
    // It ended during the import
    const ended = accounts[0].last_import_at;
    expect(started <= ended && ended <= sqliteNow()).toBe(true);
  });

  test('records on the account that its import failed, and why', async () => {
    serveBills();
    routes.set('/cloud/project', fail(500, 'Internal server error'));

    await importSeptember();

    expect(process.exit).toHaveBeenCalledWith(1);
    expect(db.accounts.getAll()).toEqual([{
      nic: ACCOUNT.nic,
      currency: 'EUR',
      last_import_at: expect.stringMatching(SQLITE_TIME),
      last_import_status: 'failed',
      last_import_error: 'Internal server error',
      name: null,
      budget: null,
      configured: true,
    }]);
  });
});

describe('a writer of a table that the OVH API feeds', () => {
  // A row of each of these tables, as the import writes it, but without its account
  const writeWithoutAccount = {
    bills: () => db.bills.upsert({
      id: 'FR1', date: '2026-09-01', price_without_tax: 30, price_with_tax: 36, tax: 6,
      currency: 'EUR', pdf_url: null, html_url: null,
    }),
    projects: () => db.projects.upsert({
      id: PROJECT, name: 'Project 1', description: null, status: 'ok', created_at: null,
    }),
    dedicated_servers: () => db.inventory.upsertServer({
      id: 'ns3000001.ip-203-0-113.eu', display_name: 'ns3000001', reverse: '', datacenter: 'rbx8',
      os: '', state: 'ok', cpu: '', ram_size: 0, disk_info: '[]', bandwidth: 0,
      expiration_date: null, renewal_type: '',
    }),
    vps_instances: () => db.inventory.upsertVps({
      id: 'vps-0a1b2c3d.vps.ovh.net', display_name: 'vps-0a1b2c3d', model: '', zone: '',
      state: 'running', os: '', vcpus: 2, ram_mb: 2048, disk_gb: 40, expiration_date: null,
      renewal_type: '', ip_addresses: '[]',
    }),
    storage_services: () => db.inventory.upsertStorage({
      id: 'netapp-8c9d0e1f', service_type: 'netapp', display_name: 'netapp-8c9d0e1f',
      region: 'eu-west-gra', total_size_gb: 1024, used_size_gb: 0, share_count: 0,
      expiration_date: null,
    }),
    account_balance: () => db.balance.insertBalance({
      debt_balance: 0, credit_balance: 50, deposit_total: 0, currency: 'EUR',
    }),
    consumption_snapshots: () => db.consumption.insertSnapshot({
      period_start: '2026-09-01', period_end: '2026-09-15', current_total: 100,
      forecast_total: 200, currency: 'EUR', raw_data: '{}',
    }),
    consumption_history: () => db.consumption.insertHistory({
      period_start: '2026-08-01', period_end: '2026-08-31', service_type: 'consumption',
      total: 190, currency: 'EUR', raw_data: '{}',
    }),
    credit_movements: () => db.balance.insertCreditMovement({
      id: 'VOUCHER_1', balance_name: 'VOUCHER', amount: 50, date: '2026-09-01',
      description: 'Voucher', movement_type: 'VOUCHER',
    }),
  };

  // Stored without it, a row would lose the account it has, and the next import would give
  // it to the account that import reads, whichever account it belongs to
  test.each(ROOT_TABLES)('refuses a row of %s without an account, naming the table',
    (table) => {
      expect(writeWithoutAccount[table])
        .toThrow(`Cannot write a row of ${table} without the NIC handle of its account`);
      expect(accountsIn(table)).toEqual([]);
    });
});

describe('an API key that is not granted GET /me', () => {
  // OVH's answer to a call that the key's rights do not cover
  const notGranted = fail(403, 'This call has not been granted');
  const MESSAGE = 'The API key lacks the right GET /me, which tells the import the account it '
    + 'imports: request a consumer key granted GET /me';

  test('fails the import with a message that names the right', async () => {
    serveBills();
    routes.set('/me', notGranted);

    await importSeptember();

    expect(process.exit).toHaveBeenCalledWith(1);
    expect(console.error.mock.calls.slice(-2)).toEqual([['\n=== IMPORT FAILED ==='], [MESSAGE]]);
    expect(db.importLog.getLatest())
      .toMatchObject({ status: 'failed', error_message: MESSAGE });
  });

  // It cannot tell which account the rows it would write, or those stored, belong to
  test('writes nothing, and a full import clears nothing', async () => {
    await storeRowsOfBefore();
    const before = contentOfDatabase();
    routes.set('/me', notGranted);

    await runImport({ full: true, ...ALL_DATASETS });

    expect(process.exit).toHaveBeenCalledWith(1);
    expect(contentOfDatabase()).toEqual(before);
  });
});

describe('any other failure of GET /me', () => {
  test.each([
    ['a consumer key that is not valid', fail(403, 'This credential is not valid'),
      'This credential is not valid'],
    ['a server error, after its retries', fail(500, 'Internal server error'),
      'Internal server error'],
    ['an answer without a NIC handle', ok({ currency: { code: 'EUR' } }),
      'GET /me answered no NIC handle, which tells the import the account it imports'],
  ])('fails the import with its error, writing nothing: %s', async (_, answer, message) => {
    await storeRowsOfBefore();
    const before = contentOfDatabase();
    routes.set('/me', answer);

    await runImport({ full: true, ...ALL_DATASETS });

    expect(process.exit).toHaveBeenCalledWith(1);
    expect(console.error.mock.calls.slice(-2)).toEqual([['\n=== IMPORT FAILED ==='], [message]]);
    expect(contentOfDatabase()).toEqual(before);
  });
});

describe('the first import after the upgrade', () => {
  test('attributes every row imported before it to its account', async () => {
    await storeRowsOfBefore();
    // Since then, OVH lists no project and no new bill: only the migration can attribute them
    routes.set('/cloud/project', ok([]));
    routes.set('/me/bill', ok([]));

    // As the cron runs it
    await runImport({ diff: true });

    expect(accountsOfRootTables()).toEqual(onlyTheAccount(ROOT_TABLES));
    expect(accountsOfChildTables()).toEqual(onlyTheAccount(Object.keys(CHILD_TABLES)));
  });

  // Until the account-wide figures follow the account (#116), their readers read every row:
  // with a single account, they give what they gave, but for the account of the rows
  test('leaves what the readers of the account-wide figures give', async () => {
    await storeRowsOfBefore();
    routes.set('/cloud/project', ok([]));
    routes.set('/me/bill', ok([]));
    const withoutAccount = ({ account, ...row }) => row;
    const read = () => ({
      balance: withoutAccount(db.balance.getLatestBalance()),
      credits: db.balance.getCreditMovements().map(withoutAccount),
      snapshot: withoutAccount(db.consumption.getLatestSnapshot()),
      history: db.consumption.getHistory().map(withoutAccount),
      consumptionMonth: db.cloudDetails.getCurrentConsumptionMonth(),
    });
    const before = read();

    await runImport({ diff: true });

    expect(read()).toEqual(before);
    expect(before.consumptionMonth).toBe('2026-09-01');
  });
});
