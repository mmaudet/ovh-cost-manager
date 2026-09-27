/**
 * The account parameter of the routes of the account-wide figures (#116), on the server
 * started in a child process over a database that the test seeds with several accounts: the
 * balance and the movements of the credits, the current month's consumption and its month-end
 * forecast, and the consumption history. A NIC handle that the accounts table records selects
 * that account's figures, the reserved value `unknown` those of the Unknown account, and no
 * parameter those of every account: the sum of each account's, as each account's import
 * records its own (#114), and the accounts bill in one currency.
 */

const {
  LYON, PARIS, NEW_ACCOUNT, UNKNOWN_ACCOUNT, REFUSED, SQLITE_TIME, project, consumption,
  consumptionMonth, snapshot, historyEntry, balance, movement,
} = require('./support/accounts');
const { startOcm } = require('./support/ocm-server');

// A time as Date.prototype.toISOString() writes it: the routes date so a figure that they
// compute as they answer
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

// The server runs in UTC, as the month-end forecast reads the days of the month in the
// server's time zone
const inUtc = () => ({ TZ: 'UTC' });

// An account removed from the configuration after its last import, in July
const REMOVED = 'ab4444-ovh';

// The periods of the history: whole months
const JUNE = ['2026-06-01', '2026-06-30'];
const JULY = ['2026-07-01', '2026-07-31'];
const AUGUST = ['2026-08-01', '2026-08-31'];

// The periods of the current consumption: September, up to the last import of each account
const SEPTEMBER_TO_14 = ['2026-09-01', '2026-09-14'];
const SEPTEMBER_TO_15 = ['2026-09-01', '2026-09-15'];

// What OVH details of Lyon's latest consumption snapshot
const LYON_DETAILS = {
  current: [{ price: { value: 87.5 } }], forecast: [{ price: { value: 192.25 } }],
};

// Two accounts, with their balances, credits, consumption and consumption history, and the
// Unknown account's, which an import before the accounts stored, but for its balance, which
// the import drops. The latest balance of each account is not the latest stored, and that of
// the removed account is of March. OVH gives Lyon its consumption of September, and Paris
// none: the consumption of Paris's project tells it. The Unknown account's is that of the
// month of the last import before the accounts, August, and the removed account's, which OVH
// gave, July's. Every NIC handle, name and amount is made up.
function seed(db) {
  db.accounts.upsert({ nic: LYON, currency: 'EUR', name: 'Lyon subsidiary' });
  db.accounts.upsert({ nic: PARIS, currency: 'EUR' });
  db.accounts.upsert({ nic: NEW_ACCOUNT, currency: 'EUR' });
  db.accounts.upsert({ nic: REMOVED, currency: 'EUR' });
  db.accounts.recordConfiguration([LYON, PARIS, NEW_ACCOUNT]);

  balance(db, REMOVED, { debt: 100, credit: 0, deposit: 0, takenAt: '2026-03-31 04:00:00' });
  balance(db, LYON, { debt: 5, credit: 20, deposit: 0, takenAt: '2026-09-13 04:02:00' });
  balance(db, LYON, { debt: 12.5, credit: 50.25, deposit: 100, takenAt: '2026-09-14 04:02:00' });
  balance(db, PARIS, { debt: 7.5, credit: 0, deposit: 30, takenAt: '2026-09-14 04:01:00' });

  movement(db, LYON, { id: 'VOUCHER_1', amount: 50, date: '2026-08-01T10:00:00+02:00' });
  movement(db, LYON, { id: 'VOUCHER_2', amount: -20, date: '2026-09-01T10:00:00+02:00' });
  // The same id as Lyon's: two accounts' movements can share their ids (#114)
  movement(db, PARIS, { id: 'VOUCHER_1', amount: 30, date: '2026-08-15T10:00:00+02:00' });
  movement(db, null, { id: 'PREPAID_1', amount: 10, date: '2026-06-01T10:00:00+02:00' });

  historyEntry(db, null, JUNE, 'consumption', 80);
  // Of another service type than Lyon's July
  historyEntry(db, null, JULY, 'cloud', 20);
  historyEntry(db, LYON, JULY, 'consumption', 175.5);
  historyEntry(db, LYON, AUGUST, 'consumption', 190.25);
  historyEntry(db, PARIS, AUGUST, 'consumption', 60);
  // A second entry of Paris's for August, as OVH may give an account several for a period
  historyEntry(db, PARIS, AUGUST, 'storage', 12);

  snapshot(db, LYON, ['2026-09-01', '2026-09-10'],
    { current: 60, forecast: 180, takenAt: '2026-09-10 04:02:00' });
  snapshot(db, LYON, SEPTEMBER_TO_14,
    { current: 87.5, forecast: 192.25, details: LYON_DETAILS, takenAt: '2026-09-14 04:02:00' });
  snapshot(db, PARIS, SEPTEMBER_TO_15,
    { current: 0, forecast: 0, takenAt: '2026-09-15 04:01:00' });
  // Lyon's project, whose consumption the snapshot of Lyon's already tells
  project(db, 'project-production', 'Production', LYON);
  consumption(db, 'project-production', SEPTEMBER_TO_14, 300);
  project(db, 'project-staging', 'Staging', PARIS);
  consumption(db, 'project-staging', SEPTEMBER_TO_15, 12.25);
  for (const nic of [LYON, PARIS]) consumptionMonth(db, nic, '2026-09-01');
  // The Unknown account's project, in the month of the last import before the accounts
  project(db, 'project-legacy', 'Legacy', null);
  consumptionMonth(db, null, '2026-08-01');
  consumption(db, 'project-legacy', AUGUST, 40);
  snapshot(db, REMOVED, ['2026-07-01', '2026-07-20'],
    { current: 33, forecast: 50, takenAt: '2026-07-20 04:00:00' });
}

