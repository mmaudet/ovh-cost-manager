/**
 * The attempts of one run of the import at the accounts of the configuration (#113): one for
 * each entry, whose account GET /me names, and which the run marks with what fails it. These
 * functions decide which attempts fail before any import, and how the messages name them.
 *
 * A configuration has several accounts when its accounts section lists more than one entry,
 * whatever the run imports of them: the run then checks their currencies, and its messages
 * name each account.
 */

const { describeError } = require('./ovh-errors');

/**
 * @typedef {object} AccountAttempt
 * @property {object} entry - Its entry of the configuration, as data/accounts-config.js reads
 *   it: its label, name, budget and credentials
 * @property {string} [nic] - The NIC handle of its account, once GET /me has named it
 * @property {string} [lastNic] - When its GET /me failed, the NIC handle of the account that
 *   an import last recorded with its entry's name: the account that the entry last led to
 * @property {?string} [currency] - The code of the currency its account bills in
 * @property {object} [client] - The OVH API client of its credentials
 * @property {*} [error] - What fails it, if anything: the error of its GET /me or of its
 *   import, or the refusal of its currency, which markOtherCurrencies() sets
 */

// Why an attempt, or a run, failed: the message of its error, or else the error described
function reasonOf(err) {
  return err?.message || describeError(err);
}

// 'a', 'a and b', 'a, b and c'
function joinWithAnd(items) {
  return items.length > 1 ? `${items.slice(0, -1).join(', ')} and ${items.at(-1)}` : items[0];
}

/**
 * @param {AccountAttempt} attempt
 * @returns {string} The attempt as the messages name it: its entry, by its name or its place,
 *   and the NIC handle of its account once GET /me has named it
 */
function describeAccount(attempt) {
  return attempt.nic ? `${attempt.entry.label} (${attempt.nic})` : attempt.entry.label;
}

/**
 * Fails the run when two entries lead to the same account: it would import it twice, and
 * could not tell which name or budget is its own. Checked before the run imports anything.
 * @param {AccountAttempt[]} attempts - Every attempt of the run
 * @param {string} source - The configuration file, which the error names
 * @throws {Error} naming the entries of each account that several entries lead to
 */
function throwIfSameAccount(attempts, source) {
  const labelsByNic = new Map();
  for (const attempt of attempts.filter(({ nic }) => nic)) {
    labelsByNic.set(attempt.nic, [...(labelsByNic.get(attempt.nic) || []), attempt.entry.label]);
  }
  const repeated = [...labelsByNic].filter(([, labels]) => labels.length > 1);
  if (repeated.length > 0) {
    throw new Error(repeated.map(([nic, labels]) =>
      `${joinWithAnd(labels)} in ${source} are the same account, ${nic}: list each account once`,
    ).join('; '));
  }
}

/**
 * Marks with an error each attempt whose account bills in another currency than the first
 * configured account, or, when that one cannot be read, than the first that can: the totals
 * add up the amounts of the accounts. For a configuration of several accounts only.
 * @param {AccountAttempt[]} attempts - Every attempt of the run, in the order of the
 *   configuration
 */
function markOtherCurrencies(attempts) {
  const named = attempts.filter(({ nic }) => nic);
  const reference = named[0];
  if (!reference) return;
  const which = reference === attempts[0]
    ? 'the first configured account'
    : 'the first configured account that could be read';
  for (const attempt of named.filter(({ currency }) => currency !== reference.currency)) {
    attempt.error = new Error(`The account bills in ${attempt.currency}, not in `
      + `${reference.currency} as ${describeAccount(reference)}, ${which}: every account must `
      + 'bill in the same currency');
  }
}

/**
 * @param {AccountAttempt[]} attempts - Every attempt of the run
 * @param {string} nic - The NIC handle that --account gives
 * @param {string} source - The configuration file, which the error names
 * @returns {AccountAttempt} The attempt of that NIC handle, which the run is limited to: the
 *   one whose GET /me names it, or else one whose GET /me failed, and whose entry's name an
 *   import last recorded that account with
 * @throws {Error} When none has it, naming the entries whose GET /me failed, with their
 *   errors: the account may be one of theirs
 */
function findAccount(attempts, nic, source) {
  const attempt = attempts.find(candidate => candidate.nic === nic)
    || attempts.find(candidate => !candidate.nic && candidate.lastNic === nic);
  if (attempt) return attempt;
  const unread = attempts.filter(candidate => !candidate.nic)
    .map(candidate => `${candidate.entry.label}: ${reasonOf(candidate.error)}`);
  throw new Error(`No account configured in ${source} has the NIC handle ${nic}`
    + (unread.length > 0 ? `, unless it is one that could not be read: ${unread.join('; ')}` : ''));
}

/**
 * @param {AccountAttempt[]} attempts - The attempts that the run imports, some of which failed
 * @param {boolean} several - Whether the configuration has several accounts
 * @returns {string} Why the run failed or ended partial: with a single account configured,
 *   the error of its attempt, as before #113; with several, each attempt that failed, named,
 *   with its error
 */
function failureMessage(attempts, several) {
  const failed = attempts.filter(({ error }) => error);
  if (!several) return reasonOf(failed[0].error);
  const each = failed.map(attempt => `${describeAccount(attempt)}: ${reasonOf(attempt.error)}`);
  const accounts = attempts.length > 1 ? 'accounts' : 'account';
  return `${failed.length} of ${attempts.length} ${accounts} failed: ${each.join('; ')}`;
}

module.exports = {
  reasonOf,
  joinWithAnd,
  describeAccount,
  throwIfSameAccount,
  markOtherCurrencies,
  findAccount,
  failureMessage,
};
