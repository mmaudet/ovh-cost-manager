/**
 * The account parameter of the data routes (#115), on the server started in a child process
 * over a database that the test seeds with several accounts: a NIC handle that the accounts
 * table records selects that account's rows, the reserved value `unknown` the rows without
 * an account (the Unknown account), and no parameter every account, as before. The routes
 * behind the dashboard's header take it: the months list, and a month's summary.
 */

const { startOcm } = require('./support/ocm-server');

const LYON = 'xx1111-ovh';
const PARIS = 'yy2222-ovh';
// An account that an import recorded, but that has no bill yet
const NEW_ACCOUNT = 'zz3333-ovh';

// A bill line of a Public Cloud project, or of no project for any other service
const line = (id, billId, projectId, price) => ({
  id, bill_id: billId, project_id: projectId, domain: projectId || 'example.com',
  description: `${id} line`, quantity: 1, unit_price: price, total_price: price,
  service_type: 'Compute', resource_type: projectId ? 'cloud_project' : 'domain',
});

// Two accounts and the Unknown account, each billed in September and one other month.
// Every NIC handle, name and amount is made up.
function seed(db) {
  db.accounts.upsert({ nic: LYON, currency: 'EUR', name: 'Lyon subsidiary' });
  db.accounts.upsert({ nic: PARIS, currency: 'EUR' });
  db.accounts.upsert({ nic: NEW_ACCOUNT, currency: 'EUR' });
  const project = (id, name, account) => db.projects.upsert({
    id, name, description: name, status: 'ok', created_at: null, account,
  });
  const bill = (id, date, account) => db.bills.upsert({
    id, date, price_without_tax: 0, price_with_tax: 0, tax: 0, currency: 'EUR',
    pdf_url: null, html_url: null, account,
  });
  project('project-production', 'Production', LYON);
  project('project-staging', 'Staging', PARIS);
  bill('FR1001', '2026-09-05', LYON);
  bill('FR1002', '2026-08-05', LYON);
  bill('FR2001', '2026-09-10', PARIS);
  bill('FR2002', '2026-06-10', PARIS);
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
  unclaimedBill.run('FR0002', '2026-05-20');
  db.details.insertMany([
    line('FR1001-1', 'FR1001', 'project-production', 600),
    line('FR1001-2', 'FR1001', null, 100),
    line('FR1002-1', 'FR1002', 'project-production', 500),
    line('FR2001-1', 'FR2001', 'project-staging', 200),
    line('FR2001-2', 'FR2001', null, 40),
    line('FR2002-1', 'FR2002', 'project-staging', 150),
    line('FR0001-1', 'FR0001', 'project-legacy', 50),
    line('FR0001-2', 'FR0001', null, 30),
    line('FR0002-1', 'FR0002', null, 80),
  ]);
}

// A month as /api/months lists it
const month = (value, label, from, to) => ({ value, label, from, to });
const SEPTEMBER = month('2026-09', 'Septembre 2026', '2026-09-01', '2026-09-30');
const AUGUST = month('2026-08', 'Août 2026', '2026-08-01', '2026-08-31');
const JUNE = month('2026-06', 'Juin 2026', '2026-06-01', '2026-06-30');
const MAY = month('2026-05', 'Mai 2026', '2026-05-01', '2026-05-31');

// What the server answers for a parameter it refuses
const REFUSED = {
  error: "Invalid 'account' parameter: expected the NIC handle of an account, or unknown",
};

let ocm;

beforeAll(async () => {
  ocm = await startOcm(() => ({}), { seed });
}, 30000);

afterAll(async () => {
  await ocm?.stop();
});

// The status and the JSON body of the answer to a path of the server
async function get(path) {
  const res = await fetch(`${ocm.url}${path}`);
  return { status: res.status, body: await res.json() };
}

describe('GET /api/months', () => {
  test('lists the months of every account without the parameter, as before', async () => {
    expect(await get('/api/months')).toEqual({
      status: 200, body: [SEPTEMBER, AUGUST, JUNE, MAY],
    });
  });

  test('lists the months of the account whose NIC handle it gives', async () => {
    expect(await get(`/api/months?account=${LYON}`)).toEqual({
      status: 200, body: [SEPTEMBER, AUGUST],
    });
    expect(await get(`/api/months?account=${PARIS}`)).toEqual({
      status: 200, body: [SEPTEMBER, JUNE],
    });
  });

  test('lists the months of the Unknown account: those of the bills without an account',
    async () => {
      expect(await get('/api/months?account=unknown')).toEqual({
        status: 200, body: [SEPTEMBER, MAY],
      });
    });

  test('lists no month for an account recorded without a bill', async () => {
    expect(await get(`/api/months?account=${NEW_ACCOUNT}`)).toEqual({ status: 200, body: [] });
  });
});

describe('GET /api/summary', () => {
  const september = 'from=2026-09-01&to=2026-09-30';
  const summary = (figures) => ({
    period: { from: '2026-09-01', to: '2026-09-30' }, ...figures,
  });

  test('adds up every account without the parameter, as before', async () => {
    expect(await get(`/api/summary?${september}`)).toEqual({
      status: 200,
      body: summary({
        total: 1020,
        cloudTotal: 850,
        nonCloudTotal: 170,
        dailyAverage: 34,
        billsCount: 3,
        projectsCount: 3,
        topProjects: [
          { name: 'Production', value: 600 },
          { name: 'Staging', value: 200 },
          { name: 'Legacy', value: 50 },
        ],
      }),
    });
  });

  test('gives the figures of the account whose NIC handle it gives', async () => {
    expect(await get(`/api/summary?${september}&account=${LYON}`)).toEqual({
      status: 200,
      body: summary({
        total: 700,
        cloudTotal: 600,
        nonCloudTotal: 100,
        dailyAverage: 23.33,
        billsCount: 1,
        projectsCount: 1,
        topProjects: [{ name: 'Production', value: 600 }],
      }),
    });
  });

  test('gives the figures of the Unknown account: those of the bills without an account',
    async () => {
      expect(await get(`/api/summary?${september}&account=unknown`)).toEqual({
        status: 200,
        body: summary({
          total: 80,
          cloudTotal: 50,
          nonCloudTotal: 30,
          dailyAverage: 2.67,
          billsCount: 1,
          projectsCount: 1,
          topProjects: [{ name: 'Legacy', value: 50 }],
        }),
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
    expect(await get(`/api/months?${parameter}`)).toEqual({ status: 400, body: REFUSED });
    expect(await get(`/api/summary?from=2026-09-01&to=2026-09-30&${parameter}`))
      .toEqual({ status: 400, body: REFUSED });
  });
});
