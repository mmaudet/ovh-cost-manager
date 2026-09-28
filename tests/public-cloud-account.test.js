/**
 * The account parameter of the routes behind the Public Cloud tab (#121), on the server started
 * in a child process over a database that the test seeds with several accounts: the projects,
 * with their instances and current consumption, and the counts and costs of the tab's cards. A
 * NIC handle that the accounts table records selects that account's projects and resources,
 * the reserved value `unknown` those of the Unknown account, and no parameter those of every
 * account, as before. A project's resources belong to its project's account (ADR 0002): the
 * routes of one project, by its id, take no parameter.
 */

const {
  LYON, PARIS, NEW_ACCOUNT, UNKNOWN_ACCOUNT, REFUSED, bill, project,
} = require('./support/accounts');
const { startOcm } = require('./support/ocm-server');

const PRODUCTION = 'project-production';
const STAGING = 'project-staging';
// Imported before OCM told accounts apart, and claimed by no account since: the Unknown
// account's
const LEGACY = 'project-legacy';

// A bill line of a Public Cloud project, whose id is the service it bills
const line = (id, billId, projectId, description, price) => ({
  id, bill_id: billId, project_id: projectId, domain: projectId, description,
  quantity: 1, unit_price: price, total_price: price, service_type: 'Compute',
  resource_type: 'cloud_project',
});
const instance = (db, id, projectId, flavor) => db.cloudDetails.upsertInstance({
  id, project_id: projectId, name: id, flavor, region: 'GRA11', status: 'ACTIVE',
  created_at: '2026-02-10T08:00:00Z', monthly_billing: 0,
});
// What a project consumed from the 1st of September to the last import
const consumption = (db, projectId, resourceId, price) => db.cloudDetails.insertConsumption({
  project_id: projectId, period_start: '2026-09-01', period_end: '2026-09-14',
  resource_type: 'instance', resource_id: resourceId, resource_name: 'b3-8', quantity: 312,
  unit: 'Hour', unit_price: 0, total_price: price, region: 'GRA11',
});

