/**
 * The account parameter of the routes behind the Overview (#118), on the server started in a
 * child process over a database that the test seeds with several accounts: a month's costs by
 * service type, by project and by resource type. As on the header's routes (#115, see
 * account-parameter.test.js), a NIC handle that the accounts table records keeps the bill
 * lines of that account's bills, the reserved value `unknown` those of the bills without an
 * account (the Unknown account), and no parameter those of every account, as before. Any
 * other value is refused. The GPU costs take the account parameter since the Trends tab's
 * #120, whose tests cover it (trends-account.test.js).
 *
 * The projects of the breakdown by project and of the GPU costs come once each, as before,
 * unless the request asks for them by account (byAccount=true): each project then comes once
 * for each account that billed it, with that account, null for the Unknown account. Only the
 * Overview's lists that name the account of each project ask so.
 */

const {
  LYON, PARIS, NEW_ACCOUNT, UNKNOWN_ACCOUNT, REFUSED, bill, project,
} = require('./support/accounts');
const { startOcm } = require('./support/ocm-server');

// A bill line of the instances of a flavour in a Public Cloud project, described as OVH
// does: those of a GPU flavour (l4-, l40s-, t1-...) make GPU costs
const instanceLine = (id, billId, projectId, flavor, serviceType, price) => ({
  id, bill_id: billId, project_id: projectId, domain: projectId,
  description: `Instances ${flavor} GRA11`, quantity: 1, unit_price: price, total_price: price,
  service_type: serviceType, resource_type: 'cloud_project',
});
// A bill line of a service outside Public Cloud
const serviceLine = (id, billId, domain, serviceType, resourceType, price) => ({
  id, bill_id: billId, project_id: null, domain, description: `${domain} renewal`,
  quantity: 1, unit_price: price, total_price: price, service_type: serviceType,
  resource_type: resourceType,
});

// Two accounts and the Unknown account, billed in September, and Lyon in August too. Staging
// moved from Lyon to Paris during September: Lyon paid 50 € for its GPU instances until then,
// Paris 230 € since. Every NIC handle, name and amount is made up.
function seed(db) {
  db.accounts.upsert({ nic: LYON, currency: 'EUR', name: 'Lyon subsidiary' });
  db.accounts.upsert({ nic: PARIS, currency: 'EUR' });
  db.accounts.upsert({ nic: NEW_ACCOUNT, currency: 'EUR' });
  project(db, 'project-production', 'Production', LYON);
  project(db, 'project-staging', 'Staging', PARIS);
  bill(db, 'FR1001', '2026-09-05', LYON);
  bill(db, 'FR1002', '2026-08-05', LYON);
  bill(db, 'FR2001', '2026-09-10', PARIS);
  // Imported before OCM told accounts apart, and claimed by no account since: the writers
  // refuse such rows now, so they are written as the database held them
  const sqlite = db.getDb();
  sqlite.prepare(
    "INSERT INTO projects (id, name, account) VALUES ('project-legacy', 'Legacy', NULL)",
  ).run();
  sqlite.prepare(
    "INSERT INTO bills (id, date, currency, account) VALUES ('FR0001', '2026-09-20', 'EUR', NULL)",
  ).run();
  db.details.insertMany([
    instanceLine('FR1001-1', 'FR1001', 'project-production', 'l4-90', 'AI/ML', 400),
    instanceLine('FR1001-2', 'FR1001', 'project-production', 'b3-8', 'Compute', 200),
    instanceLine('FR1001-3', 'FR1001', 'project-staging', 'l40s-180', 'Compute', 50),
    serviceLine('FR1001-4', 'FR1001', 'ns3000001.ip-203-0-113.eu', 'Compute',
      'dedicated_server', 100),
    instanceLine('FR1002-1', 'FR1002', 'project-production', 'l4-90', 'AI/ML', 500),
    instanceLine('FR2001-1', 'FR2001', 'project-staging', 'b3-16', 'Compute', 150),
    instanceLine('FR2001-2', 'FR2001', 'project-staging', 'l40s-180', 'AI/ML', 80),
    serviceLine('FR2001-3', 'FR2001', 'example.com', 'Other', 'domain', 40),
    instanceLine('FR0001-1', 'FR0001', 'project-legacy', 't1-45', 'AI/ML', 60),
    serviceLine('FR0001-2', 'FR0001', 'legacy.example.org', 'Other', 'domain', 30),
  ]);
}

const SEPTEMBER = 'from=2026-09-01&to=2026-09-30';

let ocm;

beforeAll(async () => {
  ocm = await startOcm(() => ({}), { seed });
}, 30000);

afterAll(async () => {
  await ocm?.stop();
});

