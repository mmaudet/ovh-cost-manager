/**
 * Tests for the items that an import fails to fetch, against a simulated OVH
 * API: each one is skipped, its log line says why, and the summary counts it.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

// Simulated OVH API: route -> handler returning a promise. Unknown routes
// answer 404, like the real API does.
const mockRoutes = new Map();
jest.mock('ovh', () => () => ({
  requestPromised: (method, route) => {
    const handler = mockRoutes.get(route);
    return handler ? handler() : Promise.reject({ error: 404, message: `Not found: ${route}` });
  }
}));

// Never read the real credentials of the machine running the tests
jest.mock('jsonfile', () => ({
  readFileSync: () => ({ appKey: 'test', appSecret: 'test', consumerKey: 'test' })
}));

const ok = (value) => () => Promise.resolve(value);
const fail = (error, message) => () => Promise.reject({ error, message });

let db;
let importer;
let dataDir;
const previousDataDir = process.env.DATA_DIR;

// One bill of September with two lines, and no Public Cloud project
function serveBill() {
  mockRoutes.clear();
  mockRoutes.set('/cloud/project', ok([]));
  mockRoutes.set('/me/bill', ok(['FR1']));
  mockRoutes.set('/me/bill/FR1', ok({
    billId: 'FR1',
    date: '2026-09-01T00:00:00+02:00',
    priceWithoutTax: { value: 20, currencyCode: 'EUR' },
    priceWithTax: { value: 24, currencyCode: 'EUR' },
    tax: { value: 4, currencyCode: 'EUR' },
  }));
  mockRoutes.set('/me/bill/FR1/details', ok(['D1', 'D2']));
  for (const id of ['D1', 'D2']) {
    mockRoutes.set(`/me/bill/FR1/details/${id}`, ok({
      domain: 'example.com',
      description: 'Nom de domaine example.com',
      quantity: '1',
      unitPrice: { value: 10, currencyCode: 'EUR' },
      totalPrice: { value: 10, currencyCode: 'EUR' },
    }));
  }
}

// A period import of September, as `import.js --from 2026-09-01 --to 2026-09-30` runs it.
// Retry delays run on fake timers, so a rate-limited call costs no real time.
async function importSeptember() {
  const done = importer.runImport({ from: '2026-09-01', to: '2026-09-30' });
  await jest.runAllTimersAsync();
  await done;
}

// The summary that ends the import: its last five lines
const summary = () => console.log.mock.calls.slice(-5).map(([line]) => line);

beforeAll(() => {
  // data/db.js reads DATA_DIR once, when it is first required
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ocm-import-failures-'));
  process.env.DATA_DIR = dataDir;
  db = require('../data/db');
  importer = require('../data/import');
});

afterAll(() => {
  db.closeDb();
  fs.rmSync(dataDir, { recursive: true, force: true });
  if (previousDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = previousDataDir;
});

beforeEach(() => {
  jest.useFakeTimers();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  // The progress of the bills
  jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
  db.clearAll();
  serveBill();
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('an item that the import fails to fetch', () => {
  test('is logged with the status and the message of the OVH error', async () => {
    mockRoutes.set('/me/bill/FR1/details/D2',
      fail(404, 'The requested object (billDetailId = D2) does not exist'));

    await importSeptember();

    expect(console.error).toHaveBeenCalledWith('  [batch] Error processing item "D2": '
      + '404 The requested object (billDetailId = D2) does not exist');
  });

  // The ovh client leaves the message out when OVH's answer has none, and puts a string in
  // place of the status when the answer is not JSON. Other code throws an Error, or a string.
  test.each([
    ['a status without a message', { error: 403, message: null }, '403'],
    ['a string in place of the status', { error: '[OVH] Unable to parse JSON reponse' },
      '[OVH] Unable to parse JSON reponse'],
    ['an Error', Object.assign(new Error('Forbidden'), { statusCode: 403 }), '403 Forbidden'],
    ['a string', 'Unable to reach the API', 'Unable to reach the API'],
    ['an object without a status or a message', { code: 'ECONNRESET' }, "{ code: 'ECONNRESET' }"],
  ])('is logged with a readable reason when the error is %s', async (_, error, reason) => {
    mockRoutes.set('/me/bill/FR1/details/D2', () => Promise.reject(error));

    await importSeptember();

    expect(console.error)
      .toHaveBeenCalledWith(`  [batch] Error processing item "D2": ${reason}`);
  });

  test('is skipped, and the rest of its bill stored', async () => {
    mockRoutes.set('/me/bill/FR1/details/D2', fail(404, 'The requested object does not exist'));

    await importSeptember();

    expect(db.bills.exists('FR1')).toBe(true);
    expect(db.details.getByBillId('FR1').map(d => d.id)).toEqual(['FR1_D1']);
  });

  test('is counted in the summary at the end of the import', async () => {
    mockRoutes.set('/me/bill/FR1/details/D2', fail(404, 'The requested object does not exist'));

    await importSeptember();

    expect(summary()).toEqual([
      '\n=== IMPORT COMPLETE ===', 'Projects: 0', 'Bills: 1', 'Details: 1', 'Failed items: 1',
    ]);
  });

  test('is counted once, after the retries of a server error', async () => {
    mockRoutes.set('/me/bill/FR1/details/D2', fail(503, 'Service unavailable'));

    await importSeptember();

    expect(console.error)
      .toHaveBeenCalledWith('  [batch] Error processing item "D2": 503 Service unavailable');
    expect(summary()).toContain('Failed items: 1');
  });
});

describe('an import where every call succeeds', () => {
  test('says that no item failed', async () => {
    await importSeptember();

    expect(summary()).toEqual([
      '\n=== IMPORT COMPLETE ===', 'Projects: 0', 'Bills: 1', 'Details: 2', 'Failed items: 0',
    ]);
  });
});
