/**
 * Databases as earlier versions left them, for the tests of their migration: the next getDb()
 * of the import or of the server migrates them, as it does after an upgrade. Each function
 * takes the database as data/db.js's getDb() gives it, and keeps its rows.
 */

// The tables fed by the OVH API whose rows carry the NIC handle of their account since #112
const ROOT_TABLES = [
  'bills', 'projects', 'dedicated_servers', 'vps_instances', 'storage_services',
  'account_balance', 'consumption_snapshots', 'consumption_history', 'credit_movements',
];

// The credit movements as the versions before #114 created them: keyed by their id alone,
// which is unique within an account only. The account came last, added by #112.
const CREDIT_MOVEMENTS_BEFORE_114 = `
  CREATE TABLE credit_movements (
    id TEXT PRIMARY KEY,
    balance_name TEXT NOT NULL,
    amount REAL,
    date DATETIME,
    description TEXT,
    movement_type TEXT,
    imported_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    account TEXT
  )`;

// The import state as the versions before #114 created it: one value for each key, whatever
// the account
const IMPORT_STATE_BEFORE_114 = `
  CREATE TABLE import_state (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`;

// Gives a table the definition `create`, keeping these columns of its rows, and their rowids:
// SQLite cannot change the key of a table in place. Its explicit indexes go with it.
function redefine(database, table, create, columns) {
  const indexes = database.prepare(`
    SELECT sql FROM sqlite_master WHERE type = 'index' AND tbl_name = ? AND sql IS NOT NULL
  `).all(table).map(({ sql }) => sql);
  const list = columns.join(', ');
  database.exec(`ALTER TABLE ${table} RENAME TO ${table}_of_now`);
  database.exec(create);
  database.exec(`INSERT INTO ${table} (rowid, ${list}) SELECT rowid, ${list} FROM ${table}_of_now`);
  database.exec(`DROP TABLE ${table}_of_now`);
  for (const sql of indexes) database.exec(sql);
}

const hasColumn = (database, table, column) =>
  database.pragma(`table_info(${table})`).some(({ name }) => name === column);

/**
 * Makes the database one that the version before #114 left: the credit movements keyed by
 * their id alone, the import state by its key alone, which drops the account of its rows, and
 * the accounts without their place in the configuration. The rows must not repeat a key of
 * those versions: one credit movement for each id, and one import state for each key.
 * @param {object} database - A better-sqlite3 database
 */
function asBefore114(database) {
  redefine(database, 'credit_movements', CREDIT_MOVEMENTS_BEFORE_114, [
    'id', 'balance_name', 'amount', 'date', 'description', 'movement_type', 'imported_at',
    'account',
  ]);
  redefine(database, 'import_state', IMPORT_STATE_BEFORE_114, ['key', 'value', 'updated_at']);
  if (hasColumn(database, 'accounts', 'position')) {
    database.exec('ALTER TABLE accounts DROP COLUMN position');
  }
}

/**
 * Makes the database one that the version before the accounts (#112) wrote: as before #114,
 * and besides, no row carries an account, and there is no accounts table.
 * @param {object} database - A better-sqlite3 database
 */
function asBeforeAccounts(database) {
  asBefore114(database);
  for (const table of ROOT_TABLES) {
    database.exec(`ALTER TABLE ${table} DROP COLUMN account`);
  }
  database.exec('DROP TABLE accounts');
}

module.exports = { ROOT_TABLES, asBefore114, asBeforeAccounts };