// The answer of a route of the Overview for September, for the account that the parameter
// names, or for every account without one
const septemberOf = (route, account) =>
  ocm.get(`${route}?${SEPTEMBER}${account === undefined ? '' : `&account=${account}`}`);

describe('GET /api/analysis/by-service', () => {
  const route = '/api/analysis/by-service';
  const service = (name, value, color, detailsCount) => ({ name, value, color, detailsCount });
  const aiMl = (value, count) => service('AI/ML', value, '#ec4899', count);
  const compute = (value, count) => service('Compute', value, '#3b82f6', count);
  const other = (value, count) => service('Other', value, '#6b7280', count);

  test('adds up every account without the parameter, as before', async () => {
    expect(await septemberOf(route)).toEqual({
      status: 200, body: [aiMl(540, 3), compute(500, 4), other(70, 2)],
    });
  });

  test('gives the service types of the account whose NIC handle it gives', async () => {
    expect(await septemberOf(route, LYON)).toEqual({
      status: 200, body: [aiMl(400, 1), compute(350, 3)],
    });
    expect(await septemberOf(route, PARIS)).toEqual({
      status: 200, body: [compute(150, 1), aiMl(80, 1), other(40, 1)],
    });
  });

  test('gives those of the Unknown account: the bills without an account', async () => {
    expect(await septemberOf(route, UNKNOWN_ACCOUNT)).toEqual({
      status: 200, body: [aiMl(60, 1), other(30, 1)],
    });
  });

  test('gives none for an account recorded without a bill', async () => {
    expect(await septemberOf(route, NEW_ACCOUNT)).toEqual({ status: 200, body: [] });
  });
});

describe('GET /api/analysis/by-project', () => {
  const route = '/api/analysis/by-project';
  // A project of the breakdown, and the same for the account of the bills it adds up
  const billed = (projectId, projectName, total, detailsCount) => ({
    projectId, projectName, total, detailsCount,
  });
  const production = billed('project-production', 'Production', 600, 2);
  const staging = (total, detailsCount) =>
    billed('project-staging', 'Staging', total, detailsCount);
  const legacy = billed('project-legacy', 'Legacy', 60, 1);
  const ofAccount = (row, account) => ({ ...row, account });

  // Staging once, at what every account paid for it
  test('lists each project once for every account without the parameter, as before',
    async () => {
      const everyAccount = { status: 200, body: [production, staging(280, 3), legacy] };

      expect(await septemberOf(route)).toEqual(everyAccount);
      expect(await ocm.get(`${route}?${SEPTEMBER}&byAccount=false`)).toEqual(everyAccount);
    });

  // For the Overview's breakdown, which names the account of each project: Staging, moved
  // from Lyon to Paris, comes for each, as it does in the projects of each account
  test('lists each project for each account that billed it, with the account, when asked to',
    async () => {
      expect(await ocm.get(`${route}?${SEPTEMBER}&byAccount=true`)).toEqual({
        status: 200,
        body: [
          ofAccount(production, LYON), ofAccount(staging(230, 2), PARIS),
          ofAccount(legacy, null), ofAccount(staging(50, 1), LYON),
        ],
      });
    });

  test('lists the projects billed to the account whose NIC handle it gives', async () => {
    expect(await septemberOf(route, LYON)).toEqual({
      status: 200, body: [production, staging(50, 1)],
    });
    expect(await septemberOf(route, PARIS)).toEqual({ status: 200, body: [staging(230, 2)] });
  });

  test('lists those of the Unknown account: the bills without an account', async () => {
    expect(await septemberOf(route, UNKNOWN_ACCOUNT)).toEqual({ status: 200, body: [legacy] });
  });

  test('lists none for an account recorded without a bill', async () => {
    expect(await septemberOf(route, NEW_ACCOUNT)).toEqual({ status: 200, body: [] });
  });
});

// The lists of projects that name no account: Staging comes once, at what every account paid
// for it, rather than once for each
describe('the other lists of the projects of every account', () => {
  test('give each project once among the top projects of the summary', async () => {
    expect((await septemberOf('/api/summary')).body.topProjects).toEqual([
      { name: 'Production', value: 600 },
      { name: 'Staging', value: 280 },
      { name: 'Legacy', value: 60 },
    ]);
  });

  test('export each project once in the costs by project', async () => {
    const res = await fetch(`${ocm.url}/api/export/by-project?${SEPTEMBER}`);

    // Read as text, without the byte order mark that starts the file
    expect((await res.text()).split('\n')).toEqual([
      '"Projet";"ID Projet";"Total HT";"Nb Lignes"',
      '"Production";"project-production";600;2',
      '"Staging";"project-staging";280;3',
      '"Legacy";"project-legacy";60;1',
    ]);
  });
});

