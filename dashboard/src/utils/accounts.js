// The accounts of the instance (#110), as the page offers them to select, and the queries
// that follow the account shown (#115)

/**
 * The accounts that GET /api/accounts lists, in its order, as the page uses them. The route
 * gives each one's id, the value of the account parameter, whether config.json still lists
 * it, and which one is the Unknown account (#114); until it does, an account is known by its
 * NIC handle, and configured.
 * @param {object[]} entries - The route's answer
 * @returns {{ id: string, name: string, configured: boolean, unknown: boolean }[]}
 */
export function accountsOf(entries) {
  return entries.map((entry) => ({
    id: entry.id ?? entry.nic,
    // The route names an account by its NIC handle when config.json gives it no name
    name: entry.name ?? entry.nic,
    configured: entry.configured ?? true,
    unknown: entry.unknown ?? false,
  }));
}

// Whether the page offers to select an account: when the instance knows two at least, the
// Unknown account and the accounts no longer configured included. A single-account
// installation shows the page as before.
export const offersAccounts = (accounts) => accounts.length >= 2;

/**
 * Whether the lists of the page name the account of each row, in an Account column (#118):
 * when the page offers accounts to select, and shows all of them. A single-account
 * installation shows its lists as before.
 * @param {object[]|undefined} accounts - The accounts of the instance (accountsOf()),
 *   undefined while their list loads
 * @param {?string|undefined} selectedAccount - The account shown (useSelectedAccount()): null
 *   for all accounts
 * @returns {boolean}
 */
export const showsAccountColumn = (accounts, selectedAccount) =>
  accounts !== undefined && offersAccounts(accounts) && selectedAccount === null;

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
 * The account of a row of a list, as its Account column names it in the view of all
 * accounts (#118): by the name that the accounts route gives it, its NIC handle when
 * config.json names it not, or as the Unknown account for a row without one.
 * @param {?string} nic - The NIC handle of the row's account, as the routes give it: null for
 *   the Unknown account
 * @param {object[]} accounts - The accounts of the instance (accountsOf())
 * @param {function(string): string} t - The translations of the page
 * @returns {string} The name of the account, or its NIC handle when the accounts do not list
 *   it
 */
export function accountNameOf(nic, accounts, t) {
  if (nic == null) return t('unknownAccount');
  return accounts.find(({ id }) => id === nic)?.name ?? nic;
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
