/**
 * The data routes that API consumers call and the dashboard does not (#140): the bills of a
 * period, and the daily trend of their costs, on the server started in a child process over a
 * database that the test seeds. Over a database of one account, they answer as they always
 * did, whether its rows carry the account or, stored before the accounts (#112), none, as the
 * Unknown account's (see CONTEXT.md).
 *
 * Both take the account parameter, as the other data routes do (#115, see
 * account-parameter.test.js): a NIC handle that the accounts table records keeps that
 * account's bills, the reserved value `unknown` the bills without an account (the Unknown
 * account), and no parameter every account's, as before. Any other value is refused. The
 * parameter leaves out the other accounts' bills, and nothing else: the bills it keeps come
 * whole, in the order that every account's come in, and the daily trend adds up their lines.
 */

const {
  LYON, PARIS, NEW_ACCOUNT, UNKNOWN_ACCOUNT, REFUSED, SQLITE_TIME, bill,
} = require('./support/accounts');
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

// Two accounts and the Unknown account, whose bills were stored before OCM told accounts
// apart, and an account recorded without a bill. Each billed on 5 September, Lyon twice:
// FR1003 was stored first, then Paris's bill, then FR1001. Every NIC handle, name and amount is
// made up.
function seedAccounts(db) {
  db.accounts.upsert({ nic: LYON, currency: 'EUR', name: 'Lyon subsidiary' });
  db.accounts.upsert({ nic: PARIS, currency: 'EUR' });
  db.accounts.upsert({ nic: NEW_ACCOUNT, currency: 'EUR' });
  bill(db, 'FR0001', '2026-09-05', null);
  bill(db, 'FR0002', '2026-06-20', null);
  bill(db, 'FR1003', '2026-09-05', LYON);
  bill(db, 'FR2001', '2026-09-05', PARIS);
  bill(db, 'FR1001', '2026-09-05', LYON);
  bill(db, 'FR1002', '2026-08-05', LYON);
  bill(db, 'FR2002', '2026-07-10', PARIS);
  db.details.insertMany([
    line('FR0001-1', 'FR0001', 80),
    line('FR0002-1', 'FR0002', 30),
    line('FR1001-1', 'FR1001', 600),
    line('FR1001-2', 'FR1001', 100),
    line('FR1002-1', 'FR1002', 500),
    line('FR1003-1', 'FR1003', 50),
    line('FR2001-1', 'FR2001', 240),
    line('FR2002-1', 'FR2002', 150),
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

describe('a database of several accounts', () => {
  let ocm;

  beforeAll(async () => {
    ocm = await startOcm(() => ({}), { seed: seedAccounts });
  }, 30000);

  afterAll(async () => {
    await ocm?.stop();
  });

  describe('GET /api/bills', () => {
    const billsOf = async (parameters) => ids(await ocm.get(`/api/bills?${parameters}`));

    test('lists the bills of every account without the parameter, as before', async () => {
      expect(await billsOf('')).toEqual({
        status: 200,
        ids: ['FR1001', 'FR2001', 'FR1003', 'FR0001', 'FR1002', 'FR2002', 'FR0002'],
      });
    });

    test('lists the bills of the account whose NIC handle it gives', async () => {
      expect(await billsOf(`account=${LYON}`))
        .toEqual({ status: 200, ids: ['FR1001', 'FR1003', 'FR1002'] });
      expect(await billsOf(`account=${PARIS}`))
        .toEqual({ status: 200, ids: ['FR2001', 'FR2002'] });
    });

    test('lists the bills of the Unknown account: those without an account', async () => {
      expect(await billsOf(`account=${UNKNOWN_ACCOUNT}`))
        .toEqual({ status: 200, ids: ['FR0001', 'FR0002'] });
    });

    test('lists no bill for an account recorded without a bill', async () => {
      expect(await billsOf(`account=${NEW_ACCOUNT}`)).toEqual({ status: 200, ids: [] });
    });

    test('lists the bills of the account between the dates it gives, or from or up to one',
      async () => {
        expect(await billsOf(`from=2026-09-01&to=2026-09-30&account=${LYON}`))
          .toEqual({ status: 200, ids: ['FR1001', 'FR1003'] });
        expect(await billsOf(`from=2026-07-01&account=${UNKNOWN_ACCOUNT}`))
          .toEqual({ status: 200, ids: ['FR0001'] });
        expect(await billsOf(`to=2026-08-31&account=${PARIS}`))
          .toEqual({ status: 200, ids: ['FR2002'] });
      });

    test('lists the bills of an account whole, in the order of those of every account',
      async () => {
        const { body: everyAccount } = await ocm.get('/api/bills');

        for (const [account, nic] of [[LYON, LYON], [PARIS, PARIS], [UNKNOWN_ACCOUNT, null]]) {
          expect(await ocm.get(`/api/bills?account=${account}`)).toEqual({
            status: 200, body: everyAccount.filter((listed) => listed.account === nic),
          });
        }
      });
  });

  describe('GET /api/analysis/daily-trend', () => {
    const trend = (parameters) => ocm.get(`/api/analysis/daily-trend?${parameters}`);
    // June to September 2026
    const FOUR_MONTHS = 'from=2026-06-01&to=2026-09-30';

    test('adds up every account without the parameter, as before', async () => {
      expect(await trend(FOUR_MONTHS)).toEqual({
        status: 200,
        body: [
          { date: '2026-06-20', day: 20, cost: 30 },
          { date: '2026-07-10', day: 10, cost: 150 },
          { date: '2026-08-05', day: 5, cost: 500 },
          { date: '2026-09-05', day: 5, cost: 1070 },
        ],
      });
    });

    test('adds up the bills of the account whose NIC handle it gives', async () => {
      expect(await trend(`${FOUR_MONTHS}&account=${LYON}`)).toEqual({
        status: 200,
        body: [
          { date: '2026-08-05', day: 5, cost: 500 },
          { date: '2026-09-05', day: 5, cost: 750 },
        ],
      });
      expect(await trend(`${FOUR_MONTHS}&account=${PARIS}`)).toEqual({
        status: 200,
        body: [
          { date: '2026-07-10', day: 10, cost: 150 },
          { date: '2026-09-05', day: 5, cost: 240 },
        ],
      });
    });

    test('adds up the bills of the Unknown account: those without an account', async () => {
      expect(await trend(`${FOUR_MONTHS}&account=${UNKNOWN_ACCOUNT}`)).toEqual({
        status: 200,
        body: [
          { date: '2026-06-20', day: 20, cost: 30 },
          { date: '2026-09-05', day: 5, cost: 80 },
        ],
      });
    });

    test('gives no day for an account recorded without a bill', async () => {
      expect(await trend(`${FOUR_MONTHS}&account=${NEW_ACCOUNT}`))
        .toEqual({ status: 200, body: [] });
    });

    test('adds up the bills of the account within the period alone', async () => {
      expect(await trend(`from=2026-09-01&to=2026-09-30&account=${LYON}`)).toEqual({
        status: 200, body: [{ date: '2026-09-05', day: 5, cost: 750 }],
      });
    });
  });

  // Rather than answer for all accounts, or for none, to a request that names an account
  describe('an account the server does not know', () => {
    test.each([
      ['a NIC handle that no import recorded', 'account=ww4444-ovh'],
      ['an empty value', 'account='],
      ['several values', `account=${LYON}&account=${PARIS}`],
    ])('is refused by both routes, naming the parameter: %s', async (_, parameter) => {
      expect(await ocm.get(`/api/bills?${parameter}`)).toEqual({ status: 400, body: REFUSED });
      expect(await ocm.get(`/api/analysis/daily-trend?from=2026-06-01&to=2026-09-30&${parameter}`))
        .toEqual({ status: 400, body: REFUSED });
    });
  });
});