let ocm;

beforeAll(async () => {
  ocm = await startOcm(inUtc, { seed });
}, 30000);

afterAll(async () => {
  await ocm?.stop();
});

// The query string that asks for an account, none for every account
const of = (account) => (account === undefined ? '' : `?account=${account}`);

describe('GET /api/account/balance', () => {
  // A balance as the route answers it
  const balance = (snapshotDate, debt, credit, deposit) => ({
    snapshot_date: snapshotDate, debt_balance: debt, credit_balance: credit,
    deposit_total: deposit, net_balance: Math.round((credit - debt) * 100) / 100,
    currency: 'EUR',
  });

  // Lyon's latest and Paris's, of September, the latest month of a balance, the latest taken
  // by Lyon's import. The removed account's, of March, adds nothing.
  test('adds up the latest balance of every account of the latest month without the parameter',
    async () => {
      expect(await ocm.get('/api/account/balance')).toEqual({
        status: 200, body: balance('2026-09-14 04:02:00', 20, 50.25, 130),
      });
    });

  test('gives the latest balance of the account whose NIC handle it gives', async () => {
    expect(await ocm.get(`/api/account/balance${of(LYON)}`)).toEqual({
      status: 200, body: balance('2026-09-14 04:02:00', 12.5, 50.25, 100),
    });
    expect(await ocm.get(`/api/account/balance${of(PARIS)}`)).toEqual({
      status: 200, body: balance('2026-09-14 04:01:00', 7.5, 0, 30),
    });
  });

  test('gives its latest balance to an account whose latest is of an earlier month',
    async () => {
      expect(await ocm.get(`/api/account/balance${of(REMOVED)}`)).toEqual({
        status: 200, body: balance('2026-03-31 04:00:00', 100, 0, 0),
      });
    });

  test.each([
    ['an account whose import recorded none', NEW_ACCOUNT],
    ['the Unknown account, whose balances the import drops', UNKNOWN_ACCOUNT],
  ])('gives no balance for %s', async (_, account) => {
    expect(await ocm.get(`/api/account/balance${of(account)}`)).toEqual({
      status: 200,
      body: { debt_balance: 0, credit_balance: 0, deposit_total: 0, currency: 'EUR' },
    });
  });
});

