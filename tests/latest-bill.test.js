/**
 * The date of the latest bill (data/db.js), of every account or of one, as the queries that
 * keep one account's rows read it (#115, #120): null for every account, a NIC handle, or
 * `unknown` for the Unknown account, the bills without an account.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { LYON, PARIS, NEW_ACCOUNT, UNKNOWN_ACCOUNT, bill } = require('./support/accounts');

let db;
let dataDir;

beforeAll(() => {
  // data/db.js reads DATA_DIR once, when it is first required
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ocm-latest-bill-'));
  process.env.DATA_DIR = dataDir;
  db = require('../data/db');

  bill(db, 'FR1001', '2026-08-05', LYON);
  bill(db, 'FR1002', '2026-07-05', LYON);
  bill(db, 'FR2001', '2026-09-10', PARIS);
  // Imported before OCM told accounts apart, and claimed by no account since: the writers
  // refuse such rows now, so they are written as the database held them
  const unclaimedBill = db.getDb().prepare(
    "INSERT INTO bills (id, date, currency, account) VALUES (?, ?, 'EUR', NULL)",
  );
  unclaimedBill.run('FR0001', '2026-06-20');
  unclaimedBill.run('FR0002', '2026-05-20');
});

afterAll(() => {
  db.closeDb();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe('the date of the latest bill', () => {
  test.each([
    ['every account', null, '2026-09-10'],
    ['an account, by its NIC handle', LYON, '2026-08-05'],
    ['the Unknown account: the bills without an account', UNKNOWN_ACCOUNT, '2026-06-20'],
  ])('is that of %s', (_, account, date) => {
    expect(db.bills.getLatestDate(account)).toBe(date);
  });

  test('is that of every account by default', () => {
    expect(db.bills.getLatestDate()).toBe('2026-09-10');
  });

  test('is none for an account without a bill', () => {
    expect(db.bills.getLatestDate(NEW_ACCOUNT)).toBeNull();
  });
});
