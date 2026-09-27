/**
 * Which account each row of the database belongs to (#112, #114, ADR 0002), and the rows that
 * an import gives to an account, takes over for one, or clears. Each row fed by the OVH API
 * carries the NIC handle of its account, directly or through its bill or its project. The
 * rows stored before the accounts carry none: they are the Unknown account's (see CONTEXT.md)
 * until an account claims them.
 *
 * Each function takes the database first, as data/db.js's getDb() opens it: data/db.js hands
 * it to them, and exposes them on its accounts operations.
 */

// The tables fed by the OVH API whose rows belong to no bill or project: each row holds the
// NIC handle of its account in an `account` column, which tells the accounts of one database
// apart (#112). The other rows find their account through their bill (the bill lines) or
// their project (the instances, volumes, snapshots, buckets, consumption and quotas of a
// Public Cloud project).
const ACCOUNT_TABLES = [
  'bills', 'projects', 'dedicated_servers', 'vps_instances', 'storage_services',
  'account_balance', 'consumption_snapshots', 'consumption_history', 'credit_movements',
];

// The tables of the services that an account's API lists: its Public Cloud projects, dedicated
// servers, VPS and NetApp storage services. The APIs of two accounts can both list one, such
// as a server whose technical contact is one account and whose billing is another's. It is
// stored once, and belongs to the account whose bill lines name it, or else to the first
// configured account that lists it: the writers of these tables never change the account of
// a service that an account holds, and the accounts are imported in the order of the
// configuration. A writer gives a service stored before the accounts, without one, to the
// account that lists it. Then, once the account's bills are stored, takeOverBilledRows()
// gives it the services that it lists and bills.
const LISTED_SERVICE_TABLES = ['projects', 'dedicated_servers', 'vps_instances', 'storage_services'];

// The resources of a Public Cloud project, which reach their account through their project
const PROJECT_RESOURCE_TABLES = [
  'cloud_instances', 'project_quotas', 'object_storage_buckets', 'cloud_volumes',
  'cloud_snapshots',
];

// The tables of the balance and consumption snapshots, of which only the latest is read
const SNAPSHOT_TABLES = ['account_balance', 'consumption_snapshots'];

// The tables that a full import fetches again whole, and clears first: those whose rows carry
// the account, but the bills, which go with their lines, and the projects, which the
// consumption of their past months keeps
const REFETCHED_TABLES = ACCOUNT_TABLES.filter(table => !['bills', 'projects'].includes(table));

/**
 * The condition that a column's value is one of a list of ids, which the OVH API gives, to
 * join with AND to a WHERE clause, and its parameters. The ids compare as text, as the tables
 * store them: json_each() gives a number as an integer, which no text equals.
 * @param {string} column - The column that holds the ids
 * @param {Array<string|number>} ids - The list
 * @returns {{ sql: string, params: string[] }}
 */
function idInList(column, ids) {
  return {
    sql: `${column} IN (SELECT CAST(value AS TEXT) FROM json_each(?))`,
    params: [JSON.stringify(ids)],
  };
}

// The columns of a table, as PRAGMA table_info gives them
const columnsOf = (database, table) => database.pragma(`table_info(${table})`)
  .map(({ name }) => name);

/**
 * @param {object} database - The database
 * @param {string} table - A table
 * @param {string} column - A column
 * @returns {boolean} Whether the column is not part of the table's key, or does not exist:
 *   whether the table still has the key it had before its key held the account (#114)
 */
function keyLacks(database, table, column) {
  return !database.pragma(`table_info(${table})`)
    .some(({ name, pk }) => name === column && pk > 0);
}

/**
 * Gives a table the key that the schema defines for it now, which SQLite cannot change in
 * place (#114). In the order that SQLite documents for such a change: it creates the table as
 * the schema defines it under a temporary name, copies the rows into it, with their rowids,
 * drops the table, and renames the new one; the schema then creates its indexes again. The
 * columns copied are those that both forms have, as PRAGMA table_info gives them. No foreign
 * key references the tables rekeyed. To run in a transaction, which data/db.js takes only
 * when the table still has its former key.
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
  const inBoth = new Set(columnsOf(database, rekeyed));
  const columns = columnsOf(database, table).filter(column => inBoth.has(column)).join(', ');
  database.exec(`INSERT INTO ${rekeyed} (rowid, ${columns}) SELECT rowid, ${columns} FROM ${table}`);
  database.exec(`DROP TABLE ${table}`);
  database.exec(`ALTER TABLE ${rekeyed} RENAME TO ${table}`);
  database.exec(schema);
}

/**
 * Gives the account every row of ACCOUNT_TABLES that has none, and the import state recorded
 * without one. The writers refuse a row without an account, so these are the rows stored
 * before the accounts: in a database that was the account's alone, they can only be its own.
 * A row whose key the account has since recorded, such as the month of its current
 * consumption, keeps none.
 * @param {object} database - The database
 * @param {string} nic - The NIC handle of the account
 * @returns {number} How many rows it gave the account
 */
