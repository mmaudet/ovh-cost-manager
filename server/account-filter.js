/**
 * The account filter of the data routes (#115, ADR 0002): the account that a request asks
 * for, from its optional `account` parameter, and the SQL condition that keeps that
 * account's rows.
 *
 * - no parameter: every account, as before an instance imported several;
 * - a NIC handle that the accounts table records: that account;
 * - `unknown`, which no NIC handle reads: the Unknown account, the rows without an account.
 *
 * Any other value is refused. The routes built on bills filter on the bill's account, and
 * those built on projects on the project's: accountFilter() takes the column that holds it.
 */

// The value of the parameter that selects the Unknown account
const UNKNOWN_ACCOUNT = 'unknown';

const REFUSAL = "Invalid 'account' parameter: expected the NIC handle of an account, or unknown";

// The account that the parameter's value names: { account }, null for every account when
// there is no value, or { error } when it names none. A repeated parameter reads as an array.
function readAccount(value, isRecordedAccount) {
  if (value === undefined) return { account: null };
  if (value === UNKNOWN_ACCOUNT) return { account: UNKNOWN_ACCOUNT };
  if (typeof value === 'string' && isRecordedAccount(value)) return { account: value };
  return { error: REFUSAL };
}

/**
 * The middleware of the data routes that take the account parameter: it puts the account
 * that the request asks for in req.account, or answers 400.
 * @param {function(string): boolean} isRecordedAccount - Whether the accounts table records
 *   a NIC handle
 * @returns {function} An Express middleware. req.account is null for every account,
 *   UNKNOWN_ACCOUNT for the Unknown account, or else a NIC handle.
 */
function accountParameter(isRecordedAccount) {
  return (req, res, next) => {
    let read;
    try {
      read = readAccount(req.query.account, isRecordedAccount);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
    if (read.error) {
      return res.status(400).json({ error: read.error });
    }
    req.account = read.account;
    return next();
  };
}

/**
 * The condition that keeps the rows of an account, to join with AND to the WHERE clause of
 * a query, and its parameters.
 * @param {?string} account - The account, as req.account holds it: null for every account
 * @param {string} column - The column of the query that holds the NIC handle of the rows'
 *   account, which the code names, never the request: `b.account` for the bills, as the
 *   queries of the data layer name them, `p.account` for the projects
 * @returns {{ sql: string, params: string[] }} Always true for every account
 */
function accountFilter(account, column) {
  if (account === null) return { sql: '1 = 1', params: [] };
  if (account === UNKNOWN_ACCOUNT) return { sql: `${column} IS NULL`, params: [] };
  return { sql: `${column} = ?`, params: [account] };
}

module.exports = { UNKNOWN_ACCOUNT, accountParameter, accountFilter };
