/**
 * The account parameter of the routes of the account-wide figures (#116), on the server
 * started in a child process over a database that the test seeds with several accounts: the
 * balance and the movements of the credits. A NIC handle that the accounts table records
 * selects that account's figures, the reserved value `unknown` those of the Unknown account,
 * and no parameter those of every account: the sum of each account's latest, as each account's
 * import records its own (#114), and the accounts bill in one currency.
 */

const {
  LYON, PARIS, NEW_ACCOUNT, UNKNOWN_ACCOUNT, REFUSED, SQLITE_TIME,
} = require('./support/accounts');
const { startOcm } = require('./support/ocm-server');

// A balance of an account, taken at a time, as its import stores it: the Unknown account's
// is written as the database held it, since the writers refuse a row without an account
function storeBalance(db, account, takenAt, { debt, credit, deposit }) {
  const balance = {
    debt_balance: debt, credit_balance: credit, deposit_total: deposit, currency: 'EUR',
  };
  const sqlite = db.getDb();
  const { lastInsertRowid } = account === null
    ? sqlite.prepare(`
      INSERT INTO account_balance (debt_balance, credit_balance, deposit_total, currency)
      VALUES (@debt_balance, @credit_balance, @deposit_total, @currency)
    `).run(balance)
    : db.balance.insertBalance({ ...balance, account });
  sqlite.prepare('UPDATE account_balance SET snapshot_date = ? WHERE id = ?')
    .run(takenAt, lastInsertRowid);
}

// A movement of a credit of an account, the Unknown account's written as the database held it
function storeMovement(db, account, { id, amount, date }) {
  const movement = {
    id, balance_name: id.split('_')[0], amount, date, description: `Movement ${id}`,
    movement_type: amount > 0 ? 'VOUCHER' : 'USE',
  };
  if (account !== null) {
    db.balance.insertCreditMovement({ ...movement, account });
    return;
  }
  db.getDb().prepare(`
    INSERT INTO credit_movements
      (id, balance_name, amount, date, description, movement_type, account)
    VALUES (@id, @balance_name, @amount, @date, @description, @movement_type, NULL)
  `).run(movement);
}

// Two accounts, with their balances and credits, and the Unknown account's, which an import
// before the accounts stored. The latest balance of each account is not the latest stored.
// Every NIC handle, name and amount is made up.
function seed(db) {
  db.accounts.upsert({ nic: LYON, currency: 'EUR', name: 'Lyon subsidiary' });
  db.accounts.upsert({ nic: PARIS, currency: 'EUR' });
  db.accounts.upsert({ nic: NEW_ACCOUNT, currency: 'EUR' });

  storeBalance(db, null, '2026-06-30 08:00:00', { debt: 1, credit: 4.75, deposit: 0 });
  storeBalance(db, LYON, '2026-09-13 04:02:00', { debt: 5, credit: 20, deposit: 0 });
  storeBalance(db, LYON, '2026-09-14 04:02:00', { debt: 12.5, credit: 50.25, deposit: 100 });
  storeBalance(db, PARIS, '2026-09-14 04:01:00', { debt: 7.5, credit: 0, deposit: 30 });

  storeMovement(db, LYON, { id: 'VOUCHER_1', amount: 50, date: '2026-08-01T10:00:00+02:00' });
  storeMovement(db, LYON, { id: 'VOUCHER_2', amount: -20, date: '2026-09-01T10:00:00+02:00' });
  // The same id as Lyon's: two accounts' movements can share their ids (#114)
  storeMovement(db, PARIS, { id: 'VOUCHER_1', amount: 30, date: '2026-08-15T10:00:00+02:00' });
  storeMovement(db, null, { id: 'PREPAID_1', amount: 10, date: '2026-06-01T10:00:00+02:00' });
}

let ocm;

beforeAll(async () => {
  ocm = await startOcm(() => ({}), { seed });
}, 30000);

afterAll(async () => {
  await ocm?.stop();
});

// The query string that asks for an account, none for every account
const of = (account) => (account === undefined ? '' : `?account=${account}`);

