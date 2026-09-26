/**
 * Tests for the items that an import fails to fetch, against a simulated OVH
 * API: each one is skipped, its log line says why, and the summary counts it.
 */

const { routes, ok, fail, useThrowawayImport } = require('./support/simulated-ovh');

jest.mock('ovh', () => require('./support/simulated-ovh').ovh);
jest.mock('jsonfile', () => require('./support/simulated-ovh').jsonfile);

const throwaway = useThrowawayImport('ocm-import-failures-');
let db;
let importer;
beforeAll(() => {
  ({ db, importer } = throwaway);
});

// One bill of September with two lines, and no Public Cloud project
function serveBill() {
  routes.set('/cloud/project', ok([]));
  routes.set('/me/bill', ok(['FR1']));
  routes.set('/me/bill/FR1', ok({
    billId: 'FR1',
    date: '2026-09-01T00:00:00+02:00',
    priceWithoutTax: { value: 20, currencyCode: 'EUR' },
    priceWithTax: { value: 24, currencyCode: 'EUR' },
    tax: { value: 4, currencyCode: 'EUR' },
  }));
  routes.set('/me/bill/FR1/details', ok(['D1', 'D2']));
  for (const id of ['D1', 'D2']) {
    routes.set(`/me/bill/FR1/details/${id}`, ok({
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

beforeEach(() => {
  // The progress of the bills
  jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
  serveBill();
});

describe('an item that the import fails to fetch', () => {
  test('is logged with the status and the message of the OVH error', async () => {
    routes.set('/me/bill/FR1/details/D2',
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
    ['an object without a status or a message', { code: 'ECONNRESET' },
      '{ code: \'ECONNRESET\' }'],
  ])('is logged with a readable reason when the error is %s', async (_, error, reason) => {
    routes.set('/me/bill/FR1/details/D2', () => Promise.reject(error));

    await importSeptember();

    expect(console.error)
      .toHaveBeenCalledWith(`  [batch] Error processing item "D2": ${reason}`);
  });

  test('is skipped, and the rest of its bill stored', async () => {
    routes.set('/me/bill/FR1/details/D2', fail(404, 'The requested object does not exist'));

    await importSeptember();

    expect(db.bills.exists('FR1')).toBe(true);
    expect(db.details.getByBillId('FR1').map(d => d.id)).toEqual(['FR1_D1']);
  });

  test('is counted in the summary at the end of the import', async () => {
    routes.set('/me/bill/FR1/details/D2', fail(404, 'The requested object does not exist'));

    await importSeptember();

    expect(summary()).toEqual([
      '\n=== IMPORT COMPLETE ===', 'Projects: 0', 'Bills: 1', 'Details: 1', 'Failed items: 1',
    ]);
  });

  test('is counted once, after the retries of a server error', async () => {
    routes.set('/me/bill/FR1/details/D2', fail(503, 'Service unavailable'));

    await importSeptember();

    expect(console.error)
      .toHaveBeenCalledWith('  [batch] Error processing item "D2": 503 Service unavailable');
    expect(summary()).toContain('Failed items: 1');
  });
});

describe('a bill that the import fails to fetch', () => {
  test('is skipped, logged with the reason, and counted in the summary', async () => {
    routes.set('/me/bill/FR1',
      fail(404, 'The requested object (billId = FR1) does not exist'));

    await importSeptember();

    expect(db.bills.exists('FR1')).toBe(false);
    expect(console.log)
      .toHaveBeenCalledWith(' ERROR: 404 The requested object (billId = FR1) does not exist');
    expect(summary()).toEqual([
      '\n=== IMPORT COMPLETE ===', 'Projects: 0', 'Bills: 0', 'Details: 0', 'Failed items: 1',
    ]);
  });

  // As the calls of the other items are
  test.each(['/me/bill/FR1', '/me/bill/FR1/details'])(
    'is fetched again when %s answers a server error', async (route) => {
      const answer = routes.get(route);
      let calls = 0;
      routes.set(route, () => (++calls === 1 ? fail(503, 'Service unavailable')() : answer()));

      await importSeptember();

      expect(summary()).toEqual([
        '\n=== IMPORT COMPLETE ===', 'Projects: 0', 'Bills: 1', 'Details: 2', 'Failed items: 0',
      ]);
    });
});

describe('a call that the import retries', () => {
  // A rate limit waits twice as long as a server error
  test.each([
    ['a rate limit', { error: 429, message: 'Too many requests' },
      '  [retry 1/3] 429 Too many requests — waiting 2000ms'],
    ['a server error without a message', { error: 503, message: null },
      '  [retry 1/3] 503 — waiting 1000ms'],
  ])('is logged with the reason of %s', async (_, error, line) => {
    const answer = routes.get('/me/bill/FR1/details/D2');
    let calls = 0;
    routes.set('/me/bill/FR1/details/D2',
      () => (++calls === 1 ? Promise.reject(error) : answer()));

    await importSeptember();

    expect(console.warn).toHaveBeenCalledWith(line);
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
