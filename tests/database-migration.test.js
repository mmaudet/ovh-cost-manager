/**
 * The migrations that getDb() applies to the database that it opens (data/db.js). The
 * server and the import open the same database, and the import writes to it for long: a
 * migration takes the write lock only when it has something to migrate.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');

const DATA_LAYER = path.resolve(__dirname, '..', 'data', 'db.js');

let dataDir;
const previousDataDir = process.env.DATA_DIR;

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ocm-migration-'));
});

afterEach(() => {
  fs.rmSync(dataDir, { recursive: true, force: true });
});

afterAll(() => {
  if (previousDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = previousDataDir;
});

// Opens the database of the throwaway directory through a data layer of its own, as a
// process that starts does, and hands it to `use`. data/db.js reads DATA_DIR when it is first
// required.
function openDatabase(use = () => {}) {
  process.env.DATA_DIR = dataDir;
  jest.isolateModules(() => {
    const db = require(DATA_LAYER);
    try {
      db.getDb();
      use(db);
    } finally {
      db.closeDb();
    }
  });
}

// A connection that holds the write lock, as the import does while it writes a bill
function holdWriteLock() {
  const writer = new Database(path.join(dataDir, 'ovh-bills.db'));
  writer.exec('BEGIN IMMEDIATE');
  return () => {
    writer.exec('ROLLBACK');
    writer.close();
  };
}

test('opens a database that it migrated before without taking the write lock', () => {
  openDatabase();
  const release = holdWriteLock();
  try {
    expect(() => openDatabase()).not.toThrow();
  } finally {
    release();
  }
}, 15000);
