/**
 * Which account each row of the database belongs to (#112, #114, ADR 0002): the rules by which
 * an import gives rows to an account, takes them over for one, or clears them. Each row fed by
 * the OVH API carries the NIC handle of its account, directly or through its bill or its
 * project. The rows stored before the accounts carry none: they are the Unknown account's (see
 * CONTEXT.md) until an account claims them.
 *
 * Each function takes the database first, as data/db.js's getDb() opens it: data/db.js hands
 * it to them, and exposes them on its accounts operations.
 */

const { UNKNOWN_ACCOUNT, accountCondition, idInList } = require('./sql-conditions');

// The condition that keeps the rows without an account: the Unknown account's
const WITHOUT_ACCOUNT = accountCondition(UNKNOWN_ACCOUNT, 'account');

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
const LISTED_SERVICE_TABLES = [
  'projects', 'dedicated_servers', 'vps_instances', 'storage_services',
];

// The resources of a Public Cloud project, and its month-end forecasts (#224), which reach
// their account through their project, and which the import with the cloud details fetches
// again: OVH gives the forecast of the current month, and those of the months before are of
// no use
const PROJECT_RESOURCE_TABLES = [
  'cloud_instances', 'project_quotas', 'object_storage_buckets', 'cloud_volumes',
  'cloud_snapshots', 'project_forecasts',
];

// The tables of the balance and consumption snapshots, of which only the latest is read
const SNAPSHOT_TABLES = ['account_balance', 'consumption_snapshots'];

// The import state that an import recorded for its account before the accounts, which has
// none: the month of the current consumption, and not the marks of the database, which have
// no account either
const ofAccountState = idInList('key', ['consumption_month']);
const ACCOUNT_STATE_WITHOUT_ACCOUNT = {
  sql: `${WITHOUT_ACCOUNT.sql} AND ${ofAccountState.sql}`,
  params: [...WITHOUT_ACCOUNT.params, ...ofAccountState.params],
};

// The key of the import state that marks a database whose configuration listed several
// entries at a run, whether their GET /me answered or not: the database may hold several
// accounts' rows since. It has no account, and stays.
const SEVERAL_ACCOUNTS = 'several_accounts';

// The tables that a full import fetches again whole, and clears first: those whose rows carry
// the account, but the bills, which go with their lines, and the projects, which the
// consumption of their past months keeps
const REFETCHED_TABLES = ACCOUNT_TABLES.filter(table => !['bills', 'projects'].includes(table));

/**
 * Gives the account every row of ACCOUNT_TABLES that has none, and the import state recorded
 * without one. The writers refuse a row without an account, so these are the rows stored
 * before the accounts: in a database that was the account's alone, which a rule of ADR 0002
 * has established, they can only be its own. A row whose key the account has since stored
 * itself, such as a credit movement that its import fetched again, or the month of its
 * current consumption, is its own older copy: it is deleted, rather than left to the Unknown
 * account as a copy.
 * @param {object} database - The database
 * @param {string} nic - The NIC handle of the account
 * @returns {number} How many rows it gave the account, without the copies it deleted
 */
function attributeRowsWithoutAccount(database, nic) {
  const give = (table, rows) => {
    const given = database.prepare(`
      UPDATE OR IGNORE ${table} SET account = ? WHERE ${rows.sql}
    `).run(nic, ...rows.params).changes;
    // Those left share their key with a row that the account holds: its own older copies
    database.prepare(`DELETE FROM ${table} WHERE ${rows.sql}`).run(...rows.params);
    return given;
  };
  const attribute = database.transaction(() => ACCOUNT_TABLES.reduce(
    (attributed, table) => attributed + give(table, WITHOUT_ACCOUNT),
    give('import_state', ACCOUNT_STATE_WITHOUT_ACCOUNT),
  ));
  return attribute();
}

/**
 * Marks that a run's configuration listed several entries, whether their GET /me answered or
 * not: the database may hold several accounts' rows since, and isOnlyAccount() no longer
 * tells that it has known one account alone. Once marked, it stays so.
 * @param {object} database - The database
 */
function markSeveralAccounts(database) {
  database.prepare(`
    INSERT INTO import_state (key, value, account)
    SELECT ?, 'yes', NULL WHERE NOT EXISTS (SELECT 1 FROM import_state WHERE key = ?)
  `).run(SEVERAL_ACCOUNTS, SEVERAL_ACCOUNTS);
}

/**
 * @param {object} database - The database
 * @param {string} nic - The NIC handle of an account
 * @returns {boolean} Whether the database has only ever known that account: no run's
 *   configuration listed several entries (see markSeveralAccounts()), and the accounts table
 *   records no other NIC handle. Its rows without an account can then only be that
 *   account's, stored before the accounts. An account whose GET /me never answered is in no
 *   table, but its entry marked the database.
 */
function isOnlyAccount(database, nic) {
  return database.prepare(`
    SELECT NOT EXISTS (SELECT 1 FROM accounts WHERE nic <> ?)
      AND NOT EXISTS (SELECT 1 FROM import_state WHERE key = ?) AS only
  `).get(nic, SEVERAL_ACCOUNTS).only === 1;
}

/**
 * @param {object} database - The database
 * @param {string} [table] - One of ACCOUNT_TABLES, or all of them when none is given
 * @returns {boolean} Whether it holds rows without an account: rows stored before the
 *   accounts that no account has claimed, which are the Unknown account's
 */
function hasRowsWithoutAccount(database, table) {
  return (table === undefined ? ACCOUNT_TABLES : [table]).some(name => database
    .prepare(`SELECT EXISTS (SELECT 1 FROM ${name} WHERE ${WITHOUT_ACCOUNT.sql}) AS found`)
    .get(...WITHOUT_ACCOUNT.params).found === 1);
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
      UPDATE bills SET account = ? WHERE ${WITHOUT_ACCOUNT.sql} AND ${listed.sql}
    `).run(nic, ...WITHOUT_ACCOUNT.params, ...listed.params).changes;
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
    UPDATE OR IGNORE credit_movements SET account = ?
    WHERE ${WITHOUT_ACCOUNT.sql} AND id = ? AND date IS ? AND amount = ?
  `).run(account, ...WITHOUT_ACCOUNT.params, id, date, amount).changes > 0;
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
    deleted + database.prepare(`DELETE FROM ${table} WHERE ${WITHOUT_ACCOUNT.sql}`)
      .run(...WITHOUT_ACCOUNT.params).changes, 0));
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

/**
 * Clears the imported data of an account, for a full import of it: its bills and their
 * lines, its inventories, the resources and the forecasts of its projects, its balance and
 * consumption snapshots, its credit movements and its consumption history, which the import
 * fetches again. What it cannot fetch again is kept: the consumption of each of its projects,
 * which OVH gives for the current month only (#54), with the month of its last import and the
 * projects it belongs to. Another account's data, and the rows without an account, stay,
 * with the projects of this account whose lines are on another account's bills.
 * @param {object} database - The database
 * @param {string} nic - The NIC handle of the account
 */
function clearAccount(database, nic) {
  const { sql, params } = accountCondition(nic, 'account');
  const run = (statement) => database.prepare(statement).run(...params);
  // First the rows that reference its bills and its projects
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

module.exports = {
  ACCOUNT_TABLES,
  attributeRowsWithoutAccount,
  markSeveralAccounts,
  isOnlyAccount,
  hasRowsWithoutAccount,
  claimBills,
  attributeToSoleClaimer,
  claimCreditMovement,
  deleteSnapshotsWithoutAccount,
  takeOverBilledRows,
  clearAccount,
};
