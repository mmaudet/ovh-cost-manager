#!/usr/bin/env node
/**
 * Prints the number of bills in the database, for scripts/cron-import.sh.
 *
 * At start, the container runs a full import, which clears the database, only
 * when there is no bill. This reads the database of data/db.js (DATA_DIR)
 * directly: the API routes need a login once authentication is on.
 *
 * When the database cannot be read, prints nothing on stdout and exits with 1.
 */

const db = require('./db');

try {
  const { count } = db.getDb().prepare('SELECT COUNT(*) AS count FROM bills').get();
  console.log(count);
} catch (err) {
  console.error(`Cannot count the bills: ${err.message}`);
  process.exitCode = 1;
} finally {
  db.closeDb();
}
