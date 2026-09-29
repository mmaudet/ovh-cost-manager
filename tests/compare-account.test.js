/**
 * The account parameter of the routes behind the Compare tab (#119), on the server started in
 * a child process over a database that the test seeds with several accounts. The tab compares
 * two months of the account selected in the header: their summaries, and their costs by
 * service type, by project and by resource type, which the header's and the Overview's tests
 * cover (account-parameter.test.js, overview-account.test.js), their Veeam backups, which
 * its Backup comparison shows as the Backup tab does, and the products of each project, which
 * its detail of a project compares (#181). As on those routes, a NIC handle that the
 * accounts table records keeps the bill lines of that account's bills, the reserved value
 * `unknown` those of the bills without an account (the Unknown account), and no parameter those
 * of every account, as before. Any other value is refused.
 */

const {
  LYON, PARIS, NEW_ACCOUNT, UNKNOWN_ACCOUNT, REFUSED, bill, project,
} = require('./support/accounts');
const { startOcm } = require('./support/ocm-server');

// A Public Cloud project, moved from Lyon to Paris during September
const STAGING = 'project-staging';

// A bill line of the backups of a Veeam VM, whose service is the VM
const backupLine = (id, billId, vm, price) => ({
  id, bill_id: billId, project_id: null, domain: vm, description: `Veeam Backup ${vm}`,
  quantity: 1, unit_price: price, total_price: price, service_type: 'Storage',
  resource_type: 'backup',
});
// A bill line of a Veeam Enterprise licence
const licenceLine = (id, billId, licence, price) => ({
  id, bill_id: billId, project_id: null, domain: licence,
  description: 'Veeam Enterprise Plus licence', quantity: 1, unit_price: price,
  total_price: price, service_type: 'Other', resource_type: 'license',
});
// A bill line of the Staging project
const stagingLine = (id, billId, description, price) => ({
  id, bill_id: billId, project_id: STAGING, domain: STAGING, description, quantity: 1,
  unit_price: price, total_price: price, service_type: 'Compute', resource_type: 'cloud_project',
});

// Two accounts and the Unknown account, whose bills of September back VMs up, and Lyon's of
// August too. The bills of each account billed the Staging project in September, and Lyon's
// in August. Every NIC handle, name, identifier and amount is made up.
function seed(db) {
  db.accounts.upsert({ nic: LYON, currency: 'EUR', name: 'Lyon subsidiary' });
  db.accounts.upsert({ nic: PARIS, currency: 'EUR' });
  db.accounts.upsert({ nic: NEW_ACCOUNT, currency: 'EUR' });
  project(db, STAGING, 'Staging', PARIS);
  bill(db, 'FR1001', '2026-09-05', LYON);
  bill(db, 'FR1002', '2026-08-05', LYON);
  bill(db, 'FR2001', '2026-09-10', PARIS);
  // Imported before OCM told accounts apart, and claimed by no account since: the writers
  // refuse such rows now, so it is written as the database held it
  db.getDb().prepare(
    "INSERT INTO bills (id, date, currency, account) VALUES ('FR0001', '2026-09-20', 'EUR', NULL)",
  ).run();
  const instances = 'Consommation à l\'heure pour les instances b3-8 gra11';
  db.details.insertMany([
    backupLine('FR1001-1', 'FR1001', 'vm-web-1', 30),
    backupLine('FR1001-2', 'FR1001', 'vm-db-1', 20),
    backupLine('FR1002-1', 'FR1002', 'vm-web-1', 25),
    backupLine('FR2001-1', 'FR2001', 'vm-app-1', 40),
    licenceLine('FR2001-2', 'FR2001', 'veeam-licence-1', 25),
    backupLine('FR0001-1', 'FR0001', 'vm-old-1', 10),
    stagingLine('FR1001-3', 'FR1001', instances, 50),
    stagingLine('FR1002-2', 'FR1002', instances, 150),
    stagingLine('FR1002-3', 'FR1002', 'Utilisation du credit cloud', -10),
    stagingLine('FR2001-3', 'FR2001', instances, 130),
    stagingLine('FR2001-4', 'FR2001', 'Managed Private Registry - plan M', 40),
    stagingLine('FR0001-2', 'FR0001', 'Stockage Standard - Bucket assets sur la région gra', 3),
  ]);
}

const SEPTEMBER = 'from=2026-09-01&to=2026-09-30';
const AUGUST = 'from=2026-08-01&to=2026-08-31';

let ocm;

beforeAll(async () => {
  ocm = await startOcm(() => ({}), { seed });
}, 30000);

afterAll(async () => {
  await ocm?.stop();
});

