// The Trends tab's state and data queries, in a hook that the dashboard shell calls on
// every render: see docs/adr/0001-tab-state-lives-in-the-dashboard-shell.md

import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  fetchMonthlyTrend, fetchMonthlyTrendByCategory, fetchGpuSummary,
} from '../services/api.js';
import { monthsSince, availablePeriodsFor } from '../utils/trendPeriods.js';

const useTrendsTab = ({ months, activeTab }) => {
  const [trendPeriod, setTrendPeriod] = useState(6); // Months for trend

  const maxMonths = months.length > 0 ? monthsSince(months[months.length - 1].value) : 0;
  const availablePeriods = availablePeriodsFor(maxMonths);

  useEffect(() => {
    // Adjust trend period if it is no longer one of the available options
    if (months.length > 0 && !availablePeriods.some(o => o.months === trendPeriod)) {
      setTrendPeriod(availablePeriods[availablePeriods.length - 1].months);
    }
  }, [months, trendPeriod]);

  const { data: monthlyTrend = [] } = useQuery({
    queryKey: ['monthlyTrend', trendPeriod],
    queryFn: () => fetchMonthlyTrend(trendPeriod)
  });

  const { data: trendByCategory = { categories: [], data: [] } } = useQuery({
    queryKey: ['monthlyTrendByCategory', trendPeriod],
    queryFn: () => fetchMonthlyTrendByCategory(trendPeriod)
  });
  // Categories hidden from the by-category chart (toggled via the legend).
  const [hiddenCategories, setHiddenCategories] = useState(() => new Set());
  const toggleCategory = (key) => setHiddenCategories(prev => {
    const next = new Set(prev);
    next.has(key) ? next.delete(key) : next.add(key);
    return next;
  });

  // GPU cost trend — all-time (for trends tab)
  const { data: gpuTrend } = useQuery({
    queryKey: ['gpuTrend'],
    queryFn: () => fetchGpuSummary(),
    enabled: activeTab === 'trends'
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
