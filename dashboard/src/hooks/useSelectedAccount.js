import { useState } from 'react';
import { offersAccounts } from '../utils/accounts.js';

// Where the browser keeps the account selected, next to the language
const STORAGE_KEY = 'ovh-dashboard-account';

// The id of the account selected on an earlier visit, null for all accounts. A browser can
// refuse storage, as some private windows do: the page then opens on all accounts.
function rememberedAccount() {
  try {
    return localStorage.getItem(STORAGE_KEY) || null;
  } catch {
    return null;
  }
}

function rememberAccount(account) {
  try {
    if (account === null) {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, account);
    }
  } catch {
    // Not remembered: the choice lasts until the page closes
  }
}

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
  const [chosenAccount, setChosenAccount] = useState(rememberedAccount);

  const selectAccount = (account) => {
    setChosenAccount(account);
    rememberAccount(account);
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
