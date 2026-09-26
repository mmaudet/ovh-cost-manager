/**
 * Tests for data/count-bills.js, which the container's cron runs at start: it
 * runs a full import, which clears the database, only when this count
 * succeeds and finds no bill.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const countScript = path.join(__dirname, '..', 'data', 'count-bills.js');

let root;

// Create the database of `dataDir` as the server does, with these bills
function createDatabase(dataDir, billIds) {
  // data/db.js reads DATA_DIR once, when it is first required
  process.env.DATA_DIR = dataDir;
  jest.isolateModules(() => {
    const db = require('../data/db');
    db.getDb();
    for (const id of billIds) {
      db.bills.upsert({
        id, date: '2026-09-01', price_without_tax: 10, price_with_tax: 12, tax: 2,
        currency: 'EUR', pdf_url: null, html_url: null,
      });
    }
    db.closeDb();
  });
}

// Run the script as the cron does, on the database of `dataDir`
function countBills(dataDir) {
  return spawnSync(process.execPath, [countScript], {
    env: { ...process.env, DATA_DIR: dataDir },
    encoding: 'utf8',
  });
}

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ovh-count-bills-'));
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('data/count-bills.js', () => {
  test('prints 0 for a database without any bill', () => {
    const dataDir = path.join(root, 'empty');
    createDatabase(dataDir, []);

    const result = countBills(dataDir);
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('0\n');
  });

  test('prints the number of bills', () => {
    const dataDir = path.join(root, 'billed');
    createDatabase(dataDir, ['FR0001', 'FR0002', 'FR0003']);

    const result = countBills(dataDir);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('3\n');
  });

  test('fails without printing any count when the database cannot be read', () => {
    const dataDir = path.join(root, 'unreadable');
    fs.mkdirSync(dataDir);
    fs.writeFileSync(path.join(dataDir, 'ovh-bills.db'), 'Not an SQLite database.\n'.repeat(200));

    const result = countBills(dataDir);
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toMatch(/cannot count the bills/i);
  });
});
