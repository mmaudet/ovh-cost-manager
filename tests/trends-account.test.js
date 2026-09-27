/**
 * The account parameter of the routes behind the Trends tab (#120): the monthly trend, the
 * trend by resource type and the GPU costs, on the server started in a child process over a
 * database that the test seeds with several accounts. As on the header's routes (#115, see
 * account-parameter.test.js), a NIC handle that the accounts table records selects that
 * account's bills, the reserved value `unknown` the bills without an account (the Unknown
 * account), and no parameter every account, as before. Any other value is refused.
 */

const { LYON, PARIS, NEW_ACCOUNT, REFUSED, bill, project } = require('./support/accounts');
const { startOcm } = require('./support/ocm-server');

// A bill line of a Public Cloud project, for its instances of a flavour: those of a GPU
// flavour make its GPU costs
const cloudLine = (id, billId, projectId, flavor, price) => ({
  id, bill_id: billId, project_id: projectId, domain: projectId,
  description: `instances ${flavor} GRA11`, quantity: 1, unit_price: price, total_price: price,
  service_type: 'Compute', resource_type: 'cloud_project',
});
// A bill line of no project, of another resource type
const serviceLine = (id, billId, resourceType, price) => ({
  id, bill_id: billId, project_id: null, domain: `${id.toLowerCase()}.example.com`,
  description: `${resourceType} line`, quantity: 1, unit_price: price, total_price: price,
  service_type: 'Other', resource_type: resourceType,
});

// An instance of a project, of the flavour of its plan
const instance = (db, id, projectId, name, planCode) => db.cloudDetails.upsertInstance({
  id, project_id: projectId, name, flavor: planCode.split('.')[0], plan_code: planCode,
  region: 'GRA11', status: 'ACTIVE', created_at: null, monthly_billing: 0,
});

// Two accounts and the Unknown account, each with GPU instances, billed over months that
// differ: Lyon in August and September, Paris in May and July, the Unknown account in June
// and September. Every NIC handle, name and amount is made up.
function seed(db) {
  db.accounts.upsert({ nic: LYON, currency: 'EUR', name: 'Lyon subsidiary' });
  db.accounts.upsert({ nic: PARIS, currency: 'EUR' });
  db.accounts.upsert({ nic: NEW_ACCOUNT, currency: 'EUR' });
  project(db, 'project-production', 'Production', LYON);
  project(db, 'project-staging', 'Staging', PARIS);
  bill(db, 'FR1001', '2026-09-05', LYON);
  bill(db, 'FR1002', '2026-08-05', LYON);
  bill(db, 'FR2001', '2026-07-10', PARIS);
  bill(db, 'FR2002', '2026-05-10', PARIS);
  // Imported before OCM told accounts apart, and claimed by no account since: the writers
  // refuse such rows now, so they are written as the database held them
  const sqlite = db.getDb();
  sqlite.prepare(
    "INSERT INTO projects (id, name, account) VALUES ('project-legacy', 'Legacy', NULL)",
  ).run();
  const unclaimedBill = sqlite.prepare(
    "INSERT INTO bills (id, date, currency, account) VALUES (?, ?, 'EUR', NULL)",
  );
  unclaimedBill.run('FR0001', '2026-09-20');
  unclaimedBill.run('FR0002', '2026-06-20');
  db.details.insertMany([
    cloudLine('FR1001-1', 'FR1001', 'project-production', 'l4-90', 120),
    cloudLine('FR1001-2', 'FR1001', 'project-production', 'b3-8', 480),
    serviceLine('FR1001-3', 'FR1001', 'dedicated_server', 100),
    cloudLine('FR1002-1', 'FR1002', 'project-production', 'l4-90', 100),
    cloudLine('FR1002-2', 'FR1002', 'project-production', 'b3-8', 400),
    cloudLine('FR2001-1', 'FR2001', 'project-staging', 't2-45', 50),
    cloudLine('FR2001-2', 'FR2001', 'project-staging', 'b3-16', 150),
    serviceLine('FR2001-3', 'FR2001', 'domain', 40),
    cloudLine('FR2002-1', 'FR2002', 'project-staging', 't2-45', 30),
    cloudLine('FR2002-2', 'FR2002', 'project-staging', 'b3-16', 120),
    cloudLine('FR0001-1', 'FR0001', 'project-legacy', 'l4-90', 45),
    serviceLine('FR0001-2', 'FR0001', 'domain', 30),
    serviceLine('FR0002-1', 'FR0002', 'dedicated_server', 80),
  ]);
  // The GPU instances of each project, and one of another flavour
  instance(db, 'instance-1', 'project-production', 'inference-1', 'l4-90.consumption');
  instance(db, 'instance-2', 'project-production', 'web-1', 'b3-8.consumption');
  instance(db, 'instance-3', 'project-staging', 'training-1', 't2-45.consumption');
  instance(db, 'instance-4', 'project-legacy', 'legacy-gpu', 'l4-90.consumption');
}