// Two accounts and the Unknown account, each with a Public Cloud project billed in September.
// Every NIC handle, name, identifier and amount is made up.
function seed(db) {
  db.accounts.upsert({ nic: LYON, currency: 'EUR', name: 'Lyon subsidiary' });
  db.accounts.upsert({ nic: PARIS, currency: 'EUR' });
  db.accounts.upsert({ nic: NEW_ACCOUNT, currency: 'EUR' });
  project(db, PRODUCTION, 'Production', LYON);
  project(db, STAGING, 'Staging', PARIS);
  // The writers refuse such rows now: they are written as the database held them
  const sqlite = db.getDb();
  sqlite.prepare(
    "INSERT INTO projects (id, name, description, status, account)"
      + " VALUES (?, 'Legacy', 'Legacy', 'ok', NULL)",
  ).run(LEGACY);
  bill(db, 'FR1001', '2026-09-05', LYON);
  bill(db, 'FR2001', '2026-09-10', PARIS);
  sqlite.prepare(
    "INSERT INTO bills (id, date, currency, account) VALUES ('FR0001', '2026-09-20', 'EUR', NULL)",
  ).run();

  // The instances and the consumption of the month of the last import, which each account's
  // import records for it (#114)
  instance(db, 'instance-web-1', PRODUCTION, 'b3-8');
  instance(db, 'instance-web-2', PRODUCTION, 'b3-8');
  instance(db, 'instance-node-1', STAGING, 'b3-16');
  instance(db, 'instance-old-1', LEGACY, 'r3-32');
  for (const nic of [LYON, PARIS]) db.cloudDetails.setCurrentConsumptionMonth('2026-09-01', nic);
  consumption(db, PRODUCTION, 'instance-web-1', 200);
  consumption(db, PRODUCTION, 'instance-web-2', 100);
  consumption(db, STAGING, 'instance-node-1', 50);
  consumption(db, LEGACY, 'instance-old-1', 20);

  // What September billed, by account, and what the inventory holds
  db.details.insertMany([
    line('FR1001-1', 'FR1001', PRODUCTION,
      "Consommation à l'heure pour les instances b3-8 à gra11", 120),
    line('FR1001-2', 'FR1001', PRODUCTION, 'Disques supplémentaires à gra11 de type classic', 10),
    line('FR1001-3', 'FR1001', PRODUCTION, 'Snapshots Public Cloud à gra11', 4),
    line('FR1001-4', 'FR1001', PRODUCTION, 'Savings plan savings-plan-b3-8-web', 20),
    line('FR1001-5', 'FR1001', PRODUCTION,
      'Stockage Standard - Bucket assets sur la région gra', 14),
    line('FR2001-1', 'FR2001', STAGING,
      "Consommation à l'heure pour les instances b3-16 à gra11", 60),
    line('FR2001-2', 'FR2001', STAGING, 'Service Kubernetes managé - nœud b3-16', 30),
    line('FR2001-3', 'FR2001', STAGING, 'Container registry - plan S', 40),
    // A bucket that the inventory does not hold
    line('FR2001-4', 'FR2001', STAGING, 'Stockage Standard - Bucket logs sur la région gra', 6),
    line('FR0001-1', 'FR0001', LEGACY, 'Forfait mensuel pour une instance r3-32', 64),
    line('FR0001-2', 'FR0001', LEGACY, 'Disques supplémentaires à sbg5 de type high-speed', 5),
  ]);
  db.cloudDetails.upsertVolume({
    id: 'volume-db-data', project_id: PRODUCTION, name: 'db-data', region: 'GRA11',
    type: 'classic', size_gb: 200, status: 'in-use', bootable: 0, attached_to: 'instance-web-1',
    plan_code: null, created_at: '2026-01-10T08:00:00Z',
  });
  db.cloudDetails.upsertVolume({
    id: 'volume-old', project_id: LEGACY, name: 'old', region: 'SBG5', type: 'high-speed',
    size_gb: 50, status: 'available', bootable: 0, attached_to: '', plan_code: null,
    created_at: null,
  });
  db.cloudDetails.upsertSnapshot({
    id: 'snapshot-web-1', project_id: PRODUCTION, name: 'web-1-golden', region: 'GRA11',
    size_gb: 10, status: 'active', visibility: 'private', os_type: 'linux',
    created_at: '2026-02-14T10:30:00Z',
  });
  db.cloudDetails.upsertSnapshot({
    id: 'snapshot-old', project_id: LEGACY, name: 'old-golden', region: 'SBG5', size_gb: 40,
    status: 'active', visibility: 'private', os_type: 'linux', created_at: null,
  });
  db.cloudDetails.upsertBucket({
    id: `${PRODUCTION}:GRA:assets`, project_id: PRODUCTION, name: 'assets', region: 'GRA',
    storage_class: 'Standard', status: null, objects_count: 1520, objects_size: 4200000000,
    created_at: '2025-11-03T08:00:00Z',
  });
}

// The dates of September, as the Public Cloud tab asks for its figures
const SEPTEMBER = 'from=2026-09-01&to=2026-09-30';

let ocm;

beforeAll(async () => {
  ocm = await startOcm(() => ({}), { seed });
}, 30000);

afterAll(async () => {
  await ocm?.stop();
});

describe('GET /api/projects', () => {
  // The projects of an answer, by name, as [id, account]
  const listed = ({ status, body }) => ({
    status, body: body.map(({ id, account }) => [id, account]),
  });

  test('lists the projects of every account without the parameter, as before', async () => {
    expect(listed(await ocm.get('/api/projects'))).toEqual({
      status: 200, body: [[LEGACY, null], [PRODUCTION, LYON], [STAGING, PARIS]],
    });
  });

  test('lists the projects of the account whose NIC handle it gives', async () => {
    expect(listed(await ocm.get(`/api/projects?account=${LYON}`)))
      .toEqual({ status: 200, body: [[PRODUCTION, LYON]] });
    expect(listed(await ocm.get(`/api/projects?account=${PARIS}`)))
      .toEqual({ status: 200, body: [[STAGING, PARIS]] });
  });

  test('lists the projects of the Unknown account, and none of an account without one',
    async () => {
      expect(listed(await ocm.get(`/api/projects?account=${UNKNOWN_ACCOUNT}`)))
        .toEqual({ status: 200, body: [[LEGACY, null]] });
      expect(await ocm.get(`/api/projects?account=${NEW_ACCOUNT}`))
        .toEqual({ status: 200, body: [] });
    });
});

