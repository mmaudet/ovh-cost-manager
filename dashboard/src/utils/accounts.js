// The accounts of the instance (#110), as the page offers them to select (#115)

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

// The key of a query that follows the account selected: its key, then the account's id, or
// nothing more for all accounts, as its request then names none. A query shared with a tab
// that does not follow the account yet thus keeps sharing its key for all accounts (ADR 0001).
export const withAccount = (key, account) => (account === null ? key : [...key, account]);
