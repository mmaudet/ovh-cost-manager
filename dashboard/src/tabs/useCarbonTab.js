// The Carbon tab's data query, in a hook that the dashboard shell calls on every render:
// see docs/adr/0001-tab-state-lives-in-the-dashboard-shell.md

import { useQuery } from '@tanstack/react-query';
import { fetchCarbonFootprint } from '../services/api.js';
import { accountQuery } from '../utils/accounts.js';

/**
 * The data query of the Carbon tab (#147): the carbon footprint of the month selected, for the
 * account shown in the header.
 * @param {object} shell - What the dashboard shell passes on, on every render
 * @param {?object} shell.selectedMonth - The month selected in the header
 * @param {boolean} shell.holdsSelectedMonth - Whether the months of the account shown hold
 *   it, as the shell checks it: the query waits until they do (#115)
 * @param {string} shell.activeTab - The tab open: the query runs on the Carbon tab only
 * @param {?string|undefined} shell.selectedAccount - The account shown (useSelectedAccount()):
 *   null for all accounts, undefined while the page does not know it, which the query waits
 *   for
 * @returns {{ carbonFootprint: (object|undefined), loadingCarbon: boolean,
 *   failedCarbon: boolean }} The month's footprint, as /api/carbon/footprint gives it, and
 *   whether the tab shows that it loads, or that it could not load
 */
const useCarbonTab = ({ selectedMonth, holdsSelectedMonth, activeTab, selectedAccount }) => {
  const { data: carbonFootprint, isPending, isError } = useQuery(accountQuery(selectedAccount, {
    key: ['carbonFootprint', selectedMonth?.value],
    fetch: (account) => fetchCarbonFootprint(selectedMonth.value, account),
    enabled: holdsSelectedMonth && activeTab === 'carbon',
  }));

  return {
    carbonFootprint,
    // As the other tabs do (#64)
    loadingCarbon: isPending,
    failedCarbon: isError,
  };
};

export { useCarbonTab };
