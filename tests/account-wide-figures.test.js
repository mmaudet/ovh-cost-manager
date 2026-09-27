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
  LYON, PARIS, NEW_ACCOUNT, UNKNOWN_ACCOUNT, REFUSED, SQLITE_TIME, project,
} = require('./support/accounts');
const { startOcm } = require('./support/ocm-server');

// A time as Date.prototype.toISOString() writes it: the routes date so a figure that they
// compute as they answer
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

// The server runs in UTC, as the month-end forecast reads the days of the month in the
// server's time zone
const inUtc = () => ({ TZ: 'UTC' });

// A balance of an account, taken at a time, as its import stores it: the Unknown account's
// is written as the database held it, since the writers refuse a row without an account
function storeBalance(db, account, takenAt, { debt, credit, deposit }) {
  const balance = {
    debt_balance: debt, credit_balance: credit, deposit_total: deposit, currency: 'EUR',
  };
  const sqlite = db.getDb();
  const { lastInsertRowid } = account === null
    ? sqlite.prepare(`
      INSERT INTO account_balance (debt_balance, credit_balance, deposit_total, currency)
      VALUES (@debt_balance, @credit_balance, @deposit_total, @currency)
    `).run(balance)
    : db.balance.insertBalance({ ...balance, account });
  sqlite.prepare('UPDATE account_balance SET snapshot_date = ? WHERE id = ?')
    .run(takenAt, lastInsertRowid);
}

// A movement of a credit of an account, the Unknown account's written as the database held it
function storeMovement(db, account, { id, amount, date }) {
  const movement = {
    id, balance_name: id.split('_')[0], amount, date, description: `Movement ${id}`,
    movement_type: amount > 0 ? 'VOUCHER' : 'USE',
  };
  if (account !== null) {
    db.balance.insertCreditMovement({ ...movement, account });
    return;
  }
  db.getDb().prepare(`
    INSERT INTO credit_movements
      (id, balance_name, amount, date, description, movement_type, account)
    VALUES (@id, @balance_name, @amount, @date, @description, @movement_type, NULL)
  `).run(movement);
}

// An entry of the consumption history of an account, as its import stores each one that OVH
// gives, the Unknown account's written as the database held it
function storeHistory(db, account, [from, to], serviceType, total) {
  const entry = {
    period_start: from, period_end: to, service_type: serviceType, total, currency: 'EUR',
    raw_data: '{}',
  };
  if (account !== null) {
    db.consumption.insertHistory({ ...entry, account });
    return;
  }
  db.getDb().prepare(`
    INSERT INTO consumption_history (period_start, period_end, service_type, total, currency,
      raw_data)
    VALUES (@period_start, @period_end, @service_type, @total, @currency, @raw_data)
  `).run(entry);
}

// The periods of the history: whole months
const JUNE = ['2026-06-01', '2026-06-30'];
const JULY = ['2026-07-01', '2026-07-31'];
const AUGUST = ['2026-08-01', '2026-08-31'];

// A consumption snapshot of an account, taken at a time, as its import stores the month's
// consumption so far and its forecast that OVH gives
function storeSnapshot(db, account, takenAt, [from, to], { current, forecast, details = {} }) {
  const { lastInsertRowid } = db.consumption.insertSnapshot({
    period_start: from, period_end: to, current_total: current, forecast_total: forecast,
    currency: 'EUR', raw_data: JSON.stringify(details), account,
  });
  db.getDb().prepare('UPDATE consumption_snapshots SET snapshot_date = ? WHERE id = ?')
    .run(takenAt, lastInsertRowid);
}

// What a Public Cloud project consumed from the first day of a month to the last import
const storeProjectConsumption = (db, projectId, [from, to], totalPrice) =>
  db.cloudDetails.insertConsumption({
    project_id: projectId, period_start: from, period_end: to, resource_type: 'instance',
    resource_id: `${projectId}-instance`, resource_name: 'b3-8', quantity: 312, unit: 'Hour',
    unit_price: 0, total_price: totalPrice, region: 'GRA11',
  });