describe('GET /api/analysis/backup-stats', () => {
  const route = '/api/analysis/backup-stats';
  // The answer of the route for a month, for the account that the parameter names, or for
  // every account without one
  const backupsOf = (month, account) =>
    ocm.get(`${route}?${month}${account === undefined ? '' : `&account=${account}`}`);
  // The Veeam VMs and Enterprise licences of an answer, each as their number and their cost
  const backups = ([vms, vmsTotal], [licences, licencesTotal]) => ({
    status: 200,
    body: {
      vms: { count: vms, total: vmsTotal },
      enterprise: { count: licences, total: licencesTotal },
    },
  });

  test('adds up every account without the parameter, as before', async () => {
    expect(await backupsOf(SEPTEMBER)).toEqual(backups([4, 100], [1, 25]));
  });

  test('gives the Veeam backups of the account whose NIC handle it gives', async () => {
    expect(await backupsOf(SEPTEMBER, LYON)).toEqual(backups([2, 50], [0, 0]));
    expect(await backupsOf(SEPTEMBER, PARIS)).toEqual(backups([1, 40], [1, 25]));
    // For each month the tab compares
    expect(await backupsOf(AUGUST, LYON)).toEqual(backups([1, 25], [0, 0]));
  });

  test('gives those of the Unknown account: the bills without an account', async () => {
    expect(await backupsOf(SEPTEMBER, UNKNOWN_ACCOUNT)).toEqual(backups([1, 10], [0, 0]));
  });

  test('gives none for an account recorded without a bill', async () => {
    expect(await backupsOf(SEPTEMBER, NEW_ACCOUNT)).toEqual(backups([0, 0], [0, 0]));
  });

  // Rather than answer for all accounts, or for none, to a request that names an account
  test.each([
    ['a NIC handle that no import recorded', 'account=ww4444-ovh'],
    ['an empty value', 'account='],
    ['several values', `account=${LYON}&account=${PARIS}`],
  ])('refuses an account the server does not know, naming the parameter: %s',
    async (_, parameter) => {
      expect(await ocm.get(`${route}?${SEPTEMBER}&${parameter}`))
        .toEqual({ status: 400, body: REFUSED });
    });
});

// The products of a Public Cloud project over a month, from the bills of that month, and the
// credit that they used, apart (#181): those of the bills of the account the parameter names,
// as the project's cost in the comparison by project, which the Compare tab's detail of the
// project breaks down. A project's bill lines belong to the account of their bill (ADR 0002):
// Staging, moved from Lyon to Paris during September, was billed to both that month.
describe('GET /api/projects/:id/products', () => {
  const route = `/api/projects/${STAGING}/products`;
  // The answer of the route for a month, for the account that the parameter names, or for
  // every account without one
  const productsOf = (month, account) =>
    ocm.get(`${route}?${month}${account === undefined ? '' : `&account=${account}`}`);
  // An answer of the route: what the products cost in all, each product as [product, cost],
  // the most expensive first, and the credit
  const products = (total, entries, credits = 0) => ({
    status: 200,
    body: {
      total, products: entries.map(([product, cost]) => ({ product, total: cost })), credits,
    },
  });

  test('adds up the bills of every account without the parameter, as before', async () => {
    expect(await productsOf(SEPTEMBER))
      .toEqual(products(223, [['instances', 180], ['registry', 40], ['objectStorage', 3]]));
  });

  test('gives those of the bills of the account whose NIC handle it gives', async () => {
    expect(await productsOf(SEPTEMBER, LYON)).toEqual(products(50, [['instances', 50]]));
    expect(await productsOf(SEPTEMBER, PARIS))
      .toEqual(products(170, [['instances', 130], ['registry', 40]]));
    // For each month the tab compares, with the credit that its bills used
    expect(await productsOf(AUGUST, LYON)).toEqual(products(150, [['instances', 150]], -10));
  });

  test('gives those of the Unknown account: the bills without an account', async () => {
    expect(await productsOf(SEPTEMBER, UNKNOWN_ACCOUNT))
      .toEqual(products(3, [['objectStorage', 3]]));
  });

  test('gives none for an account that did not bill the project', async () => {
    expect(await productsOf(SEPTEMBER, NEW_ACCOUNT)).toEqual(products(0, []));
  });

  // What the Compare tab's detail of a project breaks down: its row of the comparison by
  // project, of the same account and month
  test.each([
    ['September', LYON, SEPTEMBER, 50],
    ['September', PARIS, SEPTEMBER, 170],
    ['August', LYON, AUGUST, 140],
  ])('add up, with the credit, to the project\'s cost by project: %s, %s', async (
    _, account, month, cost,
  ) => {
    const { body: { total, credits } } = await productsOf(month, account);
    const { body: projects } = await ocm.get(
      `/api/analysis/by-project?${month}&account=${account}`,
    );

    expect(total + credits).toBe(cost);
    expect(projects).toEqual([expect.objectContaining({ projectId: STAGING, total: cost })]);
  });

  // Rather than answer for all accounts, or for none, to a request that names an account
  test.each([
    ['a NIC handle that no import recorded', 'account=ww4444-ovh'],
    ['an empty value', 'account='],
    ['several values', `account=${LYON}&account=${PARIS}`],
  ])('refuses an account the server does not know, naming the parameter: %s',
    async (_, parameter) => {
      expect(await ocm.get(`${route}?${SEPTEMBER}&${parameter}`))
        .toEqual({ status: 400, body: REFUSED });
    });

  test('refuses a request without its period', async () => {
    expect(await ocm.get(route)).toEqual({
      status: 400, body: { error: 'from and to parameters are required' },
    });
  });
});
