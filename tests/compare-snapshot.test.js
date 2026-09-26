/**
 * Tests for the copies of the snapshot that the dashboard comparison
 * (scripts/compare-dashboard, see CONTRIBUTING.md) serves each side on. A
 * snapshot kept read-only must give each side a copy that its server can
 * migrate as it starts: a plain copy of a file keeps the mode of its source.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { pathToFileURL } = require('url');

const root = path.join(__dirname, '..');
const sides = pathToFileURL(path.join(root, 'scripts', 'compare-dashboard', 'sides.mjs')).href;
const DB_FILE = 'ovh-bills.db';

let work;
let snapshotDir;
const initialDataDir = process.env.DATA_DIR;

beforeEach(() => {
  work = fs.mkdtempSync(path.join(os.tmpdir(), 'ocm-compare-snapshot-'));
  snapshotDir = path.join(work, 'snapshot');
});

afterEach(() => {
  // Writable again, to be deleted
  if (fs.existsSync(snapshotDir)) fs.chmodSync(snapshotDir, 0o755);
  fs.rmSync(work, { recursive: true, force: true });
  if (initialDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = initialDataDir;
});

// Runs `use(db)` on data/db.js with the database of `dataDir`, as the server
// does: getDb() creates the schema, then adds the columns an older database
// lacks. data/db.js reads DATA_DIR once, when it is first required.
function withDataLayer(dataDir, use) {
  process.env.DATA_DIR = dataDir;
  let result;
  jest.isolateModules(() => {
    const db = require('../data/db');
    try {
      result = use(db);
    } finally {
      db.closeDb();
    }
  });
  return result;
}

// Fills the database of `dataDir` as an import does, with two bills, from
// before a column that the server adds as it starts: its server migrates it
function fillSnapshot(db) {
  for (const id of ['FR0000001', 'FR0000002']) {
    db.bills.upsert({
      id, date: '2026-09-01', price_without_tax: 10, price_with_tax: 12, tax: 2,
      currency: 'EUR', pdf_url: null, html_url: null,
    });
  }
  db.getDb().exec('ALTER TABLE cloud_instances DROP COLUMN plan_code');
}

// Makes the snapshot read-only, its files and its directory
function makeReadOnly(dir) {
  for (const file of fs.readdirSync(dir)) fs.chmodSync(path.join(dir, file), 0o444);
  fs.chmodSync(dir, 0o555);
}

// Freezes the snapshot as the comparison does, into `destination`: in a
// child process, since sides.mjs is an ES module
function freezeSnapshot(destination) {
  const script = [
    `import { freezeSnapshot, loadBetterSqlite } from ${JSON.stringify(sides)};`,
    `const Database = loadBetterSqlite(${JSON.stringify(root)});`,
    `const args = ${JSON.stringify([snapshotDir, destination])};`,
    'const snapshot = await freezeSnapshot(...args, Database);',
    'console.log(JSON.stringify(snapshot));',
  ].join('\n');
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    encoding: 'utf8',
  });
  if (child.status !== 0) throw new Error(`freezeSnapshot() failed:\n${child.stderr}`);
  return JSON.parse(child.stdout);
}

// Freezes the snapshot, then copies the frozen database for a side as
// index.mjs does, and starts the side's data layer on it, as its server does.
// Returns the frozen copy, the bills the side reads, and the columns of the
// table the server migrates.
function serveSide() {
  const frozen = path.join(work, DB_FILE);
  const snapshot = freezeSnapshot(frozen);
  expect(snapshot.bills).toBe(2);
  const sideDir = path.join(work, 'head-data');
  fs.mkdirSync(sideDir);
  fs.copyFileSync(frozen, path.join(sideDir, DB_FILE));
  return withDataLayer(sideDir, (db) => ({
    frozen,
    bills: db.getDb().prepare('SELECT id FROM bills ORDER BY id').all().map((bill) => bill.id),
    columns: db.getDb().pragma('table_info(cloud_instances)').map((column) => column.name),
  }));
}

const isWritableByItsOwner = (file) => (fs.statSync(file).mode & 0o200) !== 0;

describe('the copies of a read-only snapshot', () => {
  test('can be migrated by the server of each side', () => {
    withDataLayer(snapshotDir, fillSnapshot);
    makeReadOnly(snapshotDir);

    const side = serveSide();

    expect(isWritableByItsOwner(side.frozen)).toBe(true);
    expect(side.bills).toEqual(['FR0000001', 'FR0000002']);
    // Added back as the server started, which it could not in a read-only
    // copy (SQLITE_READONLY)
    expect(side.columns).toContain('plan_code');
    // The snapshot is left as it was
    expect(fs.readdirSync(snapshotDir)).toEqual([DB_FILE]);
    expect(fs.statSync(path.join(snapshotDir, DB_FILE)).mode & 0o777).toBe(0o444);
  });

  test('fold the journal of the snapshot back into the copy of each side', () => {
    // A snapshot whose journal was never folded back into its file: copied
    // while the import that wrote it still had it open, without its -shm index
    const live = path.join(work, 'live');
    withDataLayer(live, (db) => {
      fillSnapshot(db);
      fs.mkdirSync(snapshotDir);
      for (const file of [DB_FILE, `${DB_FILE}-wal`]) {
        fs.copyFileSync(path.join(live, file), path.join(snapshotDir, file));
      }
    });
    makeReadOnly(snapshotDir);

    const side = serveSide();

    // Without the journal, the side's copy would hold no bill
    expect(side.bills).toEqual(['FR0000001', 'FR0000002']);
    expect(side.columns).toContain('plan_code');
    expect(fs.readdirSync(snapshotDir)).toEqual([DB_FILE, `${DB_FILE}-wal`]);
  });
});
