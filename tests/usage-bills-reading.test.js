/**
 * Tests for what the readers make of the usage bills (CONTEXT.md) of an account whose cost source
 * is its Public Cloud usage, as its import stores them against a simulated OVH API: the months
 * list, the month in progress, which is that of the provisional usage bill, and its projection,
 * which spreads each project's month-end forecast (#224) over its lines. Today is 15 October 2026.
 */

const {
  routes, ok, CREDENTIALS, useConfig, useThrowawayImport,
} = require('./support/simulated-ovh');
const { ACCOUNT } = require('./support/accounts');

jest.mock('ovh', () => require('./support/simulated-ovh').ovh);
jest.mock('jsonfile', () => require('./support/simulated-ovh').jsonfile);

const throwaway = useThrowawayImport('ocm-usage-bills-reading-');
let db;
let importer;
beforeAll(() => {
  ({ db, importer } = throwaway);
});

const PROJECT = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6';

// A project's usage of a month: an hourly flavor's, and a database's
const usageOf = (month, { instances, database }) => ({
  id: `RUN2_${month.replace('-', '')}`,
  lastUpdate: `${month}-15T06:00:00.000Z`,
  period: { from: `${month}-01T00:00:00.000Z`, to: `${month}-15T06:00:00.000Z` },
  hourlyUsage: {
    instance: [
      { reference: 'b3-8', region: 'GRA9', quantity: { value: 100 }, totalPrice: instances },
    ],
  },
  resourcesUsage: [{
    type: 'databases',
    totalPrice: database,
    resources: [{
      region: 'GRA', components: [{ name: 'mysql-essential-db1-4', totalPrice: database }],
    }],
  }],
  totalPrice: { value: instances + database, currencyCode: 'EUR' },
});

// The usage of September, billed on 1 October, and that of October so far, billed on 1 November
const SEPTEMBER = usageOf('2026-09', { instances: 8, database: 12 });
const OCTOBER = usageOf('2026-10', { instances: 4, database: 6 });

// Imports the account, whose project used both months
async function importUsage() {
  routes.set('/cloud/project', ok([PROJECT]));
  routes.set(`/cloud/project/${PROJECT}`, ok({ description: 'Project' }));
  routes.set(`/cloud/project/${PROJECT}/usage/history`, ok([SEPTEMBER, OCTOBER]
    .map(({ id, period, lastUpdate }) => ({ id, period, lastUpdate }))));
  for (const usage of [SEPTEMBER, OCTOBER]) {
    routes.set(`/cloud/project/${PROJECT}/usage/history/${usage.id}`, ok(usage));
  }
  const done = importer.runImport({ diff: true });
  await jest.runAllTimersAsync();
  await done;
}

// What OVH forecasts the project to cost in October, as --include-cloud-details stores it
const forecastOctober = (total) => db.cloudDetails.upsertForecast({
  project_id: PROJECT, period_start: '2026-10-01', total_price: total,
});

// The months of the bills of October and November
const FROM = '2026-10-01';
const TO = '2026-11-30';

beforeEach(async () => {
  jest.setSystemTime(new Date('2026-10-15T12:00:00+02:00'));
  useConfig({ ...CREDENTIALS, costSource: 'cloudUsage' });
  await importUsage();
});

describe('the months of an account whose cost source is its Public Cloud usage', () => {
  // As a bill of a Public Cloud project's month would be
  test('are those of its usage bills, the month of today\'s usage in the next month', () => {
    expect(db.bills.getMonths(ACCOUNT.nic)).toEqual(['2026-11', '2026-10']);
  });

  test('have the month of its provisional usage bill in progress', () => {
    expect(db.bills.getMonthInProgress(ACCOUNT.nic)).toBe('2026-11');
    expect(db.bills.getMonthInProgress()).toBe('2026-11');
  });

  test('have none in progress once the month of the usage has ended', async () => {
    jest.setSystemTime(new Date('2026-11-02T12:00:00+01:00'));
    routes.set(`/cloud/project/${PROJECT}/usage/history`, ok([]));
    const done = importer.runImport({ diff: true });
    await jest.runAllTimersAsync();
    await done;

    expect(db.bills.getMonthInProgress(ACCOUNT.nic)).toBeNull();
  });
});

describe('the projection of the month in progress', () => {
  test('adds what the project\'s forecast exceeds its usage by', () => {
    forecastOctober(25);

    expect(db.analysis.monthlyTrend(FROM, TO, ACCOUNT.nic, { projected: true })).toEqual([
      { month: '2026-10', total: 20, projected: 0 },
      { month: '2026-11', total: 25, projected: 15 },
    ]);
  });

  // The forecast is 2.5 times the usage: each line counts 1.5 times its cost more, under its
  // own service type, the usage of September included
  test('spreads it over the project\'s lines, which keep their classification', () => {
    forecastOctober(25);

    const byType = db.analysis.byService(FROM, '2026-11-01', ACCOUNT.nic, { projected: true })
      .map(({ service_type, total, projected }) => [service_type, total, projected]);
    expect(byType).toEqual([['Database', 12 + 6 + 9, 9], ['Compute', 8 + 4 + 6, 6]]);
  });

  test('is none without a forecast of the month, or with one below the usage', () => {
    const november = () => db.analysis.monthlyTrend(FROM, TO, ACCOUNT.nic, { projected: true })
      .find(({ month }) => month === '2026-11');

    expect(november()).toEqual({ month: '2026-11', total: 10, projected: 0 });
    forecastOctober(8);
    expect(november()).toEqual({ month: '2026-11', total: 10, projected: 0 });
  });

  test('is none without the projected option, as before', () => {
    forecastOctober(25);

    expect(db.analysis.monthlyTrend(FROM, TO, ACCOUNT.nic)).toEqual([
      { month: '2026-10', total: 20 }, { month: '2026-11', total: 10 },
    ]);
  });
});