describe('GET /api/projects/enriched', () => {
  // A project as the route lists it: with its instances, what it consumed in the month of the
  // last import, and its account. The seeded ones are described by their name.
  const enriched = (id, name, account, instanceCount, consumed) => ({
    id, name, description: name, status: 'ok', account,
    instance_count: instanceCount, consumption_total: consumed,
    period_start: '2026-09-01', period_end: '2026-09-14',
  });
  const production = enriched(PRODUCTION, 'Production', LYON, 2, 300);
  const staging = enriched(STAGING, 'Staging', PARIS, 1, 50);
  const legacy = enriched(LEGACY, 'Legacy', null, 1, 20);

  test('lists the projects of every account without the parameter, as before, with their account',
    async () => {
      // Most consuming first
      expect(await ocm.get('/api/projects/enriched')).toEqual({
        status: 200, body: [production, staging, legacy],
      });
    });

  test('lists the projects of the account whose NIC handle it gives', async () => {
    expect(await ocm.get(`/api/projects/enriched?account=${LYON}`))
      .toEqual({ status: 200, body: [production] });
    expect(await ocm.get(`/api/projects/enriched?account=${PARIS}`))
      .toEqual({ status: 200, body: [staging] });
  });

  test('lists the projects of the Unknown account: those without an account', async () => {
    expect(await ocm.get(`/api/projects/enriched?account=${UNKNOWN_ACCOUNT}`))
      .toEqual({ status: 200, body: [legacy] });
  });

  test('lists no project for an account recorded without one', async () => {
    expect(await ocm.get(`/api/projects/enriched?account=${NEW_ACCOUNT}`))
      .toEqual({ status: 200, body: [] });
  });
});

describe('GET /api/analysis/public-cloud-stats', () => {
  // The figures of September, of the account that the parameters name, if any
  const stats = (parameters = '') =>
    ocm.get(`/api/analysis/public-cloud-stats?${SEPTEMBER}${parameters}`);
  // The figures of the cards, as the route answers them: a count and a cost for each kind of
  // resource, a cost only for the instances. None by default.
  const figures = (counted) => ({
    kubernetes: { count: 0, total: 0 },
    instances: { total: 0 },
    volumes: { count: 0, total: 0 },
    snapshots: { count: 0, total: 0 },
    savingsPlans: { count: 0, total: 0 },
    objectStorage: { count: 0, total: 0 },
    registry: { count: 0, total: 0 },
    // What no card of its own counts (#145)
    other: { total: 0, products: [] },
    aiml: { count: 0, total: 0 },
    loadBalancers: { count: 0, total: 0 },
    ...counted,
  });

  test('counts the resources of every account without the parameter, as before', async () => {
    expect(await stats()).toEqual({
      status: 200,
      body: figures({
        kubernetes: { count: 1, total: 30 },
        instances: { total: 244 },
        volumes: { count: 2, total: 15 },
        snapshots: { count: 2, total: 4 },
        savingsPlans: { count: 1, total: 20 },
        // The buckets of the inventory, which holds one
        objectStorage: { count: 1, total: 20 },
        registry: { count: 1, total: 40 },
      }),
    });
  });

  // The costs are those of the account's bills, the counts those of the resources of its
  // projects
  test('counts the resources of the account whose NIC handle it gives', async () => {
    expect(await stats(`&account=${LYON}`)).toEqual({
      status: 200,
      body: figures({
        instances: { total: 120 },
        volumes: { count: 1, total: 10 },
        snapshots: { count: 1, total: 4 },
        savingsPlans: { count: 1, total: 20 },
        objectStorage: { count: 1, total: 14 },
      }),
    });
    expect(await stats(`&account=${PARIS}`)).toEqual({
      status: 200,
      body: figures({
        kubernetes: { count: 1, total: 30 },
        instances: { total: 60 },
        // The inventory holds buckets, none of its projects': the one its bill names is gone
        objectStorage: { count: 0, total: 6 },
        registry: { count: 1, total: 40 },
      }),
    });
  });

  test('counts the resources of the Unknown account: of the bills and projects without one',
    async () => {
      expect(await stats(`&account=${UNKNOWN_ACCOUNT}`)).toEqual({
        status: 200,
        body: figures({
          instances: { total: 64 },
          volumes: { count: 1, total: 5 },
          snapshots: { count: 1, total: 0 },
        }),
      });
    });

  test('counts nothing for an account recorded without a project', async () => {
    expect(await stats(`&account=${NEW_ACCOUNT}`)).toEqual({ status: 200, body: figures({}) });
  });
});