// The Unknown account's Public Cloud project, and the month of the current consumption that
// the last import before the accounts recorded, written as the database held them
function storeProjectWithoutAccount(db, projectId, month) {
  const sqlite = db.getDb();
  sqlite.prepare(
    "INSERT INTO projects (id, name, description, status) VALUES (?, 'Legacy', 'Legacy', 'ok')",
  ).run(projectId);
  sqlite.prepare(
    "INSERT INTO import_state (key, value, account) VALUES ('consumption_month', ?, NULL)",
  ).run(month);
}

// The periods of the current consumption: September, up to the last import of each account
const SEPTEMBER_TO_14 = ['2026-09-01', '2026-09-14'];
const SEPTEMBER_TO_15 = ['2026-09-01', '2026-09-15'];

// What OVH details of Lyon's latest consumption snapshot
const LYON_DETAILS = {
  current: [{ price: { value: 87.5 } }], forecast: [{ price: { value: 192.25 } }],
};

// Two accounts, with their balances, credits, consumption and consumption history, and the
// Unknown account's, which an import before the accounts stored. The latest balance of each
// account is not the latest stored. OVH gives Lyon its consumption of September, and Paris
// none: the consumption of Paris's project tells it. The Unknown account's is that of the
// month of the last import before the accounts, August. Every NIC handle, name and amount is
// made up.
function seed(db) {
  db.accounts.upsert({ nic: LYON, currency: 'EUR', name: 'Lyon subsidiary' });
  db.accounts.upsert({ nic: PARIS, currency: 'EUR' });
  db.accounts.upsert({ nic: NEW_ACCOUNT, currency: 'EUR' });

  storeBalance(db, null, '2026-06-30 08:00:00', { debt: 1, credit: 4.75, deposit: 0 });
  storeBalance(db, LYON, '2026-09-13 04:02:00', { debt: 5, credit: 20, deposit: 0 });
  storeBalance(db, LYON, '2026-09-14 04:02:00', { debt: 12.5, credit: 50.25, deposit: 100 });
  storeBalance(db, PARIS, '2026-09-14 04:01:00', { debt: 7.5, credit: 0, deposit: 30 });

  storeMovement(db, LYON, { id: 'VOUCHER_1', amount: 50, date: '2026-08-01T10:00:00+02:00' });
  storeMovement(db, LYON, { id: 'VOUCHER_2', amount: -20, date: '2026-09-01T10:00:00+02:00' });
  // The same id as Lyon's: two accounts' movements can share their ids (#114)
  storeMovement(db, PARIS, { id: 'VOUCHER_1', amount: 30, date: '2026-08-15T10:00:00+02:00' });
  storeMovement(db, null, { id: 'PREPAID_1', amount: 10, date: '2026-06-01T10:00:00+02:00' });

  storeHistory(db, null, JUNE, 'consumption', 80);
  // Of another service type than Lyon's July
  storeHistory(db, null, JULY, 'cloud', 20);
  storeHistory(db, LYON, JULY, 'consumption', 175.5);
  storeHistory(db, LYON, AUGUST, 'consumption', 190.25);
  storeHistory(db, PARIS, AUGUST, 'consumption', 60);
  // A second entry of Paris's for August, as OVH may give an account several for a period
  storeHistory(db, PARIS, AUGUST, 'storage', 12);

  storeSnapshot(db, LYON, '2026-09-10 04:02:00', ['2026-09-01', '2026-09-10'],
    { current: 60, forecast: 180 });
  storeSnapshot(db, LYON, '2026-09-14 04:02:00', SEPTEMBER_TO_14,
    { current: 87.5, forecast: 192.25, details: LYON_DETAILS });
  storeSnapshot(db, PARIS, '2026-09-15 04:01:00', SEPTEMBER_TO_15, { current: 0, forecast: 0 });
  // Lyon's project, whose consumption the snapshot of Lyon's already tells
  project(db, 'project-production', 'Production', LYON);
  storeProjectConsumption(db, 'project-production', SEPTEMBER_TO_14, 300);
  project(db, 'project-staging', 'Staging', PARIS);
  storeProjectConsumption(db, 'project-staging', SEPTEMBER_TO_15, 12.25);
  for (const nic of [LYON, PARIS]) db.cloudDetails.setCurrentConsumptionMonth('2026-09-01', nic);
  storeProjectWithoutAccount(db, 'project-legacy', '2026-08-01');
  storeProjectConsumption(db, 'project-legacy', AUGUST, 40);
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

  test('adds up the latest balance of every account without the parameter', async () => {
    // Lyon's latest, Paris's and the Unknown account's, taken last by Lyon's import
    expect(await ocm.get('/api/account/balance')).toEqual({
      status: 200, body: balance('2026-09-14 04:02:00', 21, 55, 130),
    });
  });

  test("gives the latest balance of the account whose NIC handle it gives", async () => {
    expect(await ocm.get(`/api/account/balance${of(LYON)}`)).toEqual({
      status: 200, body: balance('2026-09-14 04:02:00', 12.5, 50.25, 100),
    });
    expect(await ocm.get(`/api/account/balance${of(PARIS)}`)).toEqual({
      status: 200, body: balance('2026-09-14 04:01:00', 7.5, 0, 30),
    });
  });

  test('gives the balance of the Unknown account: the latest without an account', async () => {
    expect(await ocm.get(`/api/account/balance${of(UNKNOWN_ACCOUNT)}`)).toEqual({
      status: 200, body: balance('2026-06-30 08:00:00', 1, 4.75, 0),
    });
  });

  test('gives no balance for an account whose import recorded none', async () => {
    expect(await ocm.get(`/api/account/balance${of(NEW_ACCOUNT)}`)).toEqual({
      status: 200,
      body: { debt_balance: 0, credit_balance: 0, deposit_total: 0, currency: 'EUR' },
    });
  });
});

