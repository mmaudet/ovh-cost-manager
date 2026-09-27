/**
 * The migrations that getDb() applies to the database that it opens (data/db.js). The
 * server and the import open the same database, and the import writes to it for long: a
 * migration takes the write lock only when it has something to migrate.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const ownership = require('../data/ownership');

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

describe('the new key of a table (rekeyTable)', () => {
  // A table of notes keyed by their id alone, as an earlier version created it, with an index
  // and a column that the schema of now has too, whatever list of columns the code holds
  function notesOfBefore() {
    const database = new Database(':memory:');
    database.exec('CREATE TABLE notes (id TEXT PRIMARY KEY, body TEXT, added TEXT, owner TEXT)');
    database.exec('CREATE INDEX idx_notes_added ON notes(added)');
    const note = database.prepare('INSERT INTO notes (rowid, id, body, added, owner) VALUES (?, ?, ?, ?, ?)');
    note.run(3, 'n1', 'First', '2026-09-01', 'xx1111-ovh');
    note.run(7, 'n2', 'Second', '2026-09-02', null);
    return database;
  }

  // The schema of now: the notes keyed by their owner and their id
  const SCHEMA = `
CREATE TABLE IF NOT EXISTS notes (
  id TEXT,
  body TEXT,
  added TEXT,
  owner TEXT,
  PRIMARY KEY (owner, id)
);
CREATE INDEX IF NOT EXISTS idx_notes_added ON notes(added);
`;

  test('moves every row, with its rowid and every column, to the table the schema defines',
    () => {
      const database = notesOfBefore();

      ownership.rekeyTable(database, SCHEMA, 'notes');

      expect(database.pragma('table_info(notes)').map(({ name, pk }) => [name, pk])).toEqual([
        ['id', 2], ['body', 0], ['added', 0], ['owner', 1],
      ]);
      expect(database.prepare('SELECT rowid, * FROM notes ORDER BY rowid').all()).toEqual([
        { rowid: 3, id: 'n1', body: 'First', added: '2026-09-01', owner: 'xx1111-ovh' },
        { rowid: 7, id: 'n2', body: 'Second', added: '2026-09-02', owner: null },
      ]);
      expect(database.prepare("SELECT name, tbl_name FROM sqlite_master WHERE type <> 'table'")
        .all()).toEqual(expect.arrayContaining([{ name: 'idx_notes_added', tbl_name: 'notes' }]));
      expect(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").pluck().all())
        .toEqual(['notes']);
    });

  test('fails on a table that the schema does not define', () => {
    expect(() => ownership.rekeyTable(notesOfBefore(), SCHEMA, 'bills'))
      .toThrow('schema.sql defines no table bills');
  });
});
