/**
 * What the routes of the account-wide figures answer for one account (#114): the balance and
 * the credit movements, the consumption and its forecast, and the consumption history. The
 * server runs in a child process over a database of one account as an earlier version left
 * it, which it migrates as it starts: the version before #114, whose rows carry the account,
 * or a version before the accounts (#112), whose rows carry none and are the Unknown
 * account's. Until these routes follow the account (#116), they answer as that version did,
 * but for the account that #121 gives each project.
 */

const { startOcm } = require('./support/ocm-server');
const { asBefore114, asBeforeAccounts } = require('./support/database-before');
const { LYON, SQLITE_TIME, project } = require('./support/accounts');

// The one account
const NIC = LYON;
const PROJECT = 'proj-1';

// GETs these routes of the server started over a database of the account, whose rows `seed`
// writes as the import does, as `before` then leaves it: as the version before #114 did, by
// default. The server runs in UTC, as the month-end forecast reads the days of the month in
// the server's time zone.
async function answersOf(seed, routes, before = asBefore114) {
  const ocm = await startOcm(() => ({ TZ: 'UTC' }), {
    seed: (db) => {
      db.accounts.upsert({ nic: NIC, currency: 'EUR' });
      db.accounts.recordImport(NIC, { status: 'success' });
      seed(db);
      before(db.getDb());
    },
  });
  try {
    const answers = {};
    for (const route of routes) {
      const { status, body } = await ocm.get(route);
      expect(status).toBe(200);
      answers[route] = body;
    }
    return answers;
  } finally {
    await ocm.stop();
  }
}

// What a project of the account consumed in a month, up to a day
const storeConsumption = (db, from, to, totalPrice, projectId = PROJECT) =>
  db.cloudDetails.insertConsumption({
    project_id: projectId, period_start: from, period_end: to, resource_type: 'instance',
    resource_id: 'inst-1', resource_name: 'b2-7', quantity: 100, unit: 'Hour', unit_price: 0,
    total_price: totalPrice, region: 'GRA11',
  });

// The project, which consumed 30.5 in August and 12.25 in September up to the 15th
function storeProjectConsumption(db) {
  project(db, PROJECT, 'Project 1', NIC);
  storeConsumption(db, '2026-08-01', '2026-08-31', 30.5);
  storeConsumption(db, '2026-09-01', '2026-09-15', 12.25);
}

// A consumption snapshot of the account, without any consumption: the routes then read the
// consumption of the projects
const storeEmptySnapshot = (db, from, to) => db.consumption.insertSnapshot({
  period_start: from, period_end: to, current_total: 0, forecast_total: 0, currency: 'EUR',
  raw_data: '{}', account: NIC,
});

// A month of the account's consumption history, as its import stores each entry that OVH
// gives
const storeHistory = (db, from, to, serviceType, total) => db.consumption.insertHistory({
  period_start: from, period_end: to, service_type: serviceType, total, currency: 'EUR',
  raw_data: '{}', account: NIC,
});

// Two balances of the account, the latest last, and two movements of its credit
function storeBalances(db) {
  db.balance.insertBalance({
    debt_balance: 5, credit_balance: 20, deposit_total: 0, currency: 'EUR', account: NIC,
  });
  db.balance.insertBalance({
    debt_balance: 12.5, credit_balance: 50.25, deposit_total: 100, currency: 'EUR',
    account: NIC,
  });
  db.balance.insertCreditMovement({
    id: 'VOUCHER_1', balance_name: 'VOUCHER', amount: 50, date: '2026-08-01T10:00:00+02:00',
    description: 'Voucher', movement_type: 'VOUCHER', account: NIC,
  });
  db.balance.insertCreditMovement({
    id: 'VOUCHER_2', balance_name: 'VOUCHER', amount: -20, date: '2026-09-01T10:00:00+02:00',
    description: 'Used on FR2', movement_type: 'USE', account: NIC,
  });
}
const BALANCE_ROUTES = ['/api/account/balance', '/api/account/debts', '/api/account/credits'];

// The details of the latest consumption snapshot, as OVH gives them
const DETAILS = { current: [{ price: { value: 87.5 } }], forecast: [{ price: { value: 192.25 } }] };

// Two consumption snapshots of the account, the latest last, and its history of July and
// August
function storeSnapshotsAndHistory(db) {
  db.consumption.insertSnapshot({
    period_start: '2026-09-01', period_end: '2026-09-10', current_total: 60,
    forecast_total: 180, currency: 'EUR', raw_data: '{}', account: NIC,
  });
  db.consumption.insertSnapshot({
    period_start: '2026-09-01', period_end: '2026-09-14', current_total: 87.5,
    forecast_total: 192.25, currency: 'EUR', raw_data: JSON.stringify(DETAILS), account: NIC,
  });
  storeHistory(db, '2026-07-01', '2026-07-31', 'consumption', 175.5);
  storeHistory(db, '2026-08-01', '2026-08-31', 'consumption', 190.25);
}
const CONSUMPTION_ROUTES = [
  '/api/consumption/current', '/api/consumption/forecast', '/api/consumption/usage-history',
];

