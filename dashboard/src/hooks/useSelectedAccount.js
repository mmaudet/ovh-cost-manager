import { useState } from 'react';
import { offersAccounts } from '../utils/accounts.js';
import { readStored, store } from '../utils/storage.js';

// Where the browser keeps the account selected, next to the language
const STORAGE_KEY = 'ovh-dashboard-account';

// The account shown when the user chose this one, null for all accounts: that one while the
// selector offers it, or else all accounts. Undefined while the list that must offer it
// loads. All accounts need no list: they are always shown at once.
function shownAccount(chosenAccount, accounts) {
  if (chosenAccount === null) return null;
  if (accounts === undefined) return undefined;
  const offered = offersAccounts(accounts) && accounts.some(({ id }) => id === chosenAccount);
  return offered ? chosenAccount : null;
}

/**
 * The account the page shows (#115): page-wide state, which the dashboard shell holds (ADR
 * 0001). All accounts by default, or the one the user selects, which the browser remembers
 * for the next visits, as it does the language. A remembered account that the selector no
 * longer offers gives all accounts.
 * @param {object[]|undefined} accounts - The accounts of the instance (accountsOf()),
 *   undefined while their list loads
 * @returns {{ selectedAccount: (?string|undefined), selectAccount: function(?string) }} The
 *   id of the account shown, null for all accounts, or undefined while the page cannot tell
 *   yet whether it still offers a remembered account: the queries that follow the account
 *   wait until then (accountQuery()). And what selects another account, or all of them with
 *   null.
 */
export function useSelectedAccount(accounts) {
  // The account selected on an earlier visit, null for all accounts
  const [chosenAccount, setChosenAccount] = useState(() => readStored(STORAGE_KEY) || null);

  const selectAccount = (account) => {
    setChosenAccount(account);
    store(STORAGE_KEY, account);
  };

  return { selectedAccount: shownAccount(chosenAccount, accounts), selectAccount };
}