describe('GET /api/analysis/by-resource-type', () => {
  const route = '/api/analysis/by-resource-type';
  const costs = (name, resourceType, value, color, detailsCount, serviceCount) => ({
    name, resource_type: resourceType, value, color, detailsCount, serviceCount,
  });
  const publicCloud = (value, detailsCount, serviceCount) =>
    costs('Public Cloud', 'cloud_project', value, '#3b82f6', detailsCount, serviceCount);
  const dedicatedServers = costs('Dedicated Servers', 'dedicated_server', 100, '#ef4444', 1, 1);
  const domains = (value, count) => costs('Domains', 'domain', value, '#8b5cf6', count, count);

  test('adds up every account without the parameter, as before', async () => {
    expect(await septemberOf(route)).toEqual({
      status: 200, body: [publicCloud(940, 6, 3), dedicatedServers, domains(70, 2)],
    });
  });

  test('gives the resource types of the account whose NIC handle it gives', async () => {
    expect(await septemberOf(route, LYON)).toEqual({
      status: 200, body: [publicCloud(650, 3, 2), dedicatedServers],
    });
    expect(await septemberOf(route, PARIS)).toEqual({
      status: 200, body: [publicCloud(230, 2, 1), domains(40, 1)],
    });
  });

  test('gives those of the Unknown account: the bills without an account', async () => {
    expect(await septemberOf(route, UNKNOWN_ACCOUNT)).toEqual({
      status: 200, body: [publicCloud(60, 1, 1), domains(30, 1)],
    });
  });

  test('gives none for an account recorded without a bill', async () => {
    expect(await septemberOf(route, NEW_ACCOUNT)).toEqual({ status: 200, body: [] });
  });
});

// The rest of the GPU costs, and their account parameter, are the Trends tab's tests'
describe('the projects of GET /api/gpu/summary', () => {
  const gpuProjectsOf = async (parameters = '') =>
    (await ocm.get(`/api/gpu/summary?${SEPTEMBER}${parameters}`)).body.byProject;
  // A project of the GPU costs; no consumption was imported to tell its GPU flavours
  const gpuProject = (projectName, projectId, total) => ({
    project_name: projectName, project_id: projectId, total, gpu_flavors: '',
  });
  const production = gpuProject('Production', 'project-production', 400);
  const staging = (total) => gpuProject('Staging', 'project-staging', total);
  const legacy = gpuProject('Legacy', 'project-legacy', 60);
  const ofAccount = (row, account) => ({ ...row, account });

  test('come once each for every account, as before', async () => {
    expect(await gpuProjectsOf()).toEqual([production, staging(130), legacy]);
  });

  test('come for each account that billed them, with the account, when asked to', async () => {
    expect(await gpuProjectsOf('&byAccount=true')).toEqual([
      ofAccount(production, LYON), ofAccount(staging(80), PARIS), ofAccount(legacy, null),
      ofAccount(staging(50), LYON),
    ]);
  });

  test('are those of the account whose NIC handle it gives, or of the Unknown account',
    async () => {
      expect(await gpuProjectsOf(`&account=${LYON}`)).toEqual([production, staging(50)]);
      expect(await gpuProjectsOf(`&account=${PARIS}`)).toEqual([staging(80)]);
      expect(await gpuProjectsOf(`&account=${UNKNOWN_ACCOUNT}`)).toEqual([legacy]);
    });
});

// Rather than answer for all accounts, or for none, to a request that names an account
describe('an account the server does not know', () => {
  test.each([
    ['a NIC handle that no import recorded', 'account=ww4444-ovh'],
    ['an empty value', 'account='],
    ['several values', `account=${LYON}&account=${PARIS}`],
  ])('is refused by the routes of the Overview, naming the parameter: %s',
    async (_, parameter) => {
      for (const route of [
        '/api/analysis/by-service',
        '/api/analysis/by-project',
        '/api/analysis/by-resource-type',
      ]) {
        expect(await ocm.get(`${route}?${SEPTEMBER}&${parameter}`))
          .toEqual({ status: 400, body: REFUSED });
      }
    });
});

// Rather than list the projects once, or by account, when a request asks for neither
describe('a byAccount parameter other than true or false', () => {
  test.each([
    ['another value', 'byAccount=yes'],
    ['several values', 'byAccount=true&byAccount=true'],
  ])('is refused by the lists of projects, naming it: %s', async (_, parameter) => {
    for (const route of ['/api/analysis/by-project', '/api/gpu/summary']) {
      expect(await ocm.get(`${route}?${SEPTEMBER}&${parameter}`)).toEqual({
        status: 400, body: { error: "Invalid 'byAccount' parameter: expected true or false" },
      });
    }
  });
});