let ocm;

beforeAll(async () => {
  ocm = await startOcm(() => ({}), { seed });
}, 30000);

afterAll(async () => {
  await ocm?.stop();
});

// A month of the monthly trend, as the route answers it: named in French only
const MONTH_NAMES = { '05': 'Mai', '06': 'Jun', '07': 'Jul', '08': 'Aoû', '09': 'Sep' };
const month = (yearMonth, cost) => ({ month: MONTH_NAMES[yearMonth.slice(5)], yearMonth, cost });

// The resource types of the trend by resource type, as the route presents them
const PUBLIC_CLOUD = { key: 'cloud_project', label: 'Public Cloud', color: '#3b82f6' };
const DEDICATED_SERVERS = { key: 'dedicated_server', label: 'Dedicated Servers', color: '#ef4444' };
const DOMAINS = { key: 'domain', label: 'Domains', color: '#8b5cf6' };

// July to September 2026
const THREE_MONTHS = 'months=3&end=2026-09';

describe('GET /api/analysis/monthly-trend', () => {
  const trend = (parameters) => ocm.get(`/api/analysis/monthly-trend?${parameters}`);

  test('adds up every account without the parameter, as before', async () => {
    expect(await trend(THREE_MONTHS)).toEqual({
      status: 200,
      body: [month('2026-07', 240), month('2026-08', 500), month('2026-09', 775)],
    });
  });

  test('adds up the bills of the account whose NIC handle it gives', async () => {
    expect(await trend(`${THREE_MONTHS}&account=${LYON}`)).toEqual({
      status: 200,
      body: [month('2026-07', 0), month('2026-08', 500), month('2026-09', 700)],
    });
    expect(await trend(`${THREE_MONTHS}&account=${PARIS}`)).toEqual({
      status: 200,
      body: [month('2026-07', 240), month('2026-08', 0), month('2026-09', 0)],
    });
  });

  test('adds up the bills of the Unknown account: those without an account', async () => {
    expect(await trend(`${THREE_MONTHS}&account=unknown`)).toEqual({
      status: 200,
      body: [month('2026-07', 0), month('2026-08', 0), month('2026-09', 75)],
    });
  });

  // As over months without any bill (#65)
  test('gives no month for an account without a bill over the months', async () => {
    expect(await trend(`${THREE_MONTHS}&account=${NEW_ACCOUNT}`))
      .toEqual({ status: 200, body: [] });
  });

  describe('without an end month', () => {
    test('ends on the month of the latest bill of every account, as before', async () => {
      expect(await trend('months=3')).toEqual({
        status: 200,
        body: [month('2026-07', 240), month('2026-08', 500), month('2026-09', 775)],
      });
    });

    test('ends on the month of the latest bill of the account it gives', async () => {
      // July, not September
      expect(await trend(`months=3&account=${PARIS}`)).toEqual({
        status: 200,
        body: [month('2026-05', 150), month('2026-06', 0), month('2026-07', 240)],
      });
      // None: no months, as with no bill at all
      expect(await trend(`months=3&account=${NEW_ACCOUNT}`)).toEqual({ status: 200, body: [] });
    });
  });
});