describe('GET /api/account/debts', () => {
  test.each([
    ['every account, without the parameter', undefined, 21],
    ['the account whose NIC handle it gives', LYON, 12.5],
    ['the Unknown account', UNKNOWN_ACCOUNT, 1],
    ['an account whose import recorded no balance', NEW_ACCOUNT, 0],
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

  // In the month that the last import before the accounts recorded
  test('gives the consumption of the Unknown account in its own month', async () => {
    expect(await current(of(UNKNOWN_ACCOUNT))).toEqual({
      status: 200,
      body: {
        snapshot_date: expect.stringMatching(ISO_TIME), period_start: '2026-08-01',
        period_end: '2026-08-31', current_total: 40, source: 'cloud_projects',
        project_count: 1, currency: 'EUR',
      },
    });
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

  // 40 € over the 30 days that its import covered, for the 31 days of August
  test('extrapolates the consumption of the Unknown account in its own month', async () => {
    expect(await forecast(of(UNKNOWN_ACCOUNT))).toEqual({
      status: 200,
      body: {
        snapshot_date: expect.stringMatching(ISO_TIME), period_start: '2026-08-01',
        period_end: '2026-08-31', forecast_total: 41.33, current_total: 40, currency: 'EUR',
        progress: 97, source: 'cloud_projects', days_elapsed: 30, days_in_month: 31,
      },
    });
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
    storeProjectConsumption(db, 'project-lyon', SEPTEMBER_TO_15, 70);
    storeProjectConsumption(db, 'project-paris', ['2026-09-01', to], consumed);
    for (const nic of [LYON, PARIS]) db.cloudDetails.setCurrentConsumptionMonth('2026-09-01', nic);
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
