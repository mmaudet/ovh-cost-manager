// The Trends tab's state and data queries, in a hook that the dashboard shell calls on
// every render: see docs/adr/0001-tab-state-lives-in-the-dashboard-shell.md

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  fetchMonthlyTrend, fetchMonthlyTrendByCategory, fetchGpuSummary, fetchProjectGpuSummary,
  fetchAiEndpoints, fetchProjectAiEndpoints,
  fetchProjectsEnriched, fetchProjectMonthlyTrend,
} from '../services/api.js';
import { accountQuery, projectedQuery } from '../utils/accounts.js';
import { comparedMonthsOf } from '../utils/monthComparison.js';
import { monthInProgressWithin } from '../utils/months.js';
import { monthsBetween, availablePeriodsFor } from '../utils/trendPeriods.js';
import { monthWindowEndingOn } from '../utils/monthWindow.js';

// The tab shows the trends of the account that the header shows, selectedAccount: null for
// all accounts, undefined while the page does not know it yet (#120). The months list and
// the month selected are that account's, and holdsSelectedMonth whether the list holds that
// month, as the shell checks it. projectsMonthInProgress is the page's setting that projects the
// month in progress (#217), off by default.
const useTrendsTab = ({
  months, selectedMonth, holdsSelectedMonth, selectedAccount, activeTab,
  projectsMonthInProgress = false,
}) => {
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

  // The months of the period as dates, from the first day of the first to the last day of the
  // month selected: those of the GPU and AI Endpoints trends
  const trendWindow = monthWindowEndingOn(selectedMonth, trendPeriod);

  // The month in progress that the period covers (#216), null when it covers none, and whether
  // the trends project it: while the page projects the month in progress (#217). Their requests
  // and their keys name the flag only then (projectedQuery()).
  const monthInProgress = monthInProgressWithin(months, trendWindow);
  const projected = projectsMonthInProgress && monthInProgress !== null;
  // What the tab's cards compare, the first and the last months of the period: the month in
  // progress, when the period covers it, at its projected cost while the trends project it
  const periodMonths = comparedMonthsOf(
    months, trendWindow && { value: trendWindow.from.slice(0, 7) }, selectedMonth, { projected },
  );

  // The Public Cloud projects of the account shown, which the tab offers to select, as the
  // Public Cloud tab lists them, under its key: only while the tab is open
  const { data: projects = [] } = useQuery(accountQuery(selectedAccount, {
    key: ['projectsEnriched'],
    fetch: fetchProjectsEnriched,
    enabled: activeTab === 'trends',
  }));
  // The project whose trend the tab shows, by id: the one picked, while the projects of the
  // account shown hold it, or else none, for the trends of the whole account. The choice stays
  // for an account that holds the project again.
  const [chosenProjectId, setChosenProjectId] = useState(null);
  const selectedProjectId = projects.some(({ id }) => id === chosenProjectId)
    ? chosenProjectId
    : null;

  // The trend of that project over the period, as the trends of the account follow the month in
  // progress, its products in place of the resource types
  const { data: projectTrend } = useQuery(projectedQuery(selectedAccount, {
    key: ['projectTrend', selectedProjectId, trendPeriod, endMonth],
    fetch: (account, ...options) => fetchProjectMonthlyTrend(
      selectedProjectId, trendPeriod, endMonth, account, ...options,
    ),
    projected,
    enabled: holdsSelectedMonth && selectedProjectId !== null,
  }));

  // The trends wait until the months list holds the month selected. It does not while the
  // months of the account just selected load, nor when that account lacks the month, until
  // the shell selects its latest month (#115): the period would then count no month, or end
  // on a month the account lacks, and the tab would ask for trends it never shows (#120).
  const { data: accountTrend = [] } = useQuery(projectedQuery(selectedAccount, {
    key: ['monthlyTrend', trendPeriod, endMonth],
    fetch: (account, ...options) => fetchMonthlyTrend(trendPeriod, endMonth, account, ...options),
    projected,
    enabled: holdsSelectedMonth,
  }));

  const { data: accountTrendByCategory = { categories: [], data: [] } } = useQuery(
    projectedQuery(selectedAccount, {
      key: ['monthlyTrendByCategory', trendPeriod, endMonth],
      fetch: (account, ...options) => fetchMonthlyTrendByCategory(
        trendPeriod, endMonth, account, ...options,
      ),
      projected,
      enabled: holdsSelectedMonth,
    }),
  );
  // What the charts and cards show: the project's trend, nothing while it loads, and its products
  // as categories, while a project is selected; the account's otherwise
  const monthlyTrend = selectedProjectId === null
    ? accountTrend
    : projectTrend?.monthlyTrend ?? [];
  const trendByCategory = selectedProjectId === null
    ? accountTrendByCategory
    : projectTrend?.byProduct ?? { categories: [], data: [] };

  // Categories hidden from the by-category chart (toggled via the legend).
  const [hiddenCategories, setHiddenCategories] = useState(() => new Set());
  const toggleCategory = (key) => setHiddenCategories(prev => {
    const next = new Set(prev);
    next.has(key) ? next.delete(key) : next.add(key);
    return next;
  });

  // GPU cost trend, over the same months (for trends tab): that of the project selected, under a
  // key of its own, or of every project
  const { data: gpuTrend } = useQuery(accountQuery(selectedAccount, selectedProjectId === null
    ? {
      key: ['gpuTrend', trendWindow?.from, trendWindow?.to],
      fetch: (account) => fetchGpuSummary(trendWindow.from, trendWindow.to, account),
      enabled: holdsSelectedMonth && activeTab === 'trends',
    }
    : {
      key: ['projectGpuTrend', selectedProjectId, trendWindow?.from, trendWindow?.to],
      fetch: (account) => fetchProjectGpuSummary(
        selectedProjectId, trendWindow.from, trendWindow.to, account,
      ),
      enabled: holdsSelectedMonth && activeTab === 'trends',
    }));

  // The cost of each AI Endpoints model month by month (#196), over the same months, which only
  // the tab shows: those of the project selected, under a key of their own, or of every project
  const { data: aiEndpointsTrend } = useQuery(accountQuery(selectedAccount, selectedProjectId === null
    ? {
      key: ['aiEndpointsTrend', trendWindow?.from, trendWindow?.to],
      fetch: (account) => fetchAiEndpoints(trendWindow.from, trendWindow.to, account),
      enabled: holdsSelectedMonth && activeTab === 'trends',
    }
    : {
      key: ['projectAiEndpointsTrend', selectedProjectId, trendWindow?.from, trendWindow?.to],
      fetch: (account) => fetchProjectAiEndpoints(
        selectedProjectId, trendWindow.from, trendWindow.to, account,
      ),
      enabled: holdsSelectedMonth && activeTab === 'trends',
    }));

  return {
    trendPeriod,
    setTrendPeriod: setChosenPeriod,
    availablePeriods,
    projects,
    selectedProjectId,
    setSelectedProjectId: setChosenProjectId,
    monthlyTrend,
    trendByCategory,
    hiddenCategories,
    toggleCategory,
    gpuTrend,
    aiEndpointsTrend,
    monthInProgress,
    projected,
    periodMonths,
  };
};

export { useTrendsTab };