describe('GET /api/account/debts', () => {
  test.each([
    ['every account of the latest month, without the parameter', undefined, 20],
    ['the account whose NIC handle it gives', LYON, 12.5],
    ['an account whose latest is of an earlier month', REMOVED, 100],
    ['an account whose import recorded no balance', NEW_ACCOUNT, 0],
    ['the Unknown account, whose balances the import drops', UNKNOWN_ACCOUNT, 0],
  ])('gives the debt of the latest balance of %s', async (_, account, debt) => {
    expect(await ocm.get(`/api/account/debts${of(account)}`)).toEqual({
      status: 200, body: { debt_balance: debt, currency: 'EUR' },
    });
  });
});

describe('GET /api/account/credits', () => {
  // The movements of an answer, most recent first, as [account, id, amount]
  const listed = ({ status, body }) => ({
    status, body: body.map(({ account, id, amount }) => [account, id, amount]),
  });

  test('lists the movements of every account without the parameter, as before', async () => {
    expect(listed(await ocm.get('/api/account/credits'))).toEqual({
      status: 200,
      body: [
        [LYON, 'VOUCHER_2', -20],
        [PARIS, 'VOUCHER_1', 30],
        [LYON, 'VOUCHER_1', 50],
        [null, 'PREPAID_1', 10],
      ],
    });
  });

  test.each([
    [LYON, [[LYON, 'VOUCHER_2', -20], [LYON, 'VOUCHER_1', 50]]],
    [PARIS, [[PARIS, 'VOUCHER_1', 30]]],
    [UNKNOWN_ACCOUNT, [[null, 'PREPAID_1', 10]]],
    [NEW_ACCOUNT, []],
  ])('lists the movements of the account %s only', async (account, movements) => {
    expect(listed(await ocm.get(`/api/account/credits${of(account)}`)))
      .toEqual({ status: 200, body: movements });
  });

  test('gives each movement as its table holds it', async () => {
    const { body } = await ocm.get(`/api/account/credits${of(PARIS)}`);
    expect(body).toEqual([{
      id: 'VOUCHER_1', balance_name: 'VOUCHER', amount: 30, date: '2026-08-15T10:00:00+02:00',
      description: 'Movement VOUCHER_1', movement_type: 'VOUCHER',
      imported_at: expect.stringMatching(SQLITE_TIME), account: PARIS,
    }]);
  });
});

describe('GET /api/consumption/current', () => {
  const current = (parameters = '') => ocm.get(`/api/consumption/current${parameters}`);

  // Lyon's, which OVH tells, and Paris's, which its project tells. The Unknown account's is
  // of an earlier month than theirs, the current one.
  test('adds up the consumption of the accounts in the current month without the parameter',
    async () => {
      expect(await current()).toEqual({
        status: 200,
        body: {
          // Paris's snapshot, the latest of those that tell the figures added up
          snapshot_date: '2026-09-15 04:01:00',
          period_start: '2026-09-01',
          period_end: '2026-09-15',
          current_total: 99.75,
          currency: 'EUR',
        },
      });
    });

  test('gives the consumption that OVH tells of the account whose NIC handle it gives',
    async () => {
      expect(await current(of(LYON))).toEqual({
        status: 200,
        body: {
          snapshot_date: '2026-09-14 04:02:00', period_start: '2026-09-01',
          period_end: '2026-09-14', current_total: 87.5, currency: 'EUR',
          source: 'me_consumption', details: LYON_DETAILS,
        },
      });
    });

  test("gives the consumption of the account's projects when OVH tells none", async () => {
    expect(await current(of(PARIS))).toEqual({
      status: 200,
      body: {
        snapshot_date: '2026-09-15 04:01:00', period_start: '2026-09-01',
        period_end: '2026-09-15', current_total: 12.25, source: 'cloud_projects',
        project_count: 1, currency: 'EUR',
      },
    });
  });

  // Its latest is of an earlier month than the current one, September: as for an account
  // without any, rather than an old month's under the date of today
  test.each([
    ['the Unknown account, whose latest is of August', UNKNOWN_ACCOUNT],
    ['an account no longer configured, whose latest is of July', REMOVED],
  ])('gives no consumption for %s', async (_, account) => {
    expect(await current(of(account)))
      .toEqual({ status: 200, body: { current_total: 0, currency: 'EUR' } });
  });

  test('gives no consumption for an account whose import recorded none', async () => {
    expect(await current(of(NEW_ACCOUNT)))
      .toEqual({ status: 200, body: { current_total: 0, currency: 'EUR' } });
  });
});

