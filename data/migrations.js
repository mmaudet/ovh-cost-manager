/**
 * The migrations that data/db.js's getDb() applies to a database that an earlier version
 * created: what reads the form of a table, adds a column, gives a table a new key, and runs a
 * migration that writes only when the database needs it. There is no migration framework:
 * schema.sql creates what is missing, and these bring the tables that exist to its form.
 */

// The columns of a table, as PRAGMA table_info gives them: their name, and their place in
// the key (pk), 0 when they are not part of it
const tableInfo = (database, table) => database.pragma(`table_info(${table})`);

/**
 * @param {object} database - The database
 * @param {string} table - A table
 * @param {string} column - A column
 * @returns {boolean} Whether the table has the column
 */
function hasColumn(database, table, column) {
  return tableInfo(database, table).some(({ name }) => name === column);
}

/**
 * Safely add a column to a table if it doesn't exist
 * @param {object} database - The database
 * @param {string} table - The table
 * @param {string} column - The column
 * @param {string} type - Its type, and its default or its constraints, if any
 * @returns {boolean} Whether it added the column
 */
function addColumnIfNotExists(database, table, column, type) {
  if (hasColumn(database, table, column)) return false;
  database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  return true;
}

/**
 * @param {object} database - The database
 * @param {string} table - A table
 * @param {string} column - A column
 * @returns {boolean} Whether the column is not part of the table's key, or does not exist:
 *   whether the table still has the key it had before its key held the account (#114)
 */
function keyLacks(database, table, column) {
  return !tableInfo(database, table).some(({ name, pk }) => name === column && pk > 0);
}

/**
 * Runs a migration that writes, when it is needed: it reads first, whether it is, and only
 * then takes the write lock, under which it checks again, as the server and the import may
 * open an old database together. A database already migrated opens without the write lock,
 * which the import may hold while it writes (#114).
 * @param {object} database - The database
 * @param {function(): boolean} needed - Whether the migration is needed
 * @param {function()} migrate - The migration
 */
function migrateWhenNeeded(database, needed, migrate) {
  if (!needed()) return;
  database.transaction(() => {
    if (needed()) migrate();
  }).immediate();
}

/**
 * Gives a table the key that the schema defines for it now, which SQLite cannot change in
 * place (#114). In the order that SQLite documents for such a change: it creates the table as
 * the schema defines it under a temporary name, copies the rows into it, with their rowids,
 * drops the table, and renames the new one; the schema then creates its indexes again. The
 * columns copied are those that both forms have, as PRAGMA table_info gives them. No foreign
 * key references the tables rekeyed. To run in a transaction: see migrateWhenNeeded().
 * @param {object} database - The database
 * @param {string} schema - The text of schema.sql, which creates each table if it does not
 *   exist
 * @param {string} table - The table
 * @throws {Error} When the schema does not define the table
 */
function rekeyTable(database, schema, table) {
  const definition = schema.match(
    new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\(([\\s\\S]*?)\\n\\);`),
  );
  if (!definition) throw new Error(`schema.sql defines no table ${table}`);
  const rekeyed = `${table}_rekeyed`;
  database.exec(`CREATE TABLE ${rekeyed} (${definition[1]}\n)`);
  const inBoth = new Set(tableInfo(database, rekeyed).map(({ name }) => name));
  const columns = tableInfo(database, table).map(({ name }) => name)
    .filter(column => inBoth.has(column)).join(', ');
  database.exec(`
    INSERT INTO ${rekeyed} (rowid, ${columns}) SELECT rowid, ${columns} FROM ${table}
  `);
  database.exec(`DROP TABLE ${table}`);
  database.exec(`ALTER TABLE ${rekeyed} RENAME TO ${table}`);
  database.exec(schema);
}

module.exports = { addColumnIfNotExists, hasColumn, keyLacks, migrateWhenNeeded, rekeyTable };
