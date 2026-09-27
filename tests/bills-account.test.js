/**
 * The data routes that API consumers call and the dashboard does not (#140): the bills of a
 * period, and the daily trend of their costs, on the server started in a child process over a
 * database that the test seeds. Over a database of one account, they answer as they always
 * did, whether its rows carry the account or, stored before the accounts (#112), none, as the
 * Unknown account's (see CONTEXT.md).
 */

const { LYON, SQLITE_TIME } = require('./support/accounts');
const { asBeforeAccounts } = require('./support/database-before');
const { startOcm } = require('./support/ocm-server');

// The one account
const NIC = LYON;

// Where OVH serves a bill, as a PDF and as a page
const pdfUrl = (id) => `https://bills.example.com/${id}.pdf`;
const htmlUrl = (id) => `https://bills.example.com/${id}`;

// A bill of the one account, as its import stores it: its prices without tax, with tax, and
// its tax
const storeBill = (db, id, date, [withoutTax, withTax, tax]) => db.bills.upsert({
  id, date, price_without_tax: withoutTax, price_with_tax: withTax, tax, currency: 'EUR',
  pdf_url: pdfUrl(id), html_url: htmlUrl(id), account: NIC,
});

// A bill line, which the daily trend adds up by the day of its bill
const line = (id, billId, price) => ({
  id, bill_id: billId, project_id: null, domain: 'example.com', description: `${id} line`,
  quantity: 1, unit_price: price, total_price: price, service_type: 'Other',
  resource_type: 'domain',
});

// Four bills of the account, two issued on 1 September, of which FR1004 was stored first, and
// how FR1002 was paid, which the import records with the balance. Every NIC handle, amount and
// URL is made up.
function seedOneAccount(db) {
  db.accounts.upsert({ nic: NIC, currency: 'EUR' });
  storeBill(db, 'FR1001', '2026-07-02', [100, 120, 20]);
  storeBill(db, 'FR1002', '2026-08-15', [250.52, 300.62, 50.1]);
  storeBill(db, 'FR1004', '2026-09-01', [40, 48, 8]);
  storeBill(db, 'FR1003', '2026-09-01', [300, 360, 60]);
  db.balance.updateBillPayment('FR1002',
    { type: 'creditCard', date: '2026-08-17', status: 'paid' });
  db.details.insertMany([
    line('FR1001-1', 'FR1001', 60),
    line('FR1001-2', 'FR1001', 40),
    line('FR1002-1', 'FR1002', 200.123),
    line('FR1002-2', 'FR1002', 50.4),
    line('FR1003-1', 'FR1003', 300),
    line('FR1004-1', 'FR1004', 40),
  ]);
}

// The ids of the bills that the bills route lists, in its order
const ids = ({ status, body }) => ({ status, ids: body.map(({ id }) => id) });

// Whose rows carry the account, as its imports store them now, or, from a version before the
// accounts, none
describe.each([
  ['as its imports store it', () => {}, NIC],
  ['as a version before the accounts left it', asBeforeAccounts, null],
])('a database of one account %s', (_, before, account) => {
  let ocm;

  beforeAll(async () => {
    ocm = await startOcm(() => ({}), {
      seed: (db) => {
        seedOneAccount(db);
        before(db.getDb());
      },
    });
  }, 30000);

  afterAll(async () => {
    await ocm?.stop();
  });

  describe('GET /api/bills', () => {
    // A bill as the route lists it: its row as the import stored it, with the account it
    // carries, and how it was paid when the import recorded it
    const listed = (id, date, [withoutTax, withTax, tax], [type, paidOn, status] = []) => ({
      id, date, price_without_tax: withoutTax, price_with_tax: withTax, tax, currency: 'EUR',
      pdf_url: pdfUrl(id), html_url: htmlUrl(id), imported_at: expect.stringMatching(SQLITE_TIME),
      account, payment_type: type ?? null, payment_date: paidOn ?? null,
      payment_status: status ?? null,
    });

    test('lists every bill without dates, the latest first, those of a day the last stored first',
      async () => {
        expect(await ocm.get('/api/bills')).toEqual({
          status: 200,
          body: [
            listed('FR1003', '2026-09-01', [300, 360, 60]),
            listed('FR1004', '2026-09-01', [40, 48, 8]),
            listed('FR1002', '2026-08-15', [250.52, 300.62, 50.1],
              ['creditCard', '2026-08-17', 'paid']),
            listed('FR1001', '2026-07-02', [100, 120, 20]),
          ],
        });
      });

    test('lists the bills between two dates, both included', async () => {
      expect(ids(await ocm.get('/api/bills?from=2026-08-15&to=2026-09-01')))
        .toEqual({ status: 200, ids: ['FR1003', 'FR1004', 'FR1002'] });
      expect(ids(await ocm.get('/api/bills?from=2026-08-01&to=2026-08-31')))
        .toEqual({ status: 200, ids: ['FR1002'] });
    });

    test('lists the bills from a date, or up to a date, given alone', async () => {
      expect(ids(await ocm.get('/api/bills?from=2026-08-15')))
        .toEqual({ status: 200, ids: ['FR1003', 'FR1004', 'FR1002'] });
      expect(ids(await ocm.get('/api/bills?to=2026-08-15')))
        .toEqual({ status: 200, ids: ['FR1002', 'FR1001'] });
    });
  });

  describe('GET /api/analysis/daily-trend', () => {
    test('gives the cost of each day of the period that has a bill, rounded to the cent',
      async () => {
        expect(await ocm.get('/api/analysis/daily-trend?from=2026-07-01&to=2026-09-30')).toEqual({
          status: 200,
          body: [
            { date: '2026-07-02', day: 2, cost: 100 },
            { date: '2026-08-15', day: 15, cost: 250.52 },
            { date: '2026-09-01', day: 1, cost: 340 },
          ],
        });
        expect(await ocm.get('/api/analysis/daily-trend?from=2026-08-01&to=2026-08-31'))
          .toEqual({ status: 200, body: [{ date: '2026-08-15', day: 15, cost: 250.52 }] });
      });

    test('requires both dates', async () => {
      expect(await ocm.get('/api/analysis/daily-trend?from=2026-07-01')).toEqual({
        status: 400, body: { error: 'from and to parameters are required' },
      });
    });
  });
});
