import { useState } from 'react';
import { offersAccounts } from '../utils/accounts.js';
import { readStored, store } from '../utils/storage.js';

// Where the browser keeps the account selected, next to the language
const STORAGE_KEY = 'ovh-dashboard-account';

/**
 * The account the page shows (#115): page-wide state, which the dashboard shell holds (ADR
 * 0001). All accounts by default, or the one the user selects, which the browser remembers
 * for the next visits, as it does the language. A remembered account that the selector no
 * longer offers gives all accounts.
 * @param {object[]|undefined} accounts - The accounts of the instance (accountsOf()),
 *   undefined while their list loads
 * @returns {{ selectedAccount: ?string, accountKnown: boolean,
 *   selectAccount: function(?string) }} The id of the account shown, null for all accounts;
 *   whether the page knows it yet, which it does not while the list that must offer a
 *   remembered account loads: the queries that follow the account wait until then; and what
 *   selects another account, or all of them with null
 */
export function useSelectedAccount(accounts) {
  // The account selected on an earlier visit, null for all accounts
  const [chosenAccount, setChosenAccount] = useState(() => readStored(STORAGE_KEY) || null);

  const selectAccount = (account) => {
    setChosenAccount(account);
    store(STORAGE_KEY, account);
  };

  if (chosenAccount === null) {
    return { selectedAccount: null, accountKnown: true, selectAccount };
  }
  if (accounts === undefined) {
    return { selectedAccount: chosenAccount, accountKnown: false, selectAccount };
  }
  const offered = offersAccounts(accounts) && accounts.some(({ id }) => id === chosenAccount);
  return { selectedAccount: offered ? chosenAccount : null, accountKnown: true, selectAccount };
}
