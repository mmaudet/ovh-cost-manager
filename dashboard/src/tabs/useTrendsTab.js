// The Trends tab's state and data queries, in a hook that the dashboard shell calls on
// every render: see docs/adr/0001-tab-state-lives-in-the-dashboard-shell.md

import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  fetchMonthlyTrend, fetchMonthlyTrendByCategory, fetchGpuSummary,
} from '../services/api.js';
import { monthsBetween, availablePeriodsFor } from '../utils/trendPeriods.js';
import { monthWindowEndingOn } from '../utils/monthWindow.js';

const useTrendsTab = ({ months, selectedMonth, activeTab }) => {
  const [trendPeriod, setTrendPeriod] = useState(6); // Months for trend

  // The period ends on the month selected in the header, that month included, as the 12
  // months of the Web Cloud tab do (#66)
  const endMonth = selectedMonth?.value;

  // The periods offered go up to the first one that covers the months of data up to it
  const maxMonths = monthsBetween(months[months.length - 1]?.value, endMonth);
  const availablePeriods = availablePeriodsFor(maxMonths);

  useEffect(() => {
    // Adjust trend period if it is no longer one of the available options, once there is
    // a month to count up to
    if (endMonth && !availablePeriods.some(o => o.months === trendPeriod)) {
      setTrendPeriod(availablePeriods[availablePeriods.length - 1].months);
    }
  }, [months, endMonth, trendPeriod]);

  const { data: monthlyTrend = [] } = useQuery({
    queryKey: ['monthlyTrend', trendPeriod, endMonth],
    queryFn: () => fetchMonthlyTrend(trendPeriod, endMonth),
    enabled: !!endMonth
  });

  const { data: trendByCategory = { categories: [], data: [] } } = useQuery({
    queryKey: ['monthlyTrendByCategory', trendPeriod, endMonth],
    queryFn: () => fetchMonthlyTrendByCategory(trendPeriod, endMonth),
    enabled: !!endMonth
  });
  // Categories hidden from the by-category chart (toggled via the legend).
  const [hiddenCategories, setHiddenCategories] = useState(() => new Set());
  const toggleCategory = (key) => setHiddenCategories(prev => {
    const next = new Set(prev);
    next.has(key) ? next.delete(key) : next.add(key);
    return next;
  });

  // GPU cost trend, over the same months (for trends tab)
  const gpuTrendWindow = monthWindowEndingOn(selectedMonth, trendPeriod);
  const { data: gpuTrend } = useQuery({
    queryKey: ['gpuTrend', gpuTrendWindow?.from, gpuTrendWindow?.to],
    queryFn: () => fetchGpuSummary(gpuTrendWindow.from, gpuTrendWindow.to),
    enabled: !!gpuTrendWindow && activeTab === 'trends'
  });

  return {
    trendPeriod,
    setTrendPeriod,
    availablePeriods,
    monthlyTrend,
    trendByCategory,
    hiddenCategories,
    toggleCategory,
    gpuTrend,
  };
};

export { useTrendsTab };