function attributeRowsWithoutAccount(database, nic) {
  const attribute = database.transaction(() => [...ACCOUNT_TABLES, 'import_state']
    .reduce((attributed, table) => attributed + database
      .prepare(`UPDATE OR IGNORE ${table} SET account = ? WHERE account IS NULL`)
      .run(nic).changes, 0));
  return attribute();
}

/**
 * @param {object} database - The database
 * @param {string} nic - The NIC handle of an account
 * @returns {boolean} Whether the database has never known another account: the accounts
 *   table records no other NIC handle. Its rows without an account can then only be that
 *   account's, stored before the accounts.
 */
function isOnlyAccount(database, nic) {
  return database
    .prepare('SELECT NOT EXISTS (SELECT 1 FROM accounts WHERE nic <> ?) AS only')
    .get(nic).only === 1;
}

/**
 * @param {object} database - The database
 * @param {string} [table] - One of ACCOUNT_TABLES, or all of them when none is given
 * @returns {boolean} Whether it holds rows without an account: rows stored before the
 *   accounts that no account has claimed, which are the Unknown account's
 */
function hasRowsWithoutAccount(database, table) {
  return (table === undefined ? ACCOUNT_TABLES : [table]).some(name => database
    .prepare(`SELECT EXISTS (SELECT 1 FROM ${name} WHERE account IS NULL) AS found`)
    .get().found === 1);
}

/**
 * Gives the account the bills without an account that its API lists: the bills stored
 * before the accounts are each account's whose full bill list names them. Those that no
 * account lists keep none. The account's count of claimed bills records the claims, over
 * every run, for attributeToSoleClaimer().
 * @param {object} database - The database
 * @param {string} nic - The NIC handle of the account, which the accounts table records
 * @param {Array<string>} billIds - Every bill that its API lists, by number
 * @returns {number} How many it claimed
 */
function claimBills(database, nic, billIds) {
  const listed = idInList('id', billIds);
  const claim = database.transaction(() => {
    const claimed = database.prepare(`
      UPDATE bills SET account = ? WHERE account IS NULL AND ${listed.sql}
    `).run(nic, ...listed.params).changes;
    database.prepare('UPDATE accounts SET claimed_bills = claimed_bills + ? WHERE nic = ?')
      .run(claimed, nic);
    return claimed;
  });
  return claim();
}

/**
 * Gives every row without an account to the account that claimed every bill stored before
 * the accounts, once no bill is left without an account and no other account claimed any:
 * the version before the accounts imported the single account that OCM took the credentials
 * of, so the database was that account's. Its consumption history, its credit movements and
 * the rest then go to it, which its own import replaces rather than adds.
 * @param {object} database - The database
 * @returns {?{nic: string, attributed: number}} The account and how many rows it got, or
 *   null when nothing tells that the database was one account's, or no row is left
 */
function attributeToSoleClaimer(database) {
  if (hasRowsWithoutAccount(database, 'bills')) return null;
  const claimers = database.prepare('SELECT nic FROM accounts WHERE claimed_bills > 0')
    .pluck().all();
  if (claimers.length !== 1) return null;
  const [nic] = claimers;
  const attributed = attributeRowsWithoutAccount(database, nic);
  return attributed > 0 ? { nic, attributed } : null;
}

/**
 * Gives the account the credit movement without an account that is this very movement of
 * its API: the same id, which joins the name of its balance and its number, the same date and
 * the same amount. Two accounts' balances can share a name, and their movements the same ids:
 * another account's movement, which has another date or amount, is never claimed. One whose
 * key the account already has keeps none.
 * @param {object} database - The database
 * @param {object} movement - The movement as the import stores it: its `id`, `date`,
 *   `amount`, and `account`, the NIC handle of the account
 * @returns {boolean} Whether it claimed one
 */
function claimCreditMovement(database, { id, date, amount, account }) {
  return database.prepare(`
    UPDATE OR IGNORE credit_movements SET account = @account
    WHERE account IS NULL AND id = @id AND date IS @date AND amount = @amount
  `).run({ id, date, amount, account }).changes > 0;
}

/**
 * Deletes the balance and consumption snapshots without an account: no account can claim the
 * account-wide figures stored before the accounts, of which only the latest is read. Each
 * account's import records its own.
 * @param {object} database - The database
 * @returns {number} How many it deleted
 */
