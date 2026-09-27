/**
 * The account parameter of the data routes (#115), on the server started in a child process
 * over a database that the test seeds with several accounts: a NIC handle that the accounts
 * table records selects that account's rows, the reserved value `unknown` the rows without
 * an account (the Unknown account), and no parameter every account, as before. The routes
 * behind the dashboard's header take it: the months list, and a month's summary.
 */

const {
  LYON, PARIS, NEW_ACCOUNT, UNKNOWN_ACCOUNT, REFUSED, bill, project,
} = require('./support/accounts');
const { startOcm } = require('./support/ocm-server');

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
  project(db, 'project-production', 'Production', LYON);
  project(db, 'project-staging', 'Staging', PARIS);
  bill(db, 'FR1001', '2026-09-05', LYON);
  bill(db, 'FR1002', '2026-08-05', LYON);
  bill(db, 'FR2001', '2026-09-10', PARIS);
  bill(db, 'FR2002', '2026-06-10', PARIS);
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

// A single account, which every bill belongs to: the Unknown account has none, as once
// every bill imported before the upgrade is claimed
function seedEveryBillClaimed(db) {
  db.accounts.upsert({ nic: LYON, currency: 'EUR', name: 'Lyon subsidiary' });
  project(db, 'project-production', 'Production', LYON);
  bill(db, 'FR1001', '2026-09-05', LYON);
  db.details.insertMany([line('FR1001-1', 'FR1001', 'project-production', 600)]);
}

// A month as /api/months lists it
const month = (value, label, from, to) => ({ value, label, from, to });
const SEPTEMBER = month('2026-09', 'Septembre 2026', '2026-09-01', '2026-09-30');
const AUGUST = month('2026-08', 'Août 2026', '2026-08-01', '2026-08-31');
const JUNE = month('2026-06', 'Juin 2026', '2026-06-01', '2026-06-30');
const MAY = month('2026-05', 'Mai 2026', '2026-05-01', '2026-05-31');

// The summary of September, as /api/summary answers it with these figures, and with none
const SEPTEMBER_DATES = 'from=2026-09-01&to=2026-09-30';
const septemberSummary = (figures) => ({
  period: { from: '2026-09-01', to: '2026-09-30' }, ...figures,
});
const NOTHING_IN_SEPTEMBER = septemberSummary({
  total: 0,
  cloudTotal: 0,
  nonCloudTotal: 0,
  dailyAverage: 0,
  billsCount: 0,
  projectsCount: 0,
  topProjects: [],
});

let ocm;

beforeAll(async () => {
  ocm = await startOcm(() => ({}), { seed });
}, 30000);

afterAll(async () => {
  await ocm?.stop();
});

describe('GET /api/months', () => {
  test('lists the months of every account without the parameter, as before', async () => {
    expect(await ocm.get('/api/months')).toEqual({
      status: 200, body: [SEPTEMBER, AUGUST, JUNE, MAY],
    });
  });

  test('lists the months of the account whose NIC handle it gives', async () => {
    expect(await ocm.get(`/api/months?account=${LYON}`)).toEqual({
      status: 200, body: [SEPTEMBER, AUGUST],
    });
    expect(await ocm.get(`/api/months?account=${PARIS}`)).toEqual({
      status: 200, body: [SEPTEMBER, JUNE],
    });
  });

  test('lists the months of the Unknown account: those of the bills without an account',
    async () => {
      expect(await ocm.get(`/api/months?account=${UNKNOWN_ACCOUNT}`)).toEqual({
        status: 200, body: [SEPTEMBER, MAY],
      });
    });

  test('lists no month for an account recorded without a bill', async () => {
    expect(await ocm.get(`/api/months?account=${NEW_ACCOUNT}`)).toEqual({ status: 200, body: [] });
  });
});

describe('GET /api/summary', () => {
  const september = SEPTEMBER_DATES;
  const summary = septemberSummary;

  test('adds up every account without the parameter, as before', async () => {
    expect(await ocm.get(`/api/summary?${september}`)).toEqual({
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
    expect(await ocm.get(`/api/summary?${september}&account=${LYON}`)).toEqual({
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
      expect(await ocm.get(`/api/summary?${september}&account=${UNKNOWN_ACCOUNT}`)).toEqual({
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

  test('gives no figure for an account recorded without a bill', async () => {
    expect(await ocm.get(`/api/summary?${september}&account=${NEW_ACCOUNT}`)).toEqual({
      status: 200, body: NOTHING_IN_SEPTEMBER,
    });
  });
});

// The reserved value selects the Unknown account whether or not it holds anything
describe('the Unknown account of a database whose every bill has an account', () => {
  let claimed;

  beforeAll(async () => {
    claimed = await startOcm(() => ({}), { seed: seedEveryBillClaimed });
  }, 30000);

  afterAll(async () => {
    await claimed?.stop();
  });

  test('has no month and no figure', async () => {
    expect(await claimed.get(`/api/months?account=${UNKNOWN_ACCOUNT}`))
      .toEqual({ status: 200, body: [] });
    expect(await claimed.get(`/api/summary?${SEPTEMBER_DATES}&account=${UNKNOWN_ACCOUNT}`))
      .toEqual({ status: 200, body: NOTHING_IN_SEPTEMBER });
  });
});

// Rather than answer for all accounts, or for none, to a request that names an account
describe('an account the server does not know', () => {
  test.each([
    ['a NIC handle that no import recorded', 'account=ww4444-ovh'],
    ['an empty value', 'account='],
    ['several values', `account=${LYON}&account=${PARIS}`],
  ])('is refused, naming the parameter: %s', async (_, parameter) => {
    expect(await ocm.get(`/api/months?${parameter}`)).toEqual({ status: 400, body: REFUSED });
    expect(await ocm.get(`/api/summary?from=2026-09-01&to=2026-09-30&${parameter}`))
      .toEqual({ status: 400, body: REFUSED });
  });
});
