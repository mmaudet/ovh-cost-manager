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
// manufacturing, electricity and operations, location-based. Its market-based electricity and
// operations are half its location-based ones.
const lineOf = (month, [manufacturing, electricity, operations]) => footprintLine({
  month, manufacturing, electricity: [electricity, electricity / 2],
  operations: [operations, operations / 2],
});

// The months that the imports of the seed asked for
const MONTHS = { first: '2024-09', last: '2026-08' };

// Three accounts, whose footprint an import stored: Lyon's August of two lines, Paris's of
// one, and the third account's June, its latest
function seed(db) {
  recordAccounts(db, { nic: LYON }, { nic: PARIS }, { nic: NEW_ACCOUNT });
  db.carbon.replaceMonths(LYON, MONTHS, [
    lineOf('2026-08', [1, 2, 3]), lineOf('2026-08', [0.5, 0.5, 0.5]),
  ]);
  db.carbon.replaceMonths(PARIS, MONTHS, [lineOf('2026-08', [2, 4, 6])]);
  db.carbon.replaceMonths(NEW_ACCOUNT, MONTHS, [lineOf('2026-06', [1, 1, 1])]);
}

// The server over the database that seedWith() seeds, the seed above by default, for the time
// of `use`
async function withOcm(use, seedWith = seed) {
  const ocm = await startOcm(() => ({}), { seed: seedWith });
  try {
    await use(ocm);
  } finally {
    await ocm.stop();
  }
}

test('gives the carbon footprint of a month, by emission source and in total', async () => {
  await withOcm(async (ocm) => {
    // All accounts, with the market-based total, which counts the market-based electricity
    // and operations, half the location-based ones here (#152)
    expect(await ocm.get('/api/carbon/footprint?month=2026-08')).toEqual({
      status: 200,
      body: {
        month: '2026-08',
        footprint: {
          manufacturing: 3.5, electricity: 6.5, operations: 9.5, total: 19.5,
          marketBasedTotal: 11.5,
        },
        latestMonth: '2026-08',
        // The configured account that has none that month (#153)
        accountsWithoutFootprint: [NEW_ACCOUNT],
      },
    });
    // One account
    expect((await ocm.get(`/api/carbon/footprint?month=2026-08&account=${LYON}`)).body).toEqual({
      month: '2026-08',
      footprint: {
        manufacturing: 1.5, electricity: 2.5, operations: 3.5, total: 7.5,
        marketBasedTotal: 4.5,
      },
      latestMonth: '2026-08',
      // Only with all accounts
      accountsWithoutFootprint: null,
    });
    // The Unknown account, which has none, as the footprint is imported account by account
    expect((await ocm.get(`/api/carbon/footprint?month=2026-08&account=${UNKNOWN_ACCOUNT}`)).body)
      .toEqual({
        month: '2026-08', footprint: null, latestMonth: null, accountsWithoutFootprint: null,
      });
  });
}, 30000);

// OVHcloud never gives the current month's footprint, nor the previous one's until it has
// computed it: the dashboard then shows the latest month that has one (#152)
test('gives the latest month that has a carbon footprint, for the accounts asked', async () => {
  await withOcm(async (ocm) => {
    // A month without a footprint, for all accounts
    expect((await ocm.get('/api/carbon/footprint?month=2026-09')).body).toEqual({
      month: '2026-09', footprint: null, latestMonth: '2026-08',
      accountsWithoutFootprint: [LYON, PARIS, NEW_ACCOUNT],
    });
    // For an account whose latest footprint is older
    expect((await ocm.get(`/api/carbon/footprint?month=2026-08&account=${NEW_ACCOUNT}`)).body)
      .toEqual({
        month: '2026-08', footprint: null, latestMonth: '2026-06', accountsWithoutFootprint: null,
      });
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

// With all accounts, the tab names the accounts that have no footprint for the month it shows
// (#153): the configured accounts, and an account that the configuration no longer lists but
// that was billed that month; not the Unknown account, which never has one
test('names the accounts without a carbon footprint, in their order', async () => {
  await withOcm(async (ocm) => {
    // June: the third account has its footprint, no longer configured
    expect((await ocm.get('/api/carbon/footprint?month=2026-06')).body.accountsWithoutFootprint)
      .toEqual([LYON, PARIS]);
    // August: the third account, billed, has none
    expect((await ocm.get('/api/carbon/footprint?month=2026-08')).body.accountsWithoutFootprint)
      .toEqual([NEW_ACCOUNT]);
    // July: nobody billed it, nor any footprint
    expect((await ocm.get('/api/carbon/footprint?month=2026-07')).body.accountsWithoutFootprint)
      .toEqual([LYON, PARIS]);
  }, (db) => {
    seed(db);
    // The third account no longer configured, billed in August
    db.accounts.recordConfiguration([LYON, PARIS]);
    db.bills.upsert({
      id: 'FR3', date: '2026-08-10', price_without_tax: 10, price_with_tax: 12, tax: 2,
      currency: 'EUR', pdf_url: null, html_url: null, account: NEW_ACCOUNT,
    });
  });
}, 30000);

// The footprint of the 12 months that end on a month (#154): each month by emission source,
// location-based, and none for a month without one, rather than zero
test('gives the carbon footprint of the 12 months that end on a month', async () => {
  // A month without a footprint
  const none = (month) => ({ month, footprint: null });
  const empty = ['2025-09', '2025-10', '2025-11', '2025-12', '2026-01', '2026-02', '2026-03',
    '2026-04', '2026-05'].map(none);
  await withOcm(async (ocm) => {
    // All accounts
    expect(await ocm.get('/api/carbon/trend?end=2026-08')).toEqual({
      status: 200,
      body: [
        ...empty,
        {
          month: '2026-06',
          footprint: { manufacturing: 1, electricity: 1, operations: 1, total: 3 },
        },
        none('2026-07'),
        {
          month: '2026-08',
          footprint: { manufacturing: 3.5, electricity: 6.5, operations: 9.5, total: 19.5 },
        },
      ],
    });
    // One account
    expect((await ocm.get(`/api/carbon/trend?end=2026-08&account=${LYON}`)).body.slice(-3))
      .toEqual([
        none('2026-06'), none('2026-07'),
        {
          month: '2026-08',
          footprint: { manufacturing: 1.5, electricity: 2.5, operations: 3.5, total: 7.5 },
        },
      ]);
    // A month that is not one
    const { status, body } = await ocm.get('/api/carbon/trend?end=2026-8');
    expect([status, body.error]).toEqual([400, expect.stringMatching(/^Invalid 'end'/)]);
  });
}, 30000);