// Lyon's Analytics project, whose bucket Paris's bill of September names, as when a project
// moves from an account to another: with its bucket in the inventory, or with no inventory
// imported at all
const ANALYTICS = 'project-analytics';
const billedByParis = ({ inventory }) => (db) => {
  db.accounts.upsert({ nic: LYON, currency: 'EUR', name: 'Lyon subsidiary' });
  db.accounts.upsert({ nic: PARIS, currency: 'EUR' });
  project(db, ANALYTICS, 'Analytics', LYON);
  bill(db, 'FR2101', '2026-09-10', PARIS);
  db.details.insertMany([
    line('FR2101-1', 'FR2101', ANALYTICS,
      'Stockage Standard - Bucket reports sur la région gra', 8),
  ]);
  if (inventory) {
    db.cloudDetails.upsertBucket({
      id: `${ANALYTICS}:GRA:reports`, project_id: ANALYTICS, name: 'reports', region: 'GRA',
      storage_class: 'Standard', status: null, objects_count: 12, objects_size: 3600000,
      created_at: '2026-03-02T08:00:00Z',
    });
  }
};

// A bucket counts once, in one account, so that the accounts add up to all of them: whether
// the inventory or the bills count the buckets is decided for all accounts at once
describe('a bucket of a project billed on the bills of another account', () => {
  // The number of buckets of all accounts, of Lyon, and of Paris
  const bucketCounts = async (server) => {
    const counts = [];
    for (const parameter of ['', `&account=${LYON}`, `&account=${PARIS}`]) {
      const path = `/api/analysis/public-cloud-stats?${SEPTEMBER}${parameter}`;
      counts.push((await server.get(path)).body.objectStorage.count);
    }
    return counts;
  };

  describe('in the inventory', () => {
    let server;

    beforeAll(async () => {
      server = await startOcm(() => ({}), { seed: billedByParis({ inventory: true }) });
    }, 30000);

    afterAll(async () => {
      await server?.stop();
    });

    test('counts in the account of its project only', async () => {
      expect(await bucketCounts(server)).toEqual([1, 1, 0]);
    });
  });

  describe('with no inventory imported', () => {
    let server;

    beforeAll(async () => {
      server = await startOcm(() => ({}), { seed: billedByParis({ inventory: false }) });
    }, 30000);

    afterAll(async () => {
      await server?.stop();
    });

    test('counts in the account of the bill that names it only', async () => {
      expect(await bucketCounts(server)).toEqual([1, 0, 1]);
    });
  });
});

// Rather than answer for all accounts, or for none, to a request that names an account
describe('an account the server does not know', () => {
  test.each([
    ['a NIC handle that no import recorded', 'account=ww4444-ovh'],
    ['an empty value', 'account='],
    ['several values', `account=${LYON}&account=${PARIS}`],
  ])('is refused, naming the parameter: %s', async (_, parameter) => {
    expect(await ocm.get(`/api/projects?${parameter}`)).toEqual({ status: 400, body: REFUSED });
    expect(await ocm.get(`/api/projects/enriched?${parameter}`))
      .toEqual({ status: 400, body: REFUSED });
    expect(await ocm.get(`/api/analysis/public-cloud-stats?${SEPTEMBER}&${parameter}`))
      .toEqual({ status: 400, body: REFUSED });
  });
});
