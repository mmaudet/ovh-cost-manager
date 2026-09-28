/**
 * The routes of the carbon footprint (#147), of the server started in a child process over a
 * database that the test seeds as the import writes it: the footprint that OVHcloud's carbon
 * calculator attributes to the accounts, month by month.
 */

const { startOcm } = require('./support/ocm-server');
const {
  LYON, PARIS, NEW_ACCOUNT, UNKNOWN_ACCOUNT, recordAccounts,
} = require('./support/accounts');
const { footprintLine } = require('./support/carbon');

// A footprint line of a month, a dedicated server, with its emissions in kg CO2eq:
// manufacturing, electricity and operations, location-based. Its market-based electricity is
// half its location-based one.
const lineOf = (month, [manufacturing, electricity, operations]) => footprintLine({
  month, manufacturing, electricity: [electricity, electricity / 2],
  operations: [operations, operations],
});

// The months that the imports of the seed asked for
const MONTHS = { first: '2024-09', last: '2026-08' };

// Three accounts, whose footprint an import stored: Lyon's August of two lines, Paris's of
// one, and the third account's June, its latest
function seed(db) {
  recordAccounts(db, { nic: LYON }, { nic: PARIS }, { nic: NEW_ACCOUNT });
  db.carbon.replaceMonths(LYON, MONTHS, [
    lineOf('2026-08', [1, 2, 3]), lineOf('2026-08', [0.5, 0.5, 0.25]),
  ]);
  db.carbon.replaceMonths(PARIS, MONTHS, [lineOf('2026-08', [2, 4, 6])]);
  db.carbon.replaceMonths(NEW_ACCOUNT, MONTHS, [lineOf('2026-06', [1, 1, 1])]);
}

// The server over the seeded database, for the time of `use`
async function withOcm(use) {
  const ocm = await startOcm(() => ({}), { seed });
  try {
    await use(ocm);
  } finally {
    await ocm.stop();
  }
}

test('gives the carbon footprint of a month, by emission source and in total', async () => {
  await withOcm(async (ocm) => {
    // All accounts, with the market-based total, which counts the market-based electricity,
    // half the location-based one here (#152)
    expect(await ocm.get('/api/carbon/footprint?month=2026-08')).toEqual({
      status: 200,
      body: {
        month: '2026-08',
        footprint: {
          manufacturing: 3.5, electricity: 6.5, operations: 9.25, total: 19.25,
          marketBasedTotal: 16,
        },
        latestMonth: '2026-08',
      },
    });
    // One account
    expect((await ocm.get(`/api/carbon/footprint?month=2026-08&account=${LYON}`)).body).toEqual({
      month: '2026-08',
      footprint: {
        manufacturing: 1.5, electricity: 2.5, operations: 3.25, total: 7.25,
        marketBasedTotal: 6,
      },
      latestMonth: '2026-08',
    });
    // The Unknown account, which has none, as the footprint is imported account by account
    expect((await ocm.get(`/api/carbon/footprint?month=2026-08&account=${UNKNOWN_ACCOUNT}`)).body)
      .toEqual({ month: '2026-08', footprint: null, latestMonth: null });
  });
}, 30000);

// OVHcloud never gives the current month's footprint, nor the previous one's until it has
// computed it: the dashboard then shows the latest month that has one (#152)
test('gives the latest month that has a carbon footprint, for the accounts asked', async () => {
  await withOcm(async (ocm) => {
    // A month without a footprint, for all accounts
    expect((await ocm.get('/api/carbon/footprint?month=2026-09')).body)
      .toEqual({ month: '2026-09', footprint: null, latestMonth: '2026-08' });
    // For an account whose latest footprint is older
    expect((await ocm.get(`/api/carbon/footprint?month=2026-08&account=${NEW_ACCOUNT}`)).body)
      .toEqual({ month: '2026-08', footprint: null, latestMonth: '2026-06' });
  });
}, 30000);

test('refuses a month that is not one, and an account that it does not know', async () => {
  await withOcm(async (ocm) => {
    for (const query of ['', '?month=2026-8', '?month=august', '?month=2026-13']) {
      const { status, body } = await ocm.get(`/api/carbon/footprint${query}`);
      expect([query, status, body.error]).toEqual([
        query, 400, expect.stringMatching(/^Invalid 'month'/),
      ]);
    }
    expect((await ocm.get('/api/carbon/footprint?month=2026-08&account=ww4444-ovh')).status)
      .toBe(400);
  });
}, 30000);
