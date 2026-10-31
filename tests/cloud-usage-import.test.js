/**
 * Tests for the import of an account whose cost source is its Public Cloud usage (CONTEXT.md),
 * against a simulated OVH API: each project's usage periods, which usage/history lists, stored
 * on the usage bill of the account's month, without the bills, which a third party issues. A
 * period is fetched again once OVH updated it, and kept once OVH no longer lists it, a full
 * import included. Today is 15 October 2026.
 */

const {
  routes, calls, ok, fail, CREDENTIALS, useConfig, useThrowawayImport,
} = require('./support/simulated-ovh');
const { ACCOUNT } = require('./support/accounts');
const MAY = require('./fixtures/cloud-usage-history.json');

jest.mock('ovh', () => require('./support/simulated-ovh').ovh);
jest.mock('jsonfile', () => require('./support/simulated-ovh').jsonfile);

const throwaway = useThrowawayImport('ocm-cloud-usage-import-');
let db;
let importer;
beforeAll(() => {
  ({ db, importer } = throwaway);
});

// Two Public Cloud projects, whose ids OVH gives as 32 hexadecimal digits
const PROJECT = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6';
const OTHER_PROJECT = 'f6e5d4c3b2a1f6e5d4c3b2a1f6e5d4c3';

// The usage bills of the account's months
const MAY_BILL = `usage-${ACCOUNT.nic}-2026-05`;
const OCTOBER_BILL = `usage-${ACCOUNT.nic}-2026-10`;

// A project's usage of October so far, an hourly flavor's, updated at `lastUpdate`
const october = (total, lastUpdate = '2026-10-15T06:00:00.000Z') => ({
  id: 'RUN2_202610',
  lastUpdate,
  period: { from: '2026-10-01T00:00:00.000Z', to: '2026-10-15T06:00:00.000Z' },
  hourlyUsage: {
    instance: [{ reference: 'b3-8', region: 'GRA9', quantity: { value: 100 }, totalPrice: total }],
  },
  totalPrice: { value: total, currencyCode: 'EUR' },
});

// What usage/history lists of a usage: its id, its period and its last update
const listed = ({ id, period, lastUpdate }) => ({ id, period, lastUpdate });

// Serves the projects, and the usage periods of each, by project
function serveUsage(usages) {
  routes.set('/cloud/project', ok(Object.keys(usages)));
  for (const [project, periods] of Object.entries(usages)) {
    routes.set(`/cloud/project/${project}`, ok({ description: `Project ${project.slice(0, 4)}` }));
    routes.set(`/cloud/project/${project}/usage/history`, ok(periods.map(listed)));
    for (const period of periods) {
      routes.set(`/cloud/project/${project}/usage/history/${period.id}`, ok(period));
    }
  }
}

// An import of the account, whose cost source is its Public Cloud usage, with the options of a
// run. Retry delays run on fake timers, so a retried call costs no real time.
async function importUsage(params = { diff: true }) {
  const done = importer.runImport(params);
  await jest.runAllTimersAsync();
  await done;
}

const storedBills = () => db.getDb().prepare(`
  SELECT id, date, price_without_tax, source, provisional, account FROM bills ORDER BY id
`).all();

const linesOf = (billId) => db.getDb().prepare(`
  SELECT id, project_id, domain, description, total_price, service_type, resource_type
  FROM bill_details WHERE bill_id = ? ORDER BY id
`).all(billId);

// The usage periods whose detail the import fetched, as their routes
const fetchedPeriods = () => calls.map(({ route }) => route)
  .filter(route => /\/usage\/history\/.+/.test(route));

beforeEach(() => {
  jest.setSystemTime(new Date('2026-10-15T12:00:00+02:00'));
  useConfig({ ...CREDENTIALS, costSource: 'cloudUsage' });
});