// What the cloud consumption routes list of the project, which names its account since #121
const enrichedProject = (account, consumed, from, to) => ({
  id: PROJECT, name: 'Project 1', description: 'Project 1', status: 'ok', account,
  instance_count: 0, consumption_total: consumed, period_start: from, period_end: to,
});

// Whose rows carry the account, or, from before the accounts, none: the Unknown account's,
// which the routes answer for as they do for one account
describe.each([
  ['as the version before #114 left it', asBefore114, NIC],
  ['as a version before the accounts left it', asBeforeAccounts, null],
])('a database of one account %s', (_, before, account) => {
  test('the balance routes give the latest balance and every credit movement', async () => {
    const answers = await answersOf(storeBalances, BALANCE_ROUTES, before);

    expect(answers).toEqual({
      '/api/account/balance': {
        snapshot_date: expect.stringMatching(SQLITE_TIME),
        debt_balance: 12.5,
        credit_balance: 50.25,
        deposit_total: 100,
        net_balance: 37.75,
        currency: 'EUR',
      },
      '/api/account/debts': { debt_balance: 12.5, currency: 'EUR' },
      '/api/account/credits': [
        {
          id: 'VOUCHER_2', balance_name: 'VOUCHER', amount: -20,
          date: '2026-09-01T10:00:00+02:00', description: 'Used on FR2', movement_type: 'USE',
          imported_at: expect.stringMatching(SQLITE_TIME), account,
        },
        {
          id: 'VOUCHER_1', balance_name: 'VOUCHER', amount: 50,
          date: '2026-08-01T10:00:00+02:00', description: 'Voucher', movement_type: 'VOUCHER',
          imported_at: expect.stringMatching(SQLITE_TIME), account,
        },
      ],
    });
    // The movements are the rows of their table as they are: their fields in the same order
    expect(Object.keys(answers['/api/account/credits'][0])).toEqual([
      'id', 'balance_name', 'amount', 'date', 'description', 'movement_type', 'imported_at',
      'account',
    ]);
  }, 30000);

  test('the consumption routes give the latest snapshot and the history', async () => {
    const answers = await answersOf(storeSnapshotsAndHistory, CONSUMPTION_ROUTES, before);

    expect(answers).toEqual({
      '/api/consumption/current': {
        snapshot_date: expect.stringMatching(SQLITE_TIME),
        period_start: '2026-09-01',
        period_end: '2026-09-14',
        current_total: 87.5,
        currency: 'EUR',
        source: 'me_consumption',
        details: DETAILS,
      },
      '/api/consumption/forecast': {
        snapshot_date: expect.stringMatching(SQLITE_TIME),
        period_start: '2026-09-01',
        period_end: '2026-09-14',
        forecast_total: 192.25,
        current_total: 87.5,
        currency: 'EUR',
        progress: 46,
      },
      '/api/consumption/usage-history': [
        {
          period_start: '2026-08-01', period_end: '2026-08-31', total: 190.25, currency: 'EUR',
          service_type: 'consumption',
        },
        {
          period_start: '2026-07-01', period_end: '2026-07-31', total: 175.5, currency: 'EUR',
          service_type: 'consumption',
        },
      ],
    });
  }, 30000);

  // The month that the last import of the consumption covered decides which month is current
  test('the consumption and forecast routes read the projects of the month last imported',
    async () => {
      const answers = await answersOf((db) => {
        storeProjectConsumption(db);
        db.cloudDetails.setCurrentConsumptionMonth('2026-09-01', NIC);
        storeEmptySnapshot(db, '2026-09-01', '2026-09-15');
      }, ['/api/consumption/current', '/api/consumption/forecast', '/api/projects/enriched'],
      before);

      expect(answers).toEqual({
        '/api/consumption/current': {
          snapshot_date: expect.stringMatching(SQLITE_TIME),
          period_start: '2026-09-01',
          period_end: '2026-09-15',
          current_total: 12.25,
          source: 'cloud_projects',
          project_count: 1,
          currency: 'EUR',
        },
        '/api/consumption/forecast': {
          snapshot_date: expect.any(String),
          period_start: '2026-09-01',
          period_end: '2026-09-15',
          forecast_total: 26.25,
          current_total: 12.25,
          currency: 'EUR',
          progress: 47,
          source: 'cloud_projects',
          days_elapsed: 14,
          days_in_month: 30,
        },
        // Each project names its account since #121
        '/api/projects/enriched': [
          enrichedProject(account, 12.25, '2026-09-01', '2026-09-15'),
        ],
      });
    }, 30000);

  // On 1 October, OVH reports October without any usage yet: the current consumption is none,
  // not September's, which is the latest stored
  test('the consumption routes read a month last imported that has no consumption yet',
    async () => {
      const answers = await answersOf((db) => {
        storeProjectConsumption(db);
        db.cloudDetails.setCurrentConsumptionMonth('2026-10-01', NIC);
        storeEmptySnapshot(db, '2026-10-01', '2026-10-01');
      }, ['/api/consumption/current', '/api/consumption/forecast', '/api/projects/enriched'],
      before);

      expect(answers).toEqual({
        '/api/consumption/current': {
          snapshot_date: expect.stringMatching(SQLITE_TIME),
          period_start: '2026-10-01',
          period_end: '2026-10-01',
          current_total: 0,
          currency: 'EUR',
          source: 'me_consumption',
          details: {},
        },
        '/api/consumption/forecast': {
          snapshot_date: expect.stringMatching(SQLITE_TIME),
          period_start: '2026-10-01',
          period_end: '2026-10-01',
          forecast_total: 0,
          current_total: 0,
          currency: 'EUR',
          progress: 0,
        },
        '/api/projects/enriched': [enrichedProject(account, 0, null, null)],
      });
    }, 30000);

  // Two projects whose usage OVH reports up to different days: the account's consumption
  // runs from the earliest start to the latest end
  test('the forecast extrapolates the projects over the days that they cover together',
    async () => {
      const answers = await answersOf((db) => {
        storeProjectConsumption(db);
        project(db, 'proj-2', 'Project 2', NIC);
        storeConsumption(db, '2026-09-01', '2026-09-12', 7.75, 'proj-2');
        db.cloudDetails.setCurrentConsumptionMonth('2026-09-01', NIC);
      }, ['/api/consumption/current', '/api/consumption/forecast'], before);

      expect(answers).toEqual({
        '/api/consumption/current': {
          snapshot_date: expect.any(String),
          period_start: '2026-09-01',
          period_end: '2026-09-15',
          current_total: 20,
          source: 'cloud_projects',
          project_count: 2,
          currency: 'EUR',
        },
        // 20 € over 14 days, for the 30 days of September
        '/api/consumption/forecast': {
          snapshot_date: expect.any(String),
          period_start: '2026-09-01',
          period_end: '2026-09-15',
          forecast_total: 42.86,
          current_total: 20,
          currency: 'EUR',
          progress: 47,
          source: 'cloud_projects',
          days_elapsed: 14,
          days_in_month: 30,
        },
      });
    }, 30000);

  // OVH forecasts the month, but reports no consumption yet: the consumption is that of the
  // projects, and the forecast OVH's
  test('the consumption reads the projects, and the forecast the snapshot that has one',
    async () => {
      const answers = await answersOf((db) => {
        storeProjectConsumption(db);
        db.cloudDetails.setCurrentConsumptionMonth('2026-09-01', NIC);
        db.consumption.insertSnapshot({
          period_start: '2026-09-01', period_end: '2026-09-15', current_total: 0,
          forecast_total: 150, currency: 'EUR', raw_data: '{}', account: NIC,
        });
      }, ['/api/consumption/current', '/api/consumption/forecast'], before);

      expect(answers).toEqual({
        '/api/consumption/current': {
          snapshot_date: expect.stringMatching(SQLITE_TIME),
          period_start: '2026-09-01',
          period_end: '2026-09-15',
          current_total: 12.25,
          source: 'cloud_projects',
          project_count: 1,
          currency: 'EUR',
        },
        '/api/consumption/forecast': {
          snapshot_date: expect.stringMatching(SQLITE_TIME),
          period_start: '2026-09-01',
          period_end: '2026-09-15',
          forecast_total: 150,
          current_total: 0,
          currency: 'EUR',
          progress: 0,
        },
      });
    }, 30000);

  // OVH may give an account several entries for one period: each is listed, the latest
  // stored first, and a period that ends earlier after those that end later
  test('the consumption history lists each entry that OVH gives for a period', async () => {
    const answers = await answersOf((db) => {
      storeHistory(db, '2026-07-01', '2026-07-31', 'consumption', 175.5);
      storeHistory(db, '2026-08-01', '2026-08-31', 'instance', 150);
      storeHistory(db, '2026-08-01', '2026-08-14', 'storage', 12.5);
      storeHistory(db, '2026-08-01', '2026-08-31', 'storage', 40.25);
    }, ['/api/consumption/usage-history'], before);

    const entry = (from, to, serviceType, total) => ({
      period_start: from, period_end: to, total, currency: 'EUR', service_type: serviceType,
    });
    expect(answers['/api/consumption/usage-history']).toEqual([
      entry('2026-08-01', '2026-08-31', 'storage', 40.25),
      entry('2026-08-01', '2026-08-31', 'instance', 150),
      entry('2026-08-01', '2026-08-14', 'storage', 12.5),
      entry('2026-07-01', '2026-07-31', 'consumption', 175.5),
    ]);
  }, 30000);
});
