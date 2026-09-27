// The Trends tab's state and data queries, in a hook that the dashboard shell calls on
// every render: see docs/adr/0001-tab-state-lives-in-the-dashboard-shell.md

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  fetchMonthlyTrend, fetchMonthlyTrendByCategory, fetchGpuSummary,
} from '../services/api.js';
import { accountQuery } from '../utils/accounts.js';
import { monthsBetween, availablePeriodsFor } from '../utils/trendPeriods.js';
import { monthWindowEndingOn } from '../utils/monthWindow.js';

// The tab shows the trends of the account that the header shows, selectedAccount: null for
// all accounts, undefined while the page does not know it yet (#120). The months list and
// the month selected are that account's.
const useTrendsTab = ({ months, selectedMonth, selectedAccount, activeTab }) => {
  // The period the user picks, in months: 6 by default
  const [chosenPeriod, setChosenPeriod] = useState(6);

  // The period ends on the month selected in the header, that month included, as the 12
  // months of the Web Cloud tab do (#66)
  const endMonth = selectedMonth?.value;

  // The periods offered go up to the first one that covers the months of data up to it
  const maxMonths = monthsBetween(months[months.length - 1]?.value, endMonth);
  const availablePeriods = availablePeriodsFor(maxMonths);
  // The period shown and requested: the one picked, or the longest offered when that one is
  // shorter. The choice stays, for a month that offers it again
  const longestPeriod = availablePeriods[availablePeriods.length - 1].months;
  const trendPeriod = Math.min(chosenPeriod, longestPeriod);

  const { data: monthlyTrend = [] } = useQuery(accountQuery(selectedAccount, {
    key: ['monthlyTrend', trendPeriod, endMonth],
    fetch: (account) => fetchMonthlyTrend(trendPeriod, endMonth, account),
    enabled: !!endMonth,
  }));

  const { data: trendByCategory = { categories: [], data: [] } } = useQuery(
    accountQuery(selectedAccount, {
      key: ['monthlyTrendByCategory', trendPeriod, endMonth],
      fetch: (account) => fetchMonthlyTrendByCategory(trendPeriod, endMonth, account),
      enabled: !!endMonth,
    }),
  );
  // Categories hidden from the by-category chart (toggled via the legend).
  const [hiddenCategories, setHiddenCategories] = useState(() => new Set());
  const toggleCategory = (key) => setHiddenCategories(prev => {
    const next = new Set(prev);
    next.has(key) ? next.delete(key) : next.add(key);
    return next;
  });

  // GPU cost trend, over the same months (for trends tab)
  const gpuTrendWindow = monthWindowEndingOn(selectedMonth, trendPeriod);
  const { data: gpuTrend } = useQuery(accountQuery(selectedAccount, {
    key: ['gpuTrend', gpuTrendWindow?.from, gpuTrendWindow?.to],
    fetch: (account) => fetchGpuSummary(gpuTrendWindow.from, gpuTrendWindow.to, account),
    enabled: !!gpuTrendWindow && activeTab === 'trends',
  }));

  return {
    trendPeriod,
    setTrendPeriod: setChosenPeriod,
    availablePeriods,
    monthlyTrend,
    trendByCategory,
    hiddenCategories,
    toggleCategory,
    gpuTrend,
  };
};

export { useTrendsTab };