describe('GET /api/account/balance', () => {
  // A balance as the route answers it
  const balance = (snapshotDate, debt, credit, deposit) => ({
    snapshot_date: snapshotDate, debt_balance: debt, credit_balance: credit,
    deposit_total: deposit, net_balance: Math.round((credit - debt) * 100) / 100,
    currency: 'EUR',
  });

  test('adds up the latest balance of every account without the parameter', async () => {
    // Lyon's latest, Paris's and the Unknown account's, taken last by Lyon's import
    expect(await ocm.get('/api/account/balance')).toEqual({
      status: 200, body: balance('2026-09-14 04:02:00', 21, 55, 130),
    });
  });

  test("gives the latest balance of the account whose NIC handle it gives", async () => {
    expect(await ocm.get(`/api/account/balance${of(LYON)}`)).toEqual({
      status: 200, body: balance('2026-09-14 04:02:00', 12.5, 50.25, 100),
    });
    expect(await ocm.get(`/api/account/balance${of(PARIS)}`)).toEqual({
      status: 200, body: balance('2026-09-14 04:01:00', 7.5, 0, 30),
    });
  });

  test('gives the balance of the Unknown account: the latest without an account', async () => {
    expect(await ocm.get(`/api/account/balance${of(UNKNOWN_ACCOUNT)}`)).toEqual({
      status: 200, body: balance('2026-06-30 08:00:00', 1, 4.75, 0),
    });
  });

  test('gives no balance for an account whose import recorded none', async () => {
    expect(await ocm.get(`/api/account/balance${of(NEW_ACCOUNT)}`)).toEqual({
      status: 200,
      body: { debt_balance: 0, credit_balance: 0, deposit_total: 0, currency: 'EUR' },
    });
  });
});

describe('GET /api/account/debts', () => {
  test.each([
    ['every account, without the parameter', undefined, 21],
    ['the account whose NIC handle it gives', LYON, 12.5],
    ['the Unknown account', UNKNOWN_ACCOUNT, 1],
    ['an account whose import recorded no balance', NEW_ACCOUNT, 0],
  ])('gives the debt of the latest balance of %s', async (_, account, debt) => {
    expect(await ocm.get(`/api/account/debts${of(account)}`)).toEqual({
      status: 200, body: { debt_balance: debt, currency: 'EUR' },
    });
  });
});

describe('GET /api/account/credits', () => {
  // The movements of an answer, most recent first, as [account, id, amount]
  const listed = ({ status, body }) => ({
    status, body: body.map(({ account, id, amount }) => [account, id, amount]),
  });

  test('lists the movements of every account without the parameter, as before', async () => {
    expect(listed(await ocm.get('/api/account/credits'))).toEqual({
      status: 200,
      body: [
        [LYON, 'VOUCHER_2', -20],
        [PARIS, 'VOUCHER_1', 30],
        [LYON, 'VOUCHER_1', 50],
        [null, 'PREPAID_1', 10],
      ],
    });
  });

  test.each([
    [LYON, [[LYON, 'VOUCHER_2', -20], [LYON, 'VOUCHER_1', 50]]],
    [PARIS, [[PARIS, 'VOUCHER_1', 30]]],
    [UNKNOWN_ACCOUNT, [[null, 'PREPAID_1', 10]]],
    [NEW_ACCOUNT, []],
  ])('lists the movements of the account %s only', async (account, movements) => {
    expect(listed(await ocm.get(`/api/account/credits${of(account)}`)))
      .toEqual({ status: 200, body: movements });
  });

  test('gives each movement as its table holds it', async () => {
    const { body } = await ocm.get(`/api/account/credits${of(PARIS)}`);
    expect(body).toEqual([{
      id: 'VOUCHER_1', balance_name: 'VOUCHER', amount: 30, date: '2026-08-15T10:00:00+02:00',
      description: 'Movement VOUCHER_1', movement_type: 'VOUCHER',
      imported_at: expect.stringMatching(SQLITE_TIME), account: PARIS,
    }]);
  });
});

// Rather than answer for all accounts, or for none, to a request that names an account
describe('an account the server does not know', () => {
  test.each([
    ['a NIC handle that no import recorded', 'account=ww4444-ovh'],
    ['an empty value', 'account='],
    ['several values', `account=${LYON}&account=${PARIS}`],
  ])('is refused, naming the parameter: %s', async (_, parameter) => {
    for (const route of ['/api/account/balance', '/api/account/debts', '/api/account/credits']) {
      expect(await ocm.get(`${route}?${parameter}`)).toEqual({ status: 400, body: REFUSED });
    }
  });
});
