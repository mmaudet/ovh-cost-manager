/**
 * Tests for the import of the carbon footprint (#147, #150), against a simulated OVH API: the
 * CSV that OVHcloud's carbon calculator generates for the last 24 months, which each import
 * asks for again, downloads from the link of its task, and stores in place of the months it
 * covers.
 */

const {
  ok, routes, files, calls, CREDENTIALS, serveAccount, useConfig, useThrowawayImport,
} = require('./support/simulated-ovh');
const { ACCOUNT, PARIS } = require('./support/accounts');

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
  const total = (...parts) => parts.reduce((sum, part) => sum + part, 0).toFixed(2);
  return [
    type, datacenter, range, name, domain, month, manufacturing,
    electricityLocation, electricityMarket, operationsLocation, operationsMarket,
    total(manufacturing, electricityLocation, operationsLocation),
    total(manufacturing, electricityMarket, operationsMarket),
  ].join(',');
}

// The file of these lines
const fileOf = (...lines) => [HEADER, ...lines].join('\n');

// Serves the carbon calculator on these routes: the generation of a CSV, whose task is done
// when asked, and whose link leads to this file
function serveCarbonCalculator(accountRoutes, file, {
  taskID = 'xx1111-ovh_202409_202608', link = 'https://carbon.example.net/footprint.csv',
} = {}) {
  accountRoutes.set('/me/carbonCalculator/csv', ok({ taskID }));
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
    line({ month: '2026-08', manufacturing: 5.12, electricity: [15.41, 15.06], operations: [6.98, 6.96] }),
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
  });
});

// A footprint line of an account for a month, as an earlier import stored it, whose emissions
// add up to `total` location-based: a third manufacturing, a third electricity, a third
// operations
const storedLine = (month, total) => ({
  month, type: 'BAREMETAL', datacenter: 'GRA', product_range: 'advance gen4', name: 'advance-2',
  server_domain: 'ns1234567.ip-10-0-0.eu', manufacturing: total / 3,
  electricity_location: total / 3, electricity_market: total / 3,
  operations_location: total / 3, operations_market: total / 3,
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
  const done = ok({ taskID: 'task-1', status: 'SUCCESS', link: 'https://carbon.example.net/task-1.csv' });
  let asked = 0;
  routes.set('/me/carbonCalculator/task/task-1', () => {
    asked += 1;
    return asked === 1 ? Promise.resolve({ taskID: 'task-1', status: 'IN_PROGRESS', link: null }) : done();
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
    reorder(line({ month: '2026-08', manufacturing: 1, electricity: [2, 1.5], operations: [3, 2.5] }).split(',')),
  ].join('\r\n'));

  await runImport({ includeCarbon: true });

  expect(db.carbon.getMonthFootprint('2026-08', ACCOUNT.nic)).toEqual({
    manufacturing: 1, electricity: 2, operations: 3, total: 6,
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
