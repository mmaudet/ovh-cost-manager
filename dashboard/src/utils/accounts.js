// The accounts of the instance (#110), as the page offers them to select, the queries that
// follow the account shown (#115), and the budget that its figures are compared with (#117)

/**
 * The accounts that GET /api/accounts lists, in its order, as the page uses them. The route
 * gives each one's id, the value of the account parameter, whether config.json still lists
 * it, and which one is the Unknown account (#114); until it does, an account is known by its
 * NIC handle, and configured. It gives how each one's last import ended too, and when its
 * last import that succeeded did, which the footer shows (#124), and the budget of its own
 * that its last import recorded, which the page compares it with (#117).
 * @param {object[]} entries - The route's answer
 * @returns {{ id: string, name: string, budget: ?number, configured: boolean,
 *   unknown: boolean, lastImport: ?{ at: string, status: string, error: ?string },
 *   lastSuccessAt: ?string }[]} budget: null for an account without one, as for the Unknown
 *   account; lastImport: when the account's last import ended, a SQLite timestamp, 'success'
 *   or 'failed', and why it failed; lastSuccessAt: when its last import that succeeded ended.
 *   Each null until one has, as for the Unknown account, which no import reads.
 */
export function accountsOf(entries) {
  return entries.map((entry) => ({
    id: entry.id ?? entry.nic,
    // The route names an account by its NIC handle when config.json gives it no name
    name: entry.name ?? entry.nic,
    budget: entry.budget ?? null,
    configured: entry.configured ?? true,
    unknown: entry.unknown ?? false,
    lastImport: entry.lastImport ?? null,
    lastSuccessAt: entry.lastSuccessAt ?? null,
  }));
}

// Whether the page offers to select an account: when the instance knows two at least, the
// Unknown account and the accounts no longer configured included. A single-account
// installation shows the page as before.
export const offersAccounts = (accounts) => accounts.length >= 2;

// An account as the selector names it: the Unknown account, or its name, which says when
// config.json no longer lists it
export function accountLabel(account, t) {
  if (account.unknown) return t('unknownAccount');
  return account.configured ? account.name : `${account.name} (${t('notConfigured')})`;
}

/**
 * The Account column of the lists, which names the account of each row (#110): when the page
 * offers accounts to select, and shows all of them. A single-account installation keeps its
 * lists as they were.
 * @param {object[]|undefined} accounts - The accounts of the instance (accountsOf()),
 *   undefined while their list loads
 * @param {?string|undefined} selectedAccount - The account shown (useSelectedAccount())
 * @param {function(string): string} t
 * @returns {?{ label: string, nameOf: function(?string): string }} Null when the lists show
 *   no Account column. Else its label, and what it shows for the account of a row, from the
 *   NIC handle that the routes give: the account's name, or else its NIC handle, and the
 *   Unknown account for null, a row without an account.
 */
export function accountColumnOf(accounts, selectedAccount, t) {
  if (accounts === undefined || !offersAccounts(accounts) || selectedAccount !== null) {
    return null;
  }
  const nameOf = (nic) => {
    if (nic === null) return t('unknownAccount');
    return accounts.find(({ id }) => id === nic)?.name ?? nic;
  };
  return { label: t('account'), nameOf };
}

/**
 * How a line that names a service, rather than a row of a table, names its account too, after
 * the service, when the lists show the Account column (#123): in brackets, so that it does not
 * read as part of the service's name. The Overview's services about to expire and the Compare
 * tab's dedicated servers name it so.
 * @param {?{ nameOf: function(?string): string }} accountColumn - The Account column of the
 *   lists (accountColumnOf()), null when they show none
 * @param {?string} account - The NIC handle of the service's account, null for the Unknown
 *   account
 * @returns {?string} Null when the lists name no account
 */
export function accountInBrackets(accountColumn, account) {
  return accountColumn ? `(${accountColumn.nameOf(account)})` : null;
}

/**
 * The rows of a list, as its table and its CSV file show them (#122, #123): with the Account
 * column, each with the name of its account, accountName, from the NIC handle that the routes
 * give it; without, as they are.
 * @param {object[]} rows - Each with the NIC handle of its account, `account`, null for the
 *   Unknown account
 * @param {?{ nameOf: function(?string): string }} accountColumn - The Account column of the
 *   lists (accountColumnOf()), null when they show none
 * @returns {object[]}
 */
