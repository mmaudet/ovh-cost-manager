/**
 * Tests for the import of the carbon footprint (#147, #150), against a simulated OVH API: the
 * CSV that OVHcloud's carbon calculator generates for the last 24 months, which each import
 * asks for again, downloads from the link of its task, and stores in place of the months it
 * covers; and what the import does when it cannot (#151).
 */

const {
  ok, accepted, fail, routes, files, calls, CREDENTIALS, serveAccount, useConfig,
  useThrowawayImport,
} = require('./support/simulated-ovh');
const { ACCOUNT, PARIS } = require('./support/accounts');
const { footprintLine } = require('./support/carbon');

jest.mock('ovh', () => require('./support/simulated-ovh').ovh);
jest.mock('jsonfile', () => require('./support/simulated-ovh').jsonfile);

const throwaway = useThrowawayImport('ocm-carbon-import-');
let db;
let importer;
beforeAll(() => {
  ({ db, importer } = throwaway);
});

beforeEach(() => {
  // The day the imports run on: their last full month is August 2026
  jest.setSystemTime(new Date('2026-09-15T10:00:00Z'));
  // The progress of the bills
  jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
  // No Public Cloud project, and no bill
  routes.set('/cloud/project', ok([]));
  routes.set('/me/bill', ok([]));
});

// The header of the file that the carbon calculator generates, as OVHcloud wrote it in
// September 2026
const HEADER = [
  'type', 'datacenter', 'range', 'name', 'server_domain', 'date',
  'manufacturing_emissions_kg_co2eq',
  'location_based_electricity_emissions_kg_co2eq', 'market_based_electricity_emissions_kg_co2eq',
  'location_based_operational_emissions_kg_co2eq', 'market_based_operational_emissions_kg_co2eq',
  'total_location_based_kg_co2eq', 'total_market_based_kg_co2eq',
].join(',');

// A line of the file, for a month: a dedicated server by default, or an instance flavor or a
// volume type in a datacenter, with its emissions in kg CO2eq: manufacturing, then electricity
// and operations, each location-based and market-based, and the totals, their sums
function line({
  type = 'BAREMETAL', datacenter = 'GRA', range = 'advance gen4', name = 'advance-2',
  domain = 'ns1234567.ip-10-0-0.eu', month, manufacturing, electricity, operations,
}) {
  const [electricityLocation, electricityMarket] = electricity;
  const [operationsLocation, operationsMarket] = operations;
  // Blank when a part is not a number, as for a line that gives no figure
  const total = (...parts) => (parts.every(part => typeof part === 'number')
    ? parts.reduce((sum, part) => sum + part, 0).toFixed(2)
    : '');
  return [
    type, datacenter, range, name, domain, month, manufacturing,
    electricityLocation, electricityMarket, operationsLocation, operationsMarket,
    total(manufacturing, electricityLocation, operationsLocation),
    total(manufacturing, electricityMarket, operationsMarket),
  ].join(',');
}

// The file of these lines
const fileOf = (...lines) => [HEADER, ...lines].join('\n');

// Serves the carbon calculator on these routes: the generation of a CSV, which it accepts with
// 202 Accepted, as OVHcloud does (#179), or with the answer given, whose task is done when
// asked, and whose link leads to this file
function serveCarbonCalculator(accountRoutes, file, {
  taskID = 'xx1111-ovh_202409_202608', link = 'https://carbon.example.net/footprint.csv',
  answer = accepted,
} = {}) {
  accountRoutes.set('/me/carbonCalculator/csv', answer({ taskID }));
  accountRoutes.set(`/me/carbonCalculator/task/${taskID}`, ok({ taskID, status: 'SUCCESS', link }));
  files.set(link, file);
}

// Runs an import as import.js runs it with these options, over September. The polling of the
// task and the retry delays run on fake timers, so they cost no real time.
async function runImport(options) {
  const done = importer.runImport({ from: '2026-09-01', to: '2026-09-30', ...options });
  await jest.runAllTimersAsync();
  await done;
}

// The calls to the carbon calculator, as [method, route, parameters]
const carbonCalls = () => calls
  .filter(call => call.route.startsWith('/me/carbonCalculator'))
  .map(call => [call.method, call.route, call.params]);