describe('an account whose cost source is its Public Cloud usage', () => {
  test('gets each month of its projects\' usage on a usage bill, and no bill is fetched',
    async () => {
      serveUsage({ [PROJECT]: [MAY, october(5.1)] });

      await importUsage();

      expect(storedBills()).toEqual([
        { id: MAY_BILL, date: '2026-06-01', price_without_tax: 1826.06, source: 'usage',
          provisional: 0, account: ACCOUNT.nic },
        // The month of today, which the next imports rewrite while it runs
        { id: OCTOBER_BILL, date: '2026-11-01', price_without_tax: 5.1, source: 'usage',
          provisional: 1, account: ACCOUNT.nic },
      ]);
      expect(calls.map(({ route }) => route)).not.toContain('/me/bill');
      // None is an OVH bill, which the bills route and the CSV export of the bills list
      expect(db.bills.getAll()).toEqual([]);
      expect(db.bills.getById(MAY_BILL)).toBeUndefined();
      expect(db.accounts.getAll().map(account => account.last_import_status))
        .toEqual(['success']);
    });

  // As the lines of a project on its bills
  test('gets lines that name their project, classified as its bills\' lines are', async () => {
    serveUsage({ [PROJECT]: [MAY] });

    await importUsage();

    const lines = linesOf(MAY_BILL);
    expect(lines).toHaveLength(28);
    expect(new Set(lines.map(line => [line.project_id, line.domain, line.resource_type].join())))
      .toEqual(new Set([`${PROJECT},${PROJECT},cloud_project`]));
    expect(lines).toEqual(expect.arrayContaining([expect.objectContaining({
      description: 'Public Cloud Databases mysql-essential-db1-4 à sbg',
      total_price: 55.5024,
      service_type: 'Database',
    })]));
  });

  test('adds up the usage of its projects of a month on one usage bill', async () => {
    serveUsage({ [PROJECT]: [october(5.1)], [OTHER_PROJECT]: [october(2)] });

    await importUsage();

    expect(storedBills().map(({ id, price_without_tax }) => [id, price_without_tax]))
      .toEqual([[OCTOBER_BILL, 7.1]]);
    expect(linesOf(OCTOBER_BILL).map(({ project_id, total_price }) => [project_id, total_price]))
      .toEqual(expect.arrayContaining([[PROJECT, 5.1], [OTHER_PROJECT, 2]]));
  });

  test('fetches again only the periods that OVH updated since, their lines replaced',
    async () => {
      serveUsage({ [PROJECT]: [MAY, october(5.1)], [OTHER_PROJECT]: [october(2)] });
      await importUsage();

      serveUsage({
        [PROJECT]: [MAY, october(6.3, '2026-10-15T09:00:00.000Z')],
        [OTHER_PROJECT]: [october(2)],
      });
      calls.length = 0;
      await importUsage();

      expect(fetchedPeriods()).toEqual([`/cloud/project/${PROJECT}/usage/history/RUN2_202610`]);
      expect(storedBills().map(({ id, price_without_tax }) => [id, price_without_tax]))
        .toEqual([[MAY_BILL, 1826.06], [OCTOBER_BILL, 8.3]]);
      // Not added to the lines stored before
      expect(linesOf(OCTOBER_BILL)).toHaveLength(2);
    });

  // OVH gives the usage of the month of today and of the six months before: the older months
  // are the database's alone
  test('keeps a period that OVH no longer lists, a full import included, which fetches the '
    + 'others again', async () => {
    serveUsage({ [PROJECT]: [MAY, october(5.1)] });
    await importUsage();

    serveUsage({ [PROJECT]: [october(5.1)] });
    calls.length = 0;
    await importUsage({ full: true });

    expect(fetchedPeriods()).toEqual([`/cloud/project/${PROJECT}/usage/history/RUN2_202610`]);
    expect(storedBills().map(({ id, price_without_tax }) => [id, price_without_tax]))
      .toEqual([[MAY_BILL, 1826.06], [OCTOBER_BILL, 5.1]]);
    expect(linesOf(MAY_BILL)).toHaveLength(28);
  });

  test('marks the usage bill of a month that has ended no longer provisional', async () => {
    serveUsage({ [PROJECT]: [october(5.1)] });
    await importUsage();

    // OVH has not updated it since
    jest.setSystemTime(new Date('2026-11-02T12:00:00+01:00'));
    calls.length = 0;
    await importUsage();

    expect(fetchedPeriods()).toEqual([]);
    expect(storedBills().map(({ id, provisional }) => [id, provisional]))
      .toEqual([[OCTOBER_BILL, 0]]);
  });

  test('keeps the usage of a project that cannot be fetched, and imports the others',
    async () => {
      serveUsage({ [PROJECT]: [october(5.1)], [OTHER_PROJECT]: [october(2)] });
      await importUsage();

      routes.set(`/cloud/project/${PROJECT}/usage/history`, fail(500, 'Internal server error'));
      routes.set(`/cloud/project/${OTHER_PROJECT}/usage/history`,
        ok([listed(october(3, '2026-10-15T09:00:00.000Z'))]));
      routes.set(`/cloud/project/${OTHER_PROJECT}/usage/history/RUN2_202610`,
        ok(october(3, '2026-10-15T09:00:00.000Z')));
      await importUsage();

      expect(linesOf(OCTOBER_BILL).map(({ project_id, total_price }) => [project_id, total_price]))
        .toEqual(expect.arrayContaining([[PROJECT, 5.1], [OTHER_PROJECT, 3]]));
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining(`Error importing the usage of project ${PROJECT}`),
      );
    });
});

describe('a full import', () => {
  // An OVH bill of the account, which an import stored when its cost source was its bills
  const storeBill = () => db.bills.upsert({
    id: 'FR1', date: '2026-09-01', price_without_tax: 10, price_with_tax: 12, tax: 2,
    currency: 'EUR', pdf_url: null, html_url: null, account: ACCOUNT.nic,
  });

  // Its bills would count its costs a second time
  test('clears the bills of an account whose cost source is its Public Cloud usage', async () => {
    storeBill();
    serveUsage({ [PROJECT]: [october(5.1)] });

    await importUsage({ full: true });

    expect(storedBills().map(({ id }) => id)).toEqual([OCTOBER_BILL]);
  });

  // Its usage bills would count its costs a second time
  test('clears the usage bills of an account whose cost source is its bills again', async () => {
    serveUsage({ [PROJECT]: [october(5.1)] });
    await importUsage();

    useConfig({ ...CREDENTIALS });
    routes.set('/me/bill', ok([]));
    await importUsage({ full: true });

    expect(storedBills()).toEqual([]);
    expect(db.getDb().prepare('SELECT COUNT(*) FROM project_usage_periods').pluck().get())
      .toBe(0);
  });
});