export function withAccountNames(rows, accountColumn) {
  if (!accountColumn) return rows;
  return rows.map((row) => ({ ...row, accountName: accountColumn.nameOf(row.account) }));
}

/**
 * The columns that the CSV file of a list gives for the Account column (#122, #123), for a
 * spreadsheet to pivot its rows by account: the name of each row's account, which
 * withAccountNames() gives the rows, under the column's label; none without the column.
 * @param {?{ label: string }} accountColumn - The Account column of the lists
 *   (accountColumnOf()), null when they show none
 * @returns {{ key: string, label: string }[]}
 */
export function accountCsvColumns(accountColumn) {
  return accountColumn ? [{ key: 'accountName', label: accountColumn.label }] : [];
}

/**
 * What the page shows, as the account selector names it: all accounts, or the account
 * selected (accountLabel()). The report names it in its title (#124). A single-account
 * installation's page offers no account to select, and its report names none.
 * @param {object[]|undefined} accounts - The accounts of the instance (accountsOf()),
 *   undefined while their list loads
 * @param {?string|undefined} selectedAccount - The account shown (useSelectedAccount()):
 *   null for all accounts, or else, once the accounts load, the id of one that they list
 * @param {function(string): string} t
 * @returns {?string} Null when the page offers no account to select
 */
export function scopeLabel(accounts, selectedAccount, t) {
  if (accounts === undefined || !offersAccounts(accounts)) return null;
  if (selectedAccount === null) return t('allAccounts');
  return accountLabel(accounts.find(({ id }) => id === selectedAccount), t);
}

/**
 * The budget that the page compares the figures it shows with (#117), and whether the user
 * may change it: the dashboard budget for all accounts, which the user may change for the
 * visit, or else the budget of the account shown, which config.json sets, so that an account
 * is never compared with the budget of all of them. A single-account installation shows all
 * accounts, and keeps the dashboard budget.
 * @param {object[]|undefined} accounts - The accounts of the instance (accountsOf()), with the
 *   budget of each, undefined while their list loads
 * @param {?string|undefined} selectedAccount - The account shown (useSelectedAccount()): null
 *   for all accounts, or else the id of one that the accounts list
 * @param {number} dashboardBudget - The dashboard budget, as the page holds it: config.json's,
 *   or the one that the user typed for the visit
 * @returns {?{ amount: number, editable: boolean }} Null for an account without a budget of
 *   its own
 */
export function budgetOf(accounts, selectedAccount, dashboardBudget) {
  if (selectedAccount === null) return { amount: dashboardBudget, editable: true };
  const amount = accounts?.find(({ id }) => id === selectedAccount)?.budget ?? null;
  return amount === null ? null : { amount, editable: false };
}

// Whether the key and the request of a query name the account shown: not for all accounts,
// null, which the page asks for as it did before several accounts. A query that a tab shares
// with the shell thus keeps sharing its key for all accounts (ADR 0001).
const namesAccount = (account) => account !== null;

// The parameters that name the account in a request: none for all accounts
export const accountParams = (account) => (namesAccount(account) ? { account } : {});

/**
 * The options of a query that follows the account shown, for useQuery: its key and its
 * request name the account, after the rest, or neither does for all accounts. The query
 * waits while the page does not know the account yet.
 * @param {?string|undefined} account - The id of the account shown: null for all accounts,
 *   undefined while the page does not know it (useSelectedAccount())
 * @param {object} query
 * @param {Array} query.key - Its key for all accounts
 * @param {function(?string): Promise} query.fetch - Requests its answer for an account, as
 *   the functions of services/api.js do with their last argument
 * @param {boolean} [query.enabled] - Whether it may run besides, such as once it has the
 *   month it needs
 * @returns {{ queryKey: Array, queryFn: function(): Promise, enabled: boolean }}
 */
export function accountQuery(account, { key, fetch, enabled = true }) {
  return {
    queryKey: namesAccount(account) ? [...key, account] : key,
    queryFn: () => fetch(account),
    enabled: account !== undefined && enabled,
  };
}