test('imports the carbon footprint of the last 24 months with --include-carbon', async () => {
  serveCarbonCalculator(routes, fileOf(
    line({
      month: '2026-08', manufacturing: 5.12, electricity: [15.41, 15.06], operations: [6.98, 6.96],
    }),
    line({
      type: 'PCI-COMPUTE', range: 'b2', name: 'b2-7.monthly', domain: '', month: '2026-08',
      manufacturing: 2.97, electricity: [2.22, 1.42], operations: [2.28, 2.27],
    }),
    // A dedicated server that the file does not name, as OVHcloud gave them before July 2026
    line({
      range: 'ADV-IV', name: '', domain: '', month: '2026-08',
      manufacturing: 10.24, electricity: [75.42, 5.48], operations: [6.98, 6.96],
    }),
  ));

  await runImport({ includeCarbon: true });

  // The 24 months that end with August 2026, the last full month
  expect(carbonCalls()[0]).toEqual([
    'POST', '/me/carbonCalculator/csv', { startMonth: '2024-09-01', endMonth: '2026-08-01' },
  ]);
  expect(db.carbon.getMonthFootprint('2026-08', ACCOUNT.nic)).toEqual({
    manufacturing: 18.33, electricity: 93.05, operations: 16.24, total: 127.62,
    marketBasedTotal: 56.48,
  });
});

// OVHcloud accepts the request of the file with 202 (#179): a calculator that answers 200
// works as well
test('imports the carbon footprint when the calculator answers the request with 200', async () => {
  serveCarbonCalculator(routes, fileOf(line({
    month: '2026-08', manufacturing: 5.12, electricity: [15.41, 15.06], operations: [6.98, 6.96],
  })), { answer: ok });

  await runImport({ includeCarbon: true });

  expect(db.carbon.getMonthFootprint('2026-08', ACCOUNT.nic)).toMatchObject({ total: 27.51 });
});

// A footprint line of an account for a month, as an earlier import stored it, whose emissions
// add up to `total` location-based: a third manufacturing, a third electricity, a third
// operations
const storedLine = (month, total) => footprintLine({
  month, manufacturing: total / 3, electricity: [total / 3, total / 3],
  operations: [total / 3, total / 3],
});

// Stores these lines for the account, as an earlier import did
const storeFootprint = (nic, ...lines) => db.carbon.replaceMonths(nic,
  { first: '2020-01', last: '2030-12' }, lines);

// The total footprint of each month of the account, location-based, null for a month without
const totalsOf = (nic, ...months) => months.map(month =>
  [month, db.carbon.getMonthFootprint(month, nic)?.total ?? null]);

test('replaces the 24 months it imports, and keeps the older months', async () => {
  storeFootprint(ACCOUNT.nic,
    // Older than the 24 months that the calculator gives now
    storedLine('2024-08', 30),
    // Among them: one that the file gives again, one that it no longer gives
    storedLine('2025-01', 60), storedLine('2026-07', 90));
  serveCarbonCalculator(routes, fileOf(
    line({ month: '2026-07', manufacturing: 1, electricity: [2, 1.5], operations: [3, 2.5] }),
  ));

  await runImport({ includeCarbon: true });

  expect(totalsOf(ACCOUNT.nic, '2024-08', '2025-01', '2026-07')).toEqual([
    ['2024-08', 30], ['2025-01', null], ['2026-07', 6],
  ]);
});

test('a full import keeps the months older than those it imports', async () => {
  storeFootprint(ACCOUNT.nic, storedLine('2024-08', 30), storedLine('2026-07', 90));
  serveCarbonCalculator(routes, fileOf(
    line({ month: '2026-07', manufacturing: 1, electricity: [2, 1.5], operations: [3, 2.5] }),
  ));

  await runImport({ full: true, from: null, to: null, includeCarbon: true });

  expect(totalsOf(ACCOUNT.nic, '2024-08', '2026-07')).toEqual([['2024-08', 30], ['2026-07', 6]]);
});

test('imports no carbon footprint without --include-carbon', async () => {
  serveCarbonCalculator(routes, fileOf(
    line({ month: '2026-08', manufacturing: 1, electricity: [2, 1.5], operations: [3, 2.5] }),
  ));

  await runImport({ includeConsumption: false });

  expect(carbonCalls()).toEqual([]);
  expect(db.carbon.getMonthFootprint('2026-08')).toBeNull();
});

test('--include-carbon and --all import the carbon footprint', () => {
  expect(importer.parseArgs(['--diff', '--include-carbon'])).toMatchObject({
    includeCarbon: true, includeConsumption: false,
  });
  expect(importer.parseArgs(['--diff', '--all'])).toMatchObject({ includeCarbon: true });
  expect(importer.parseArgs(['--diff'])).toMatchObject({ includeCarbon: false });
});

