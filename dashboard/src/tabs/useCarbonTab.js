// The Carbon tab's data query, in a hook that the dashboard shell calls on every render:
// see docs/adr/0001-tab-state-lives-in-the-dashboard-shell.md

import { useQuery } from '@tanstack/react-query';
import { fetchCarbonFootprint } from '../services/api.js';
import { accountQuery } from '../utils/accounts.js';

/**
 * The carbon footprint of a month, and the footprint that the tab shows for it (#152): the
 * month's own, or, when it has none, that of the latest month that has one, as OVHcloud never
 * gives the current month's.
 * @param {string} month - 'YYYY-MM'
 * @param {?string} account - As fetchCarbonFootprint() takes it
 * @returns {Promise<object>} The month's answer, with `shown`: the answer of the month that the
 *   tab shows, the month's own when it has a footprint or no month has one
 */
async function fetchShownFootprint(month, account) {
  const answer = await fetchCarbonFootprint(month, account);
  if (answer.footprint || !answer.latestMonth) return { ...answer, shown: answer };
  return { ...answer, shown: await fetchCarbonFootprint(answer.latestMonth, account) };
}

/**
 * The data query of the Carbon tab (#147): the carbon footprint of the month selected, for the
 * account shown in the header, or that of the latest month that has one (#152).
 * @param {object} shell - What the dashboard shell passes on, on every render
 * @param {?object} shell.selectedMonth - The month selected in the header
 * @param {boolean} shell.holdsSelectedMonth - Whether the months of the account shown hold
 *   it, as the shell checks it: the query waits until they do (#115)
 * @param {string} shell.activeTab - The tab open: the query runs on the Carbon tab only
 * @param {?string|undefined} shell.selectedAccount - The account shown (useSelectedAccount()):
 *   null for all accounts, undefined while the page does not know it, which the query waits
 *   for
 * @returns {{ carbonFootprint: (object|undefined), loadingCarbon: boolean,
 *   failedCarbon: boolean }} The month's footprint, as /api/carbon/footprint gives it, with
 *   the one the tab shows (fetchShownFootprint()), and whether the tab shows that it loads, or
 *   that it could not load
 */
const useCarbonTab = ({ selectedMonth, holdsSelectedMonth, activeTab, selectedAccount }) => {
  const { data: carbonFootprint, isPending, isError } = useQuery(accountQuery(selectedAccount, {
    key: ['carbonFootprint', selectedMonth?.value],
    fetch: (account) => fetchShownFootprint(selectedMonth.value, account),
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
