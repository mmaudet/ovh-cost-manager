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
const backupLine = (id, billId, vm, price, description = `Veeam Backup ${vm}`) => ({
  id, bill_id: billId, project_id: null, domain: vm, description,
  quantity: 1, unit_price: price, total_price: price, service_type: 'Storage',
  resource_type: 'backup',
});
// A bill line of a Veeam Enterprise licence
const licenceLine = (
  id, billId, licence, price, description = 'Veeam Enterprise Plus licence',
) => ({
  id, bill_id: billId, project_id: null, domain: licence, description, quantity: 1,
  unit_price: price, total_price: price, service_type: 'Other', resource_type: 'license',
});
// A bill line of the Staging project
const stagingLine = (id, billId, description, price) => ({
  id, bill_id: billId, project_id: STAGING, domain: STAGING, description, quantity: 1,
  unit_price: price, total_price: price, service_type: 'Compute', resource_type: 'cloud_project',
});

// The only charge of each product that the bills charged the Staging project (#195): what its
// lines pay for, as their descriptions name it
const CHARGES = {
  instances: 'Consommation à l\'heure pour les instances b3-8 gra11',
  registry: 'Managed Private Registry - plan M',
  objectStorage: 'Stockage Standard - Bucket assets sur la région gra',
};

// Two accounts and the Unknown account, whose bills of September back VMs up, and Lyon's of
// August too. In July, Lyon's bill backed vm-web-1 up with extra storage, and gave a licence
// its support, and Paris's backed vm-web-1 up too, before Lyon took it over. The bills of each
// account billed the Staging project in September, and Lyon's in August. Every NIC handle,
// name, identifier and amount is made up.
function seed(db) {
  db.accounts.upsert({ nic: LYON, currency: 'EUR', name: 'Lyon subsidiary' });
  db.accounts.upsert({ nic: PARIS, currency: 'EUR' });
  db.accounts.upsert({ nic: NEW_ACCOUNT, currency: 'EUR' });
  project(db, STAGING, 'Staging', PARIS);
  bill(db, 'FR1001', '2026-09-05', LYON);
  bill(db, 'FR1002', '2026-08-05', LYON);
  bill(db, 'FR1003', '2026-07-05', LYON);
  bill(db, 'FR2001', '2026-09-10', PARIS);
  bill(db, 'FR2002', '2026-07-10', PARIS);
  // Imported before OCM told accounts apart, and claimed by no account since: the writers
  // refuse such rows now, so it is written as the database held it
  db.getDb().prepare(
    "INSERT INTO bills (id, date, currency, account) VALUES ('FR0001', '2026-09-20', 'EUR', NULL)",
  ).run();
  db.details.insertMany([
    backupLine('FR1001-1', 'FR1001', 'vm-web-1', 30),
    backupLine('FR1001-2', 'FR1001', 'vm-db-1', 20),
    backupLine('FR1002-1', 'FR1002', 'vm-web-1', 25),
    backupLine('FR2001-1', 'FR2001', 'vm-app-1', 40),
    licenceLine('FR2001-2', 'FR2001', 'veeam-licence-1', 25),
    backupLine('FR0001-1', 'FR0001', 'vm-old-1', 10),
    backupLine('FR1003-1', 'FR1003', 'vm-web-1', 20),
    backupLine('FR1003-2', 'FR1003', 'vm-web-1', 35,
      'Veeam Backup vm-web-1 - stockage supplémentaire'),
    licenceLine('FR1003-3', 'FR1003', 'veeam-licence-2', 15),
    licenceLine('FR1003-4', 'FR1003', 'veeam-licence-2', 5,
      'Veeam Enterprise Plus licence - support'),
    backupLine('FR2002-1', 'FR2002', 'vm-web-1', 5),
    stagingLine('FR1001-3', 'FR1001', CHARGES.instances, 50),
    stagingLine('FR1002-2', 'FR1002', CHARGES.instances, 150),
    stagingLine('FR1002-3', 'FR1002', 'Utilisation du credit cloud', -10),
    stagingLine('FR2001-3', 'FR2001', CHARGES.instances, 130),
    stagingLine('FR2001-4', 'FR2001', CHARGES.registry, 40),
    stagingLine('FR0001-2', 'FR0001', CHARGES.objectStorage, 3),
  ]);
}

const SEPTEMBER = 'from=2026-09-01&to=2026-09-30';
const AUGUST = 'from=2026-08-01&to=2026-08-31';
const JULY = 'from=2026-07-01&to=2026-07-31';

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