describe('GET /api/consumption/forecast', () => {
  const forecast = (parameters = '') => ocm.get(`/api/consumption/forecast${parameters}`);

  test('adds up the forecasts of the accounts in the current month without the parameter',
    async () => {
      expect(await forecast()).toEqual({
        status: 200,
        body: {
          // Paris's forecast, which the route computes as it answers
          snapshot_date: expect.stringMatching(ISO_TIME),
          period_start: '2026-09-01',
          period_end: '2026-09-15',
          // Lyon's 192.25 and Paris's 26.25
          forecast_total: 218.5,
          current_total: 99.75,
          currency: 'EUR',
          progress: 46,
        },
      });
    });

  test('gives the forecast that OVH tells of the account whose NIC handle it gives',
    async () => {
      expect(await forecast(of(LYON))).toEqual({
        status: 200,
        body: {
          snapshot_date: '2026-09-14 04:02:00', period_start: '2026-09-01',
          period_end: '2026-09-14', forecast_total: 192.25, current_total: 87.5,
          currency: 'EUR', progress: 46,
        },
      });
    });

  // 12.25 € over 14 days, for the 30 days of September
  test("extrapolates the consumption of the account's projects when OVH tells none",
    async () => {
      expect(await forecast(of(PARIS))).toEqual({
        status: 200,
        body: {
          snapshot_date: expect.stringMatching(ISO_TIME), period_start: '2026-09-01',
          period_end: '2026-09-15', forecast_total: 26.25, current_total: 12.25,
          currency: 'EUR', progress: 47, source: 'cloud_projects', days_elapsed: 14,
          days_in_month: 30,
        },
      });
    });

  test.each([
    ['the Unknown account, whose latest is of August', UNKNOWN_ACCOUNT],
    ['an account no longer configured, whose latest is of July', REMOVED],
  ])('gives no forecast for %s', async (_, account) => {
    expect(await forecast(of(account)))
      .toEqual({ status: 200, body: { forecast_total: 0, currency: 'EUR' } });
  });

  test('gives no forecast for an account whose import recorded none', async () => {
    expect(await forecast(of(NEW_ACCOUNT)))
      .toEqual({ status: 200, body: { forecast_total: 0, currency: 'EUR' } });
  });
});

describe('GET /api/consumption/usage-history', () => {
  // An entry of the history as the route answers it
  const entry = ([from, to], serviceType, total) => ({
    period_start: from, period_end: to, total, currency: 'EUR', service_type: serviceType,
  });
  const history = (parameters = '') => ocm.get(`/api/consumption/usage-history${parameters}`);

  // The first entry of each account for a period adds up with the first of the others, the
  // second with the second: a period's entries of one account stay apart, as before
  test('adds up the entries of every account for each period without the parameter',
    async () => {
      expect(await history()).toEqual({
        status: 200,
        body: [
          entry(AUGUST, 'storage', 12),
          entry(AUGUST, 'consumption', 250.25),
          // Entries of two service types, which their sum does not name
          entry(JULY, null, 195.5),
          entry(JUNE, 'consumption', 80),
        ],
      });
    });

  test('adds up the entries of the period between two dates', async () => {
    expect(await history('?from=2026-07-01&to=2026-08-31')).toEqual({
      status: 200,
      body: [
        entry(AUGUST, 'storage', 12),
        entry(AUGUST, 'consumption', 250.25),
        entry(JULY, null, 195.5),
      ],
    });
  });

  test.each([
    [LYON, [entry(AUGUST, 'consumption', 190.25), entry(JULY, 'consumption', 175.5)]],
    // Its two entries for August, the latest stored first
    [PARIS, [entry(AUGUST, 'storage', 12), entry(AUGUST, 'consumption', 60)]],
    [UNKNOWN_ACCOUNT, [entry(JULY, 'cloud', 20), entry(JUNE, 'consumption', 80)]],
    [NEW_ACCOUNT, []],
  ])('gives the entries of the account %s only', async (account, entries) => {
    expect(await history(of(account))).toEqual({ status: 200, body: entries });
  });
});