function deleteSnapshotsWithoutAccount(database) {
  const remove = database.transaction(() => SNAPSHOT_TABLES.reduce((deleted, table) =>
    deleted + database.prepare(`DELETE FROM ${table} WHERE account IS NULL`).run().changes, 0));
  return remove();
}

/**
 * Gives the account the services that its API lists but that another account holds, when the
 * latest bill with a line that names them, by its domain, is the account's: a service that
 * two accounts' APIs list belongs to the account that bills it (see LISTED_SERVICE_TABLES).
 * The import runs it once the account's bills are stored: they may name a service that an
 * account imported before it stored first.
 * @param {object} database - The database
 * @param {string} nic - The NIC handle of the account
 * @param {Object<string, Array<string|number>>} listed - The ids of the services that its API
 *   lists, by the table that stores them, one of LISTED_SERVICE_TABLES
 * @returns {number} How many services it took over
 * @throws {Error} For a table that is not one of LISTED_SERVICE_TABLES
 */
function takeOverBilledRows(database, nic, listed) {
  const billedBy = database.prepare(`
    SELECT b.account FROM bill_details d JOIN bills b ON b.id = d.bill_id
    WHERE d.domain = ? AND b.account IS NOT NULL
    ORDER BY b.date DESC, b.id DESC
    LIMIT 1
  `);
  const takeOver = database.transaction(() => {
    let taken = 0;
    for (const [table, ids] of Object.entries(listed)) {
      if (!LISTED_SERVICE_TABLES.includes(table)) throw new Error(`${table} stores no service`);
      // Those that another account holds, which few are: the bills are read for them only
      const ofList = idInList('id', ids);
      const heldByOthers = database.prepare(`
        SELECT id FROM ${table} WHERE account <> ? AND ${ofList.sql}
      `).all(nic, ...ofList.params);
      const give = database.prepare(`UPDATE ${table} SET account = ? WHERE id = ?`);
      for (const { id } of heldByOthers) {
        if (billedBy.get(id)?.account === nic) taken += give.run(nic, id).changes;
      }
    }
    return taken;
  });
  return takeOver();
}

// Clears what a full import fetches again, of the rows whose account the condition on the
// `account` column keeps: the bills and their lines, the resources of the projects, the
// projects but those that the consumption of their past months needs, or that bill lines
// reference, and the rows of REFETCHED_TABLES. The consumption of the projects, which OVH
// gives for the current month only (#54), and the month of its last import, stay.
function clearRefetched(database, { sql, params }) {
  const run = (statement) => database.prepare(statement).run(...params);
  // First the rows that reference the bills and the projects
  run(`DELETE FROM bill_details WHERE bill_id IN (SELECT id FROM bills WHERE ${sql})`);
  for (const table of PROJECT_RESOURCE_TABLES) {
    run(`DELETE FROM ${table} WHERE project_id IN (SELECT id FROM projects WHERE ${sql})`);
  }
  run(`DELETE FROM bills WHERE ${sql}`);
  run(`
    DELETE FROM projects WHERE ${sql}
      AND id NOT IN (SELECT project_id FROM project_consumption)
      AND id NOT IN (SELECT project_id FROM bill_details WHERE project_id IS NOT NULL)
  `);
  for (const table of REFETCHED_TABLES) run(`DELETE FROM ${table} WHERE ${sql}`);
}

/**
 * Clears the imported data of an account, for a full import of it: its bills and their
 * lines, its inventories, the resources of its projects, its balance and consumption
 * snapshots, its credit movements and its consumption history, which the import fetches
 * again. What it cannot fetch again is kept, as clearAll() keeps it: the consumption of each
 * of its projects, with the month of its last import and the projects it belongs to. Another
 * account's data, and the rows without an account, stay, with the projects of this account
 * whose lines are on another account's bills.
 * @param {object} database - The database
 * @param {string} nic - The NIC handle of the account
 */
function clearAccount(database, nic) {
  clearRefetched(database, { sql: 'account = ?', params: [nic] });
}

/**
 * Clears the imported data of every account and of the Unknown account, as clearAccount()
 * clears one account's, and the log of the imports: a database as a first full import finds
 * it, which the tests start from.
 * @param {object} database - The database
 */
function clearAll(database) {
  clearRefetched(database, { sql: '1 = 1', params: [] });
  database.exec('DELETE FROM import_log');
}

module.exports = {
  ACCOUNT_TABLES,
  LISTED_SERVICE_TABLES,
  idInList,
  keyLacks,
  rekeyTable,
  attributeRowsWithoutAccount,
  isOnlyAccount,
  hasRowsWithoutAccount,
  claimBills,
  attributeToSoleClaimer,
  claimCreditMovement,
  deleteSnapshotsWithoutAccount,
  takeOverBilledRows,
  clearAccount,
  clearAll,
};