test('waits for the task until the carbon calculator has generated the file', async () => {
  serveCarbonCalculator(routes, fileOf(
    line({ month: '2026-08', manufacturing: 1, electricity: [2, 1.5], operations: [3, 2.5] }),
  ), { taskID: 'task-1', link: 'https://carbon.example.net/task-1.csv' });
  // In progress when first asked
  const link = 'https://carbon.example.net/task-1.csv';
  const inProgress = ok({ taskID: 'task-1', status: 'IN_PROGRESS', link: null });
  const done = ok({ taskID: 'task-1', status: 'SUCCESS', link });
  let asked = 0;
  routes.set('/me/carbonCalculator/task/task-1', () => {
    asked += 1;
    return asked === 1 ? inProgress() : done();
  });

  await runImport({ includeCarbon: true });

  expect(asked).toBe(2);
  expect(totalsOf(ACCOUNT.nic, '2026-08')).toEqual([['2026-08', 6]]);
});

test('reads the columns of the file by their names, and ignores the others', async () => {
  // The columns in another order, and one that OCM does not know
  const columns = HEADER.split(',');
  const reordered = [...columns.slice(6), 'water_liters', ...columns.slice(0, 6)];
  const reorder = (fields) => [...fields.slice(6), '12.5', ...fields.slice(0, 6)].join(',');
  serveCarbonCalculator(routes, [
    reordered.join(','),
    reorder(line({
      month: '2026-08', manufacturing: 1, electricity: [2, 1.5], operations: [3, 2.5],
    }).split(',')),
  ].join('\r\n'));

  await runImport({ includeCarbon: true });

  expect(db.carbon.getMonthFootprint('2026-08', ACCOUNT.nic)).toEqual({
    manufacturing: 1, electricity: 2, operations: 3, total: 6, marketBasedTotal: 5,
  });
});

describe('several accounts', () => {
  let paris;
  beforeEach(() => {
    // Paris besides the account of the tests, each with its own key
    paris = serveAccount({ nic: PARIS, currency: 'EUR' });
    paris.routes.set('/cloud/project', ok([]));
    paris.routes.set('/me/bill', ok([]));
    useConfig({ accounts: [
      { credentials: { ...CREDENTIALS, endpoint: 'ovh-eu' } },
      { credentials: paris.credentials },
    ] });
    serveCarbonCalculator(routes, fileOf(
      line({ month: '2026-08', manufacturing: 1, electricity: [2, 1.5], operations: [3, 2.5] }),
    ), { taskID: 'lyon', link: 'https://carbon.example.net/lyon.csv' });
    serveCarbonCalculator(paris.routes, fileOf(
      line({ month: '2026-08', manufacturing: 2, electricity: [4, 3], operations: [6, 5] }),
    ), { taskID: 'paris', link: 'https://carbon.example.net/paris.csv' });
  });

  test("imports each account's carbon footprint with that account's key", async () => {
    await runImport({ includeCarbon: true });

    expect(totalsOf(ACCOUNT.nic, '2026-08')).toEqual([['2026-08', 6]]);
    expect(totalsOf(PARIS, '2026-08')).toEqual([['2026-08', 12]]);
    // All accounts
    expect(totalsOf(null, '2026-08')).toEqual([['2026-08', 18]]);
  });

  test('--account imports the carbon footprint of that account only', async () => {
    await runImport({ includeCarbon: true, account: PARIS });

    expect(totalsOf(ACCOUNT.nic, '2026-08')).toEqual([['2026-08', null]]);
    expect(totalsOf(PARIS, '2026-08')).toEqual([['2026-08', 12]]);
  });
});

