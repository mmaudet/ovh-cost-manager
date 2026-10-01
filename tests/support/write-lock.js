/**
 * The write lock of a test's database, which the test holds as the import does while it stores
 * a bill (#114): the server or the import that opens the database meanwhile may read it, but
 * must neither take that lock nor wait for it, as long as it has nothing to migrate.
 */

const path = require('path');
const Database = require('better-sqlite3');

/**
 * Holds the write lock of the database of a DATA_DIR, through a connection of its own, until
 * the function that it returns releases it.
 * @param {string} dataDir - The DATA_DIR, which holds ovh-bills.db
 * @returns {function()} What releases the lock, and closes the connection
 */
function holdWriteLock(dataDir) {
  const writer = new Database(path.join(dataDir, 'ovh-bills.db'));
  writer.exec('BEGIN IMMEDIATE');
  return () => {
    writer.exec('ROLLBACK');
    writer.close();
  };
}

module.exports = { holdWriteLock };