describe('GET /api/analysis/monthly-trend-by-category', () => {
  const trend = (parameters) => ocm.get(`/api/analysis/monthly-trend-by-category?${parameters}`);

  test('adds up every account without the parameter, as before', async () => {
    expect(await trend(THREE_MONTHS)).toEqual({
      status: 200,
      body: {
        categories: [PUBLIC_CLOUD, DEDICATED_SERVERS, DOMAINS],
        data: [
          { yearMonth: '2026-07', cloud_project: 200, dedicated_server: 0, domain: 40 },
          { yearMonth: '2026-08', cloud_project: 500, dedicated_server: 0, domain: 0 },
          { yearMonth: '2026-09', cloud_project: 645, dedicated_server: 100, domain: 30 },
        ],
      },
    });
  });

  test('has the resource types of the account whose NIC handle it gives, alone', async () => {
    expect(await trend(`${THREE_MONTHS}&account=${LYON}`)).toEqual({
      status: 200,
      body: {
        categories: [PUBLIC_CLOUD, DEDICATED_SERVERS],
        data: [
          { yearMonth: '2026-07', cloud_project: 0, dedicated_server: 0 },
          { yearMonth: '2026-08', cloud_project: 500, dedicated_server: 0 },
          { yearMonth: '2026-09', cloud_project: 600, dedicated_server: 100 },
        ],
      },
    });
  });

  test('has the resource types of the Unknown account: those of the bills without an account',
    async () => {
      expect(await trend(`${THREE_MONTHS}&account=unknown`)).toEqual({
        status: 200,
        body: {
          categories: [PUBLIC_CLOUD, DOMAINS],
          data: [
            { yearMonth: '2026-07', cloud_project: 0, domain: 0 },
            { yearMonth: '2026-08', cloud_project: 0, domain: 0 },
            { yearMonth: '2026-09', cloud_project: 45, domain: 30 },
          ],
        },
      });
    });

  test('has no resource type for an account without a bill over the months', async () => {
    expect(await trend(`${THREE_MONTHS}&account=${NEW_ACCOUNT}`))
      .toEqual({ status: 200, body: { categories: [], data: [] } });
  });

  test('ends on the month of the latest bill of the account it gives, without an end month',
    async () => {
      expect(await trend(`months=3&account=${PARIS}`)).toEqual({
        status: 200,
        body: {
          categories: [PUBLIC_CLOUD, DOMAINS],
          data: [
            { yearMonth: '2026-05', cloud_project: 150, domain: 0 },
            { yearMonth: '2026-06', cloud_project: 0, domain: 0 },
            { yearMonth: '2026-07', cloud_project: 200, domain: 40 },
          ],
        },
      });
    });
});

