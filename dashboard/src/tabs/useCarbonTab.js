// The Carbon tab's data queries, in a hook that the dashboard shell calls on every render:
// see docs/adr/0001-tab-state-lives-in-the-dashboard-shell.md

import { useQuery } from '@tanstack/react-query';
import { fetchCarbonByServer, fetchCarbonFootprint, fetchCarbonTrend } from '../services/api.js';
import { accountQuery } from '../utils/accounts.js';

/**
 * The carbon footprint that the tab shows for a month (#152): the month's own, or, when it has
 * none, that of the latest month that has one, as OVHcloud never gives the current month's.
 * @param {string} month - 'YYYY-MM'
 * @param {?string} account - As fetchCarbonFootprint() takes it
 * @returns {Promise<{ shown: object, missingMonth: ?string }>} The answer of the month shown,
 *   as fetchCarbonFootprint() gives it: the month's own when it has a footprint, or when no
 *   month has one. And the month asked for when it is not the one shown, null otherwise.
 */
async function fetchShownFootprint(month, account) {
  const answer = await fetchCarbonFootprint(month, account);
  if (answer.footprint || !answer.latestMonth) return { shown: answer, missingMonth: null };
  return {
    shown: await fetchCarbonFootprint(answer.latestMonth, account),
    missingMonth: month,
  };
}

/**
 * The data queries of the Carbon tab (#147): the carbon footprint of the month selected, for
 * the account shown in the header, or that of the latest month that has one (#152), that of
 * the 12 months that end on the month it shows (#154), and the lines of that month with what
 * they cost (#155).
 * @param {object} shell - What the dashboard shell passes on, on every render
 * @param {?object} shell.selectedMonth - The month selected in the header
 * @param {boolean} shell.holdsSelectedMonth - Whether the months of the account shown hold
 *   it, as the shell checks it: the query waits until they do (#115)
 * @param {string} shell.activeTab - The tab open: the queries run on the Carbon tab only
 * @param {?string|undefined} shell.selectedAccount - The account shown (useSelectedAccount()):
 *   null for all accounts, undefined while the page does not know it, which the query waits
 *   for
 * @returns {{ carbonFootprint: (object|undefined), missingMonth: ?string,
 *   carbonTrend: (object[]|undefined), carbonLines: (object[]|undefined),
 *   loadingCarbon: boolean, failedCarbon: boolean, loadingTrend: boolean,
 *   failedTrend: boolean, loadingLines: boolean, failedLines: boolean }} The footprint that
 *   the tab shows, as /api/carbon/footprint gives it; the month selected when that footprint
 *   is another month's, as the month selected has none, null otherwise; the trend, as
 *   /api/carbon/trend gives it; the lines, as /api/carbon/by-server gives them; and whether
 *   the tab shows that each loads, or that it could not load
 */
const useCarbonTab = ({ selectedMonth, holdsSelectedMonth, activeTab, selectedAccount }) => {
  const { data, isPending, isError } = useQuery(accountQuery(selectedAccount, {
    key: ['carbonFootprint', selectedMonth?.value],
    fetch: (account) => fetchShownFootprint(selectedMonth.value, account),
    enabled: holdsSelectedMonth && activeTab === 'carbon',
  }));

  // The month that the tab shows, once it knows that it has a footprint: the trend ends on it
  // (#154). None without any footprint, as there is no trend to draw then.
  const shownMonth = data?.shown.footprint ? data.shown.month : undefined;
  const trend = useQuery(accountQuery(selectedAccount, {
    key: ['carbonTrend', shownMonth],
    fetch: (account) => fetchCarbonTrend(shownMonth, account),
    enabled: activeTab === 'carbon' && shownMonth !== undefined,
  }));

  // And the lines of that month, with what they cost (#155)
  const byServer = useQuery(accountQuery(selectedAccount, {
    key: ['carbonByServer', shownMonth],
    fetch: (account) => fetchCarbonByServer(shownMonth, account),
    enabled: activeTab === 'carbon' && shownMonth !== undefined,
  }));

  return {
    carbonFootprint: data?.shown,
    missingMonth: data?.missingMonth ?? null,
    carbonTrend: trend.data,
    carbonLines: byServer.data?.lines,
    // As the other tabs do (#64)
    loadingCarbon: isPending,
    failedCarbon: isError,
    loadingTrend: trend.isPending,
    failedTrend: trend.isError,
    loadingLines: byServer.isPending,
    failedLines: byServer.isError,
  };
};

export { useCarbonTab };
