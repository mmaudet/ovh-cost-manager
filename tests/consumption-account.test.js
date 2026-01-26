/**
 * Tests for consumption and account-related database operations
 * Phase 1: Consumption snapshots and history
 * Phase 2: Account balance and credit movements
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

let db;
let testDbPath;

beforeAll(() => {
  testDbPath = path.join(__dirname, 'test-consumption.db');
  db = new Database(testDbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  const schema = fs.readFileSync(path.join(__dirname, '..', 'data', 'schema.sql'), 'utf8');
  db.exec(schema);

  // Add columns that are added via migration
  try { db.exec('ALTER TABLE bill_details ADD COLUMN resource_type TEXT'); } catch(e) {}
  try { db.exec('ALTER TABLE bills ADD COLUMN payment_type TEXT'); } catch(e) {}
  try { db.exec('ALTER TABLE bills ADD COLUMN payment_date DATETIME'); } catch(e) {}
  try { db.exec('ALTER TABLE bills ADD COLUMN payment_status TEXT'); } catch(e) {}
});

afterAll(() => {
  db.close();
  try { fs.unlinkSync(testDbPath); } catch(e) {}
  try { fs.unlinkSync(testDbPath + '-wal'); } catch(e) {}
  try { fs.unlinkSync(testDbPath + '-shm'); } catch(e) {}
});

describe('Consumption Snapshots (Phase 1)', () => {
  test('inserts and retrieves a consumption snapshot', () => {
    db.prepare(`
      INSERT INTO consumption_snapshots (snapshot_date, period_start, period_end, current_total, forecast_total, currency, raw_data)
      VALUES (CURRENT_TIMESTAMP, '2025-01-01', '2025-01-31', 1234.56, 2000.00, 'EUR', '{"test": true}')
    `).run();

    const row = db.prepare('SELECT * FROM consumption_snapshots ORDER BY id DESC LIMIT 1').get();
    expect(row).toBeTruthy();
    expect(row.current_total).toBe(1234.56);
    expect(row.forecast_total).toBe(2000.00);
    expect(row.currency).toBe('EUR');
    expect(row.period_start).toBe('2025-01-01');
    expect(row.period_end).toBe('2025-01-31');
  });

  test('raw_data is valid JSON', () => {
    const row = db.prepare('SELECT raw_data FROM consumption_snapshots ORDER BY id DESC LIMIT 1').get();
    const parsed = JSON.parse(row.raw_data);
    expect(parsed.test).toBe(true);
  });
});

describe('Consumption History (Phase 1)', () => {
  test('inserts consumption history entries', () => {
    db.prepare(`
      INSERT INTO consumption_history (period_start, period_end, service_type, total, currency, raw_data)
      VALUES ('2024-12-01', '2024-12-31', 'cloud', 5000.00, 'EUR', '{}')
    `).run();
    db.prepare(`
      INSERT INTO consumption_history (period_start, period_end, service_type, total, currency, raw_data)
      VALUES ('2025-01-01', '2025-01-31', 'cloud', 5500.00, 'EUR', '{}')
    `).run();

    const rows = db.prepare('SELECT * FROM consumption_history ORDER BY period_start DESC').all();
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows[0].total).toBe(5500.00);
  });

  test('filters by date range', () => {
    const rows = db.prepare(
      'SELECT * FROM consumption_history WHERE period_start >= ? AND period_end <= ?'
    ).all('2025-01-01', '2025-01-31');
    expect(rows.length).toBe(1);
    expect(rows[0].total).toBe(5500.00);
  });
});

describe('Account Balance (Phase 2)', () => {
  test('inserts an account balance snapshot', () => {
    db.prepare(`
      INSERT INTO account_balance (snapshot_date, debt_balance, credit_balance, deposit_total, currency)
      VALUES (CURRENT_TIMESTAMP, 100.00, 500.00, 200.00, 'EUR')
    `).run();

    const row = db.prepare('SELECT * FROM account_balance ORDER BY id DESC LIMIT 1').get();
    expect(row.debt_balance).toBe(100.00);
    expect(row.credit_balance).toBe(500.00);
    expect(row.deposit_total).toBe(200.00);
  });

  test('net balance calculation', () => {
    const row = db.prepare('SELECT * FROM account_balance ORDER BY id DESC LIMIT 1').get();
    const net = row.credit_balance - row.debt_balance;
    expect(net).toBe(400.00);
  });
});

describe('Credit Movements (Phase 2)', () => {
  test('inserts credit movements', () => {
    db.prepare(`
      INSERT INTO credit_movements (id, balance_name, amount, date, description, movement_type)
      VALUES ('mov_1', 'main', 100.00, '2025-01-15', 'Voucher applied', 'credit')
    `).run();

    const row = db.prepare('SELECT * FROM credit_movements WHERE id = ?').get('mov_1');
    expect(row).toBeTruthy();
    expect(row.amount).toBe(100.00);
    expect(row.balance_name).toBe('main');
  });

  test('upserts on conflict', () => {
    db.prepare(`
      INSERT OR REPLACE INTO credit_movements (id, balance_name, amount, date, description, movement_type)
      VALUES ('mov_1', 'main', 150.00, '2025-01-15', 'Voucher updated', 'credit')
    `).run();

    const row = db.prepare('SELECT * FROM credit_movements WHERE id = ?').get('mov_1');
    expect(row.amount).toBe(150.00);
    expect(row.description).toBe('Voucher updated');
  });
});

describe('Bill Payment Info (Phase 2)', () => {
  test('stores payment info on bills', () => {
    db.prepare(`
      INSERT INTO bills (id, date, price_without_tax, price_with_tax, tax, currency)
      VALUES ('FR001', '2025-01-15', 100.00, 120.00, 20.00, 'EUR')
    `).run();

    db.prepare('UPDATE bills SET payment_type = ?, payment_date = ?, payment_status = ? WHERE id = ?')
      .run('creditCard', '2025-01-20', 'paid', 'FR001');

    const bill = db.prepare('SELECT * FROM bills WHERE id = ?').get('FR001');
    expect(bill.payment_type).toBe('creditCard');
    expect(bill.payment_date).toBe('2025-01-20');
    expect(bill.payment_status).toBe('paid');
  });
});
