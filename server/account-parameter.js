/**
 * The account parameter of the data routes (#115, ADR 0002): the account that a request asks
 * for, which the routes pass on to the queries of the data layer, where it keeps that
 * account's rows (data/db.js).
 *
 * - no parameter: every account, as before an instance imported several;
 * - a NIC handle that the accounts table records: that account;
 * - `unknown`, which no NIC handle reads: the Unknown account, the rows without an account.
 *
 * Any other value is refused.
 */

const { UNKNOWN_ACCOUNT } = require('../data/db');

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
 * Creates the middleware of the data routes that take the account parameter. It puts the
 * account that a request asks for in req.account, as the queries of the data layer take it:
 * null for every account, `unknown` for the Unknown account, or else a NIC handle. It
 * answers 400 to any other value.
 * @param {object} settings
 * @param {function(string): boolean} settings.isRecordedAccount - Whether the accounts table
 *   records a NIC handle
 * @returns {function} An Express middleware
 */
function createAccountParameterMiddleware({ isRecordedAccount }) {
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

module.exports = { createAccountParameterMiddleware };