describe('GET /api/gpu/summary', () => {
  const gpuCosts = (parameters) => ocm.get(`/api/gpu/summary?${parameters}`);
  // July to September 2026
  const threeMonths = 'from=2026-07-01&to=2026-09-30';

  // The GPU costs of a project, of a model, and a GPU instance, as the route answers them
  const ofProject = (name, id, total) => ({
    project_name: name, project_id: id, total, gpu_flavors: '',
  });
  const MODEL_COLORS = { 'NVIDIA L4': '#22c55e', 'NVIDIA T4': '#06b6d4' };
  const ofModel = (model, total, count) => ({
    gpu_model: model, total, count, color: MODEL_COLORS[model],
  });
  const gpuInstance = (id, name, projectName, projectId, planCode) => ({
    id, name, project_name: projectName, project_id: projectId, plan_code: planCode,
    flavor: planCode.split('.')[0], region: 'GRA11', status: 'ACTIVE', monthly_billing: 0,
  });
  const INFERENCE = gpuInstance('instance-1', 'inference-1', 'Production', 'project-production',
    'l4-90.consumption');
  const TRAINING = gpuInstance('instance-3', 'training-1', 'Staging', 'project-staging',
    't2-45.consumption');
  const LEGACY = gpuInstance('instance-4', 'legacy-gpu', 'Legacy', 'project-legacy',
    'l4-90.consumption');

  test('adds up every account without the parameter, as before', async () => {
    expect(await gpuCosts(threeMonths)).toEqual({
      status: 200,
      body: {
        total: 315,
        project_count: 3,
        byModel: [ofModel('NVIDIA L4', 265, 3), ofModel('NVIDIA T4', 50, 1)],
        byProject: [
          ofProject('Production', 'project-production', 220),
          ofProject('Staging', 'project-staging', 50),
          ofProject('Legacy', 'project-legacy', 45),
        ],
        monthlyTrend: [
          { month: '2026-07', total: 50 },
          { month: '2026-08', total: 100 },
          { month: '2026-09', total: 165 },
        ],
        // By the name of their project
        instances: [LEGACY, INFERENCE, TRAINING],
      },
    });
  });

  test('gives the GPU costs and instances of the account whose NIC handle it gives',
    async () => {
      expect(await gpuCosts(`${threeMonths}&account=${LYON}`)).toEqual({
        status: 200,
        body: {
          total: 220,
          project_count: 1,
          byModel: [ofModel('NVIDIA L4', 220, 2)],
          byProject: [ofProject('Production', 'project-production', 220)],
          monthlyTrend: [{ month: '2026-08', total: 100 }, { month: '2026-09', total: 120 }],
          instances: [INFERENCE],
        },
      });
    });

  test('gives those of the Unknown account: the bills and the projects without an account',
    async () => {
      expect(await gpuCosts(`${threeMonths}&account=unknown`)).toEqual({
        status: 200,
        body: {
          total: 45,
          project_count: 1,
          byModel: [ofModel('NVIDIA L4', 45, 1)],
          byProject: [ofProject('Legacy', 'project-legacy', 45)],
          monthlyTrend: [{ month: '2026-09', total: 45 }],
          instances: [LEGACY],
        },
      });
    });

  test('gives none for an account without a bill or an instance', async () => {
    expect(await gpuCosts(`${threeMonths}&account=${NEW_ACCOUNT}`)).toEqual({
      status: 200,
      body: {
        total: 0, project_count: 0, byModel: [], byProject: [], monthlyTrend: [], instances: [],
      },
    });
  });

  test('covers the whole history of the account it gives, without dates', async () => {
    expect(await gpuCosts(`account=${PARIS}`)).toEqual({
      status: 200,
      body: {
        total: 80,
        project_count: 1,
        byModel: [ofModel('NVIDIA T4', 80, 2)],
        byProject: [ofProject('Staging', 'project-staging', 80)],
        monthlyTrend: [{ month: '2026-05', total: 30 }, { month: '2026-07', total: 50 }],
        instances: [TRAINING],
      },
    });
  });
});

// Rather than answer for all accounts, or for none, to a request that names an account
describe('an account the server does not know', () => {
  test.each([
    ['a NIC handle that no import recorded', 'account=ww4444-ovh'],
    ['an empty value', 'account='],
    ['several values', `account=${LYON}&account=${PARIS}`],
  ])('is refused by the routes of the Trends tab, naming the parameter: %s',
    async (_, parameter) => {
      expect(await ocm.get(`/api/analysis/monthly-trend?${THREE_MONTHS}&${parameter}`))
        .toEqual({ status: 400, body: REFUSED });
      expect(await ocm.get(`/api/analysis/monthly-trend-by-category?${THREE_MONTHS}&${parameter}`))
        .toEqual({ status: 400, body: REFUSED });
      expect(await ocm.get(`/api/gpu/summary?from=2026-07-01&to=2026-09-30&${parameter}`))
        .toEqual({ status: 400, body: REFUSED });
    });
});