// The services of the Veeam backups of a month (#197), which the Compare tab's backup comparison
// unfolds its two rows into: the VMs backed up, the services of the backup resource type's
// lines, and the Enterprise licences, those of the lines that name Veeam and Enterprise, the
// very lines whose services the Veeam backups count. Each is a row as the bill lines of a
// resource type by service give it (#123), and the route takes the account parameter as they do.
describe('GET /api/analysis/backup-services', () => {
  const route = '/api/analysis/backup-services';
  // The answer of the route for a month, with the parameters given besides
  const servicesOf = (month, parameters = '') => ocm.get(`${route}?${month}${parameters}`);
  // The services of an answer, each as [service, cost], and its account when it gives one
  const listed = ({ status, body: { vms, enterprise } }) => {
    const entries = (services) => services.map(({ domain, total, account }) => (
      account === undefined ? [domain, total] : [domain, total, account]
    ));
    return { status, vms: entries(vms), enterprise: entries(enterprise) };
  };
  // The answer of the route for a month and account, as listed()
  const listedOf = async (month, account) => listed(
    await servicesOf(month, account === undefined ? '' : `&account=${account}`),
  );

  test('gives the VMs and the licences of every account without the parameter', async () => {
    // The most expensive first
    expect(await listedOf(SEPTEMBER)).toEqual({
      status: 200,
      vms: [['vm-app-1', 40], ['vm-web-1', 30], ['vm-db-1', 20], ['vm-old-1', 10]],
      enterprise: [['veeam-licence-1', 25]],
    });
  });

  test('gives each service the description of its most expensive line, as a resource type',
    async () => {
      expect(await servicesOf(JULY, `&account=${LYON}`)).toEqual({
        status: 200,
        body: {
          vms: [{
            domain: 'vm-web-1', description: 'Veeam Backup vm-web-1 - stockage supplémentaire',
            total: 55, line_count: 2,
          }],
          enterprise: [{
            domain: 'veeam-licence-2', description: 'Veeam Enterprise Plus licence',
            total: 20, line_count: 2,
          }],
        },
      });
    });

  test('gives those of the account whose NIC handle it gives', async () => {
    expect(await listedOf(SEPTEMBER, LYON)).toEqual({
      status: 200, vms: [['vm-web-1', 30], ['vm-db-1', 20]], enterprise: [],
    });
    expect(await listedOf(SEPTEMBER, PARIS)).toEqual({
      status: 200, vms: [['vm-app-1', 40]], enterprise: [['veeam-licence-1', 25]],
    });
    // For each month the tab compares
    expect(await listedOf(AUGUST, LYON))
      .toEqual({ status: 200, vms: [['vm-web-1', 25]], enterprise: [] });
  });

  test('gives those of the Unknown account: the bills without an account', async () => {
    expect(await listedOf(SEPTEMBER, UNKNOWN_ACCOUNT))
      .toEqual({ status: 200, vms: [['vm-old-1', 10]], enterprise: [] });
  });

  test('gives none for an account recorded without a bill', async () => {
    expect(await listedOf(SEPTEMBER, NEW_ACCOUNT))
      .toEqual({ status: 200, vms: [], enterprise: [] });
  });

  // A row of the backup comparison counts the services it unfolds into, whose costs add up to
  // its own, but in the cases that getBackupServices() names, which these requests avoid
  test.each([
    ['September, all accounts', SEPTEMBER, undefined],
    ['September, Lyon', SEPTEMBER, LYON],
    ['September, Paris', SEPTEMBER, PARIS],
    ['September, the Unknown account', SEPTEMBER, UNKNOWN_ACCOUNT],
    ['August, Lyon', AUGUST, LYON],
    ['July, all accounts', JULY, undefined],
  ])('are as many as the Veeam backups count, and add up to their cost: %s', async (
    _, month, account,
  ) => {
    const parameter = account === undefined ? '' : `&account=${account}`;
    const { body: services } = await servicesOf(month, parameter);
    const { body: stats } = await ocm.get(`/api/analysis/backup-stats?${month}${parameter}`);
    // The number and the cost of a row's services, as the Veeam backups give them
    const figures = (rowServices) => ({
      count: rowServices.length,
      total: rowServices.reduce((sum, { total }) => sum + total, 0),
    });

    expect({ vms: figures(services.vms), enterprise: figures(services.enterprise) })
      .toEqual(stats);
  });

  // A service billed to two accounts has a row for each, with the description of that
  // account's own lines: vm-web-1, backed up by Paris, then by Lyon, in July
  test('gives each service once for each account that billed it, with byAccount', async () => {
    expect(listed(await servicesOf(JULY, '&byAccount=true'))).toEqual({
      status: 200,
      vms: [['vm-web-1', 55, LYON], ['vm-web-1', 5, PARIS]],
      enterprise: [['veeam-licence-2', 20, LYON]],
    });
    expect(listed(await servicesOf(SEPTEMBER, '&byAccount=true'))).toEqual({
      status: 200,
      vms: [
        ['vm-app-1', 40, PARIS], ['vm-web-1', 30, LYON], ['vm-db-1', 20, LYON],
        ['vm-old-1', 10, null],
      ],
      enterprise: [['veeam-licence-1', 25, PARIS]],
    });
    const { body: { vms: [lyon, paris] } } = await servicesOf(JULY, '&byAccount=true');
    expect(lyon.description).toBe('Veeam Backup vm-web-1 - stockage supplémentaire');
    expect(paris.description).toBe('Veeam Backup vm-web-1');
  });

  // Rather than answer for all accounts, or for none, to a request that names an account
  test.each([
    ['a NIC handle that no import recorded', 'account=ww4444-ovh'],
    ['an empty value', 'account='],
    ['several values', `account=${LYON}&account=${PARIS}`],
  ])('refuses an account the server does not know, naming the parameter: %s',
    async (_, parameter) => {
      expect(await servicesOf(SEPTEMBER, `&${parameter}`))
        .toEqual({ status: 400, body: REFUSED });
    });

  test('refuses a byAccount that is neither true nor false', async () => {
    expect(await servicesOf(SEPTEMBER, '&byAccount=yes')).toEqual({
      status: 400, body: { error: "Invalid 'byAccount' parameter: expected true or false" },
    });
  });

  test('refuses a request without its period, or with an invalid one', async () => {
    expect(await ocm.get(route)).toEqual({
      status: 400, body: { error: 'from and to parameters are required' },
    });
    expect(await ocm.get(`${route}?from=2026-13-01&to=2026-13-31`)).toEqual({
      status: 400, body: { error: "Invalid 'from' date: 2026-13-01" },
    });
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
  // the most expensive first, and the credit. Each product has its only charge, which costs
  // what the product costs (#195).
  const products = (total, entries, credits = 0) => ({
    status: 200,
    body: {
      total,
      products: entries.map(([product, cost]) => ({
        product, total: cost, charges: [{ charge: CHARGES[product], total: cost }],
      })),
      credits,
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