// When the carbon footprint cannot be imported (#151): the import says why, replaces nothing
// and carries on, the run's status unchanged
describe('failures', () => {
  // The account's footprint that an earlier import stored, which a failure leaves as it is
  const EARLIER = [storedLine('2026-07', 90)];

  // A bill of September, which the rest of the import imports all the same
  function serveABill() {
    routes.set('/me/bill', ok(['FR1']));
    routes.set('/me/bill/FR1', ok({
      billId: 'FR1', date: '2026-09-03T00:00:00+02:00',
      priceWithoutTax: { value: 10, currencyCode: 'EUR' },
      priceWithTax: { value: 12, currencyCode: 'EUR' }, tax: { value: 2, currencyCode: 'EUR' },
    }));
    routes.set('/me/bill/FR1/details', ok(['D1']));
    routes.set('/me/bill/FR1/details/D1', ok({
      domain: 'example.com', description: 'Nom de domaine example.com', quantity: '1',
      unitPrice: { value: 10, currencyCode: 'EUR' },
      totalPrice: { value: 10, currencyCode: 'EUR' },
    }));
  }

  beforeEach(() => {
    storeFootprint(ACCOUNT.nic, ...EARLIER);
    serveABill();
  });

  // What the run left: its status, its failed items as its summary counts them, whether it
  // imported the bill, and the account's footprint of July
  const outcome = () => ({
    status: db.importLog.getLatest().status,
    failedItems: console.log.mock.calls.map(([text]) => text)
      .filter(text => /^Failed items/.test(text)),
    billImported: db.bills.exists('FR1'),
    july: totalsOf(ACCOUNT.nic, '2026-07'),
  });
  // The lines that the import wrote about the carbon footprint, on its error output, and as
  // warnings
  const linesAboutCarbon = (output) => output.mock.calls.map(([text]) => String(text))
    .filter(text => /carbon/i.test(text));

  // The key of the account of the tests lacks the right to ask for the file
  const refuseTheRequest = (accountRoutes = routes) => accountRoutes.set(
    '/me/carbonCalculator/csv', fail(403, 'This call has not been granted'),
  );

  // A task that stays in progress, however long the import waits
  function serveSlowTask() {
    serveCarbonCalculator(routes, fileOf(), { taskID: 'slow' });
    routes.set('/me/carbonCalculator/task/slow',
      ok({ taskID: 'slow', status: 'IN_PROGRESS', link: null }));
  }

  test('a key without the right: one line names it, and the rest is imported', async () => {
    refuseTheRequest();

    await runImport({ includeCarbon: true });

    expect(outcome()).toEqual({
      status: 'success', failedItems: ['Failed items: 0'], billImported: true,
      july: [['2026-07', 90]],
    });
    expect(linesAboutCarbon(console.warn)).toEqual([
      expect.stringContaining('lacks the right POST /me/carbonCalculator/csv'),
    ]);
    expect(linesAboutCarbon(console.error)).toEqual([]);
  });

  test('a key without the right: the next account imports its footprint', async () => {
    const paris = serveAccount({ nic: PARIS, currency: 'EUR' });
    paris.routes.set('/cloud/project', ok([]));
    paris.routes.set('/me/bill', ok([]));
    useConfig({ accounts: [
      { credentials: { ...CREDENTIALS, endpoint: 'ovh-eu' } },
      { credentials: paris.credentials },
    ] });
    refuseTheRequest();
    serveCarbonCalculator(paris.routes, fileOf(
      line({ month: '2026-08', manufacturing: 2, electricity: [4, 3], operations: [6, 5] }),
    ), { taskID: 'paris', link: 'https://carbon.example.net/paris.csv' });

    await runImport({ includeCarbon: true });

    expect(db.importLog.getLatest().status).toBe('success');
    expect(totalsOf(ACCOUNT.nic, '2026-07', '2026-08'))
      .toEqual([['2026-07', 90], ['2026-08', null]]);
    expect(totalsOf(PARIS, '2026-08')).toEqual([['2026-08', 12]]);
  });

  // Each failure that the carbon calculator or its file can cause
  test.each([
    ['a task that ends in error', () => {
      serveCarbonCalculator(routes, fileOf(), { taskID: 'failed' });
      routes.set('/me/carbonCalculator/task/failed',
        ok({ taskID: 'failed', status: 'ERROR', link: null }));
    }],
    ['a task still in progress after 2 minutes', serveSlowTask],
    ['a download that fails', () => {
      serveCarbonCalculator(routes, fileOf(), { link: 'https://carbon.example.net/expired.csv' });
      files.delete('https://carbon.example.net/expired.csv');
    }],
    ['a file without a column that OCM reads', () => {
      serveCarbonCalculator(routes, fileOf(
        line({ month: '2026-07', manufacturing: 1, electricity: [2, 1.5], operations: [3, 2.5] }),
      ).replace('server_domain', 'domain'));
    }],
    ['a file with a line that gives no figure', () => {
      serveCarbonCalculator(routes, fileOf(
        line({
          month: '2026-07', manufacturing: 'n/a', electricity: [2, 1.5], operations: [3, 2.5],
        }),
      ));
    }],
  ])('%s: it is logged and counted, and replaces nothing', async (failure, serve) => {
    serve();

    await runImport({ includeCarbon: true });

    expect(outcome()).toEqual({
      status: 'success', failedItems: ['Failed items: 1'], billImported: true,
      july: [['2026-07', 90]],
    });
    expect(linesAboutCarbon(console.error)).toHaveLength(1);
  });

  test('a task still in progress: it asks every 3 seconds, for 2 minutes', async () => {
    serveSlowTask();

    await runImport({ includeCarbon: true });

    expect(carbonCalls().filter(([method]) => method === 'GET')).toHaveLength(40);
  });
});