// Rather than answer for all accounts, or for none, to a request that names an account
describe('an account the server does not know', () => {
  test.each([
    ['a NIC handle that no import recorded', 'account=ww4444-ovh'],
    ['an empty value', 'account='],
    ['several values', `account=${LYON}&account=${PARIS}`],
  ])('is refused, naming the parameter: %s', async (_, parameter) => {
    for (const route of [
      '/api/account/balance', '/api/account/debts', '/api/account/credits',
      '/api/consumption/current', '/api/consumption/forecast', '/api/consumption/usage-history',
    ]) {
      expect(await ocm.get(`${route}?${parameter}`)).toEqual({ status: 400, body: REFUSED });
    }
  });
});

// Two accounts that OVH tells no consumption of, each of whose last import covered the
// consumption of its project up to its own day: the forecast of all accounts adds up each
// account's, extrapolated over its own days, as the account shows it alone
describe('the forecast of the accounts that their projects tell', () => {
  // Lyon's project consumed 70 € up to the 15th of September, and Paris's `consumed` up to
  // `to`
  const seedProjects = ({ to, consumed }) => (db) => {
    db.accounts.upsert({ nic: LYON, currency: 'EUR' });
    db.accounts.upsert({ nic: PARIS, currency: 'EUR' });
    project(db, 'project-lyon', 'Lyon', LYON);
    project(db, 'project-paris', 'Paris', PARIS);
    consumption(db, 'project-lyon', SEPTEMBER_TO_15, 70);
    consumption(db, 'project-paris', ['2026-09-01', to], consumed);
    for (const nic of [LYON, PARIS]) consumptionMonth(db, nic, '2026-09-01');
  };

  // Lyon forecasts 150 €, 70 € over 14 days for the 30 days of September, and Paris 60 €
  test.each([
    // 98 € over 14 days
    ['the same days', { to: '2026-09-15', consumed: 28 }],
    // Where 96 € over 14 days would forecast 205.71 €
    ['fewer days for one of them', { to: '2026-09-14', consumed: 26 }],
  ])('adds up the forecast of each account, over %s', async (_, paris) => {
    const server = await startOcm(inUtc, { seed: seedProjects(paris) });
    try {
      const consumed = 70 + paris.consumed;
      expect((await server.get(`/api/consumption/forecast${of(PARIS)}`)).body)
        .toMatchObject({ forecast_total: 60, current_total: paris.consumed });
      expect((await server.get('/api/consumption/forecast')).body).toEqual({
        snapshot_date: expect.stringMatching(ISO_TIME),
        period_start: '2026-09-01',
        period_end: '2026-09-15',
        forecast_total: 210,
        current_total: consumed,
        currency: 'EUR',
        progress: Math.round((consumed / 210) * 100),
        // The days from the earliest start to the latest end, as for one account's projects
        source: 'cloud_projects',
        days_elapsed: 14,
        days_in_month: 30,
      });
      // Both tell their consumption the same way: the sum says so, with both projects
      expect((await server.get('/api/consumption/current')).body).toEqual({
        snapshot_date: expect.stringMatching(ISO_TIME),
        period_start: '2026-09-01',
        period_end: '2026-09-15',
        current_total: consumed,
        currency: 'EUR',
        source: 'cloud_projects',
        project_count: 2,
      });
    } finally {
      await server.stop();
    }
  }, 30000);
});
