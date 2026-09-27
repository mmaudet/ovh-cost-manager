/**
 * What the routes of the account-wide figures answer for one account (#114): the balance and
 * the credit movements, the consumption and its forecast, and the consumption history. The
 * server runs in a child process over a database of one account as the version before #114
 * left it, which it migrates as it starts. Until these routes follow the account (#116),
 * they answer as that version did.
 */

const { startOcm } = require('./support/ocm-server');
const { asBefore114 } = require('./support/database-before');
const { ACCOUNT, SQLITE_TIME } = require('./support/accounts');

const NIC = ACCOUNT.nic;
const PROJECT = 'proj-1';

// GETs these routes of the server started over a database of the account, whose rows `seed`
// writes as the import does, as the version before #114 left it. The server runs in UTC, as
// the month-end forecast reads the days of the month in the server's time zone.
async function answersOf(seed, routes) {
  const ocm = await startOcm(() => ({ TZ: 'UTC' }), {
    seed: (db) => {
      db.accounts.upsert({ nic: NIC, currency: 'EUR' });
      db.accounts.recordImport(NIC, { status: 'success' });
      seed(db);
      asBefore114(db.getDb());
    },
  });
  try {
    const answers = {};
    for (const route of routes) {
      const res = await fetch(`${ocm.url}${route}`);
      expect(res.status).toBe(200);
      answers[route] = await res.json();
    }
    return answers;
  } finally {
    await ocm.stop();
  }
}

// What a project of the account consumed in a month, up to a day
const storeConsumption = (db, from, to, totalPrice) => db.cloudDetails.insertConsumption({
  project_id: PROJECT, period_start: from, period_end: to, resource_type: 'instance',
  resource_id: 'inst-1', resource_name: 'b2-7', quantity: 100, unit: 'Hour', unit_price: 0,
  total_price: totalPrice, region: 'GRA11',
});

// The project, which consumed 30.5 in August and 12.25 in September up to the 15th
function storeProjectConsumption(db) {
  db.projects.upsert({
    id: PROJECT, name: 'Project 1', description: null, status: 'ok', created_at: null,
    account: NIC,
  });
  storeConsumption(db, '2026-08-01', '2026-08-31', 30.5);
  storeConsumption(db, '2026-09-01', '2026-09-15', 12.25);
}

// A consumption snapshot of the account, without any consumption: the routes then read the
// consumption of the projects
const storeEmptySnapshot = (db, from, to) => db.consumption.insertSnapshot({
  period_start: from, period_end: to, current_total: 0, forecast_total: 0, currency: 'EUR',
  raw_data: '{}', account: NIC,
});

test('the balance routes give the latest balance and every credit movement', async () => {
  const answers = await answersOf((db) => {
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
  }, ['/api/account/balance', '/api/account/debts', '/api/account/credits']);

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
        id: 'VOUCHER_2', balance_name: 'VOUCHER', amount: -20, date: '2026-09-01T10:00:00+02:00',
        description: 'Used on FR2', movement_type: 'USE',
        imported_at: expect.stringMatching(SQLITE_TIME), account: NIC,
      },
      {
        id: 'VOUCHER_1', balance_name: 'VOUCHER', amount: 50, date: '2026-08-01T10:00:00+02:00',
        description: 'Voucher', movement_type: 'VOUCHER',
        imported_at: expect.stringMatching(SQLITE_TIME), account: NIC,
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
  const details = { current: [{ price: { value: 87.5 } }], forecast: [{ price: { value: 192.25 } }] };
  const answers = await answersOf((db) => {
    db.consumption.insertSnapshot({
      period_start: '2026-09-01', period_end: '2026-09-10', current_total: 60,
      forecast_total: 180, currency: 'EUR', raw_data: '{}', account: NIC,
    });
    db.consumption.insertSnapshot({
      period_start: '2026-09-01', period_end: '2026-09-14', current_total: 87.5,
      forecast_total: 192.25, currency: 'EUR', raw_data: JSON.stringify(details), account: NIC,
    });
    db.consumption.insertHistory({
      period_start: '2026-07-01', period_end: '2026-07-31', service_type: 'consumption',
      total: 175.5, currency: 'EUR', raw_data: '{}', account: NIC,
    });
    db.consumption.insertHistory({
      period_start: '2026-08-01', period_end: '2026-08-31', service_type: 'consumption',
      total: 190.25, currency: 'EUR', raw_data: '{}', account: NIC,
    });
  }, ['/api/consumption/current', '/api/consumption/forecast', '/api/consumption/usage-history']);

  expect(answers).toEqual({
    '/api/consumption/current': {
      snapshot_date: expect.stringMatching(SQLITE_TIME),
      period_start: '2026-09-01',
      period_end: '2026-09-14',
      current_total: 87.5,
      currency: 'EUR',
      source: 'me_consumption',
      details,
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
    }, ['/api/consumption/current', '/api/consumption/forecast', '/api/projects/enriched']);

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
      '/api/projects/enriched': [{
        id: PROJECT, name: 'Project 1', description: null, status: 'ok', instance_count: 0,
        consumption_total: 12.25, period_start: '2026-09-01', period_end: '2026-09-15',
      }],
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
    }, ['/api/consumption/current', '/api/consumption/forecast', '/api/projects/enriched']);

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
      '/api/projects/enriched': [{
        id: PROJECT, name: 'Project 1', description: null, status: 'ok', instance_count: 0,
        consumption_total: 0, period_start: null, period_end: null,
      }],
    });
  }, 30000);
