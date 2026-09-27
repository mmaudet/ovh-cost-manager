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

// An account as the selector names it: the Unknown account, or its name, which says when
// config.json no longer lists it
export function accountLabel(account, t) {
  if (account.unknown) return t('unknownAccount');
  return account.configured ? account.name : `${account.name} (${t('notConfigured')})`;
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
