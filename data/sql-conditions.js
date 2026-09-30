/**
 * The conditions that the queries of the data layer join with AND to their WHERE clause, with
 * their parameters: those that keep the rows of an account (#115, ADR 0002), those that keep
 * the rows of a list of ids that the OVH API gives, and those that keep the bill lines of the
 * Veeam backups (#32, #197). data/db.js, which re-exports UNKNOWN_ACCOUNT, and
 * data/ownership.js build their queries with them. This module has no side effect: a test can
 * load it without data/db.js, which reads config.json when it loads without DATA_DIR.
 */

// The value that selects the Unknown account (see CONTEXT.md), the rows without an account,
// in the queries that can keep one account's rows and in the account parameter of the
// server's routes (#115). No NIC handle reads so.
const UNKNOWN_ACCOUNT = 'unknown';

/**
 * The condition that keeps the rows of an account in a query that can keep one account's
 * rows (#115, ADR 0002), to join with AND to its WHERE clause, and its parameters. Such a
 * query takes the account as the server's routes read it from their account parameter.
 * @param {?string} account - null for every account, UNKNOWN_ACCOUNT for the Unknown
 *   account, or else the NIC handle of an account
 * @param {string} column - The column of the query that holds the NIC handle of its rows'
 *   account: `b.account` for its bills, `p.account` for its projects
 * @returns {{ sql: string, params: string[] }} Always true for every account
 */
function accountCondition(account, column) {
  if (account === null) return { sql: '1 = 1', params: [] };
  if (account === UNKNOWN_ACCOUNT) return { sql: `${column} IS NULL`, params: [] };
  return { sql: `${column} = ?`, params: [account] };
}

/**
 * The condition that keeps the rows of the accounts that the configuration lists (#123), to
 * join with AND to a WHERE clause, and its parameters: once an import recorded the accounts
 * of its configuration, which the accounts table marks with their place in it, the rows of
 * those accounts; until then, as in a database not imported since the upgrade, every row. The
 * rows of the Unknown account, and of an account that config.json no longer lists, go: no
 * import refreshes them.
 * @param {string} column - The column of the query that holds the NIC handle of its rows'
 *   account
 * @returns {{ sql: string, params: string[] }}
 */
function configuredAccountsCondition(column) {
  const configured = 'SELECT nic FROM accounts WHERE position IS NOT NULL';
  return { sql: `(NOT EXISTS (${configured}) OR ${column} IN (${configured}))`, params: [] };
}

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

// The conditions that keep the bill lines of the Veeam backups, by what they pay for, each for
// the alias of the bill lines' table in the query, to join with AND to its WHERE clause, with
// their parameters: the VMs backed up, the lines of the backup resource type, and the
// Enterprise licences, the other lines whose description names Veeam and Enterprise. No line
// is both. The Veeam backups count their services (#32), which the Compare tab's backup
// comparison unfolds its two rows into (#197).
const ofBackupLines = {
  vms: (alias) => ({ sql: `${alias}.resource_type = ?`, params: ['backup'] }),
  // The Enterprise licences: the lines that name Veeam and Enterprise, but the VMs'. OVH bills
  // each VM that it backs up with Veeam Enterprise on one line, of the backup resource type,
  // "Veeam Backup Enterprise Rental for 1 month": the licence, rented for that VM, is its
  // backup, which the VMs count, not a charge of its own. Counted among the licences too, that
  // line doubled the cost of the backups (#223). IS NOT keeps the lines stored without a
  // resource type, which the VMs do not count.
  enterprise: (alias) => ({
    sql: `(LOWER(${alias}.description) LIKE ? AND LOWER(${alias}.description) LIKE ?
      AND ${alias}.resource_type IS NOT ?)`,
    params: ['%veeam%', '%enterprise%', 'backup'],
  }),
};

module.exports = {
  UNKNOWN_ACCOUNT, accountCondition, configuredAccountsCondition, idInList, ofBackupLines,
};
