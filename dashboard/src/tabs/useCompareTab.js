// The Compare tab's state and data queries, in a hook that the dashboard shell calls on
// every render: see docs/adr/0001-tab-state-lives-in-the-dashboard-shell.md
//
// Months A and B get their defaults when the months list loads, on the same condition as
// the shell's selected month, so in the same commit. The shell's "vs previous month" KPI
// reads the summary of month B this hook returns (#50). Its query only runs on the Compare
// tab, but month B defaults to the latest month, whose summary the page loads at start
// under the same key: the KPI reads it from page start.

import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchSummary, fetchByProject, fetchByService } from '../services/api.js';

const useCompareTab = ({ months, selectedMonth, activeTab }) => {
  const [compareMonthA, setCompareMonthA] = useState(null);
  const [compareMonthB, setCompareMonthB] = useState(null);
  const [compareSort, setCompareSort] = useState({ column: 'totalA', direction: 'desc' });

  const handleCompareSort = (column) => {
    setCompareSort(prev => ({
      column,
      direction: prev.column === column && prev.direction === 'desc' ? 'asc' : 'desc'
    }));
  };

  // Set default months when data loads
  useEffect(() => {
    if (months.length > 0 && !selectedMonth) {
      // For the comparison:
      // A = previous month, B = latest month
      if (months.length > 1) {
        setCompareMonthA(months[1]);
        setCompareMonthB(months[0]);
      } else {
        setCompareMonthA(months[0]);
        setCompareMonthB(months[0]);
      }
    }
  }, [months, selectedMonth]);

  // Comparison data
  const { data: compareDataA } = useQuery({
    queryKey: ['summary', compareMonthA?.from, compareMonthA?.to],
    queryFn: () => fetchSummary(compareMonthA.from, compareMonthA.to),
    enabled: !!compareMonthA && activeTab === 'compare'
  });

  const { data: compareDataB } = useQuery({
    queryKey: ['summary', compareMonthB?.from, compareMonthB?.to],
    queryFn: () => fetchSummary(compareMonthB.from, compareMonthB.to),
    enabled: !!compareMonthB && activeTab === 'compare'
  });

  const { data: byServiceA = [] } = useQuery({
    queryKey: ['byService', compareMonthA?.from, compareMonthA?.to],
    queryFn: () => fetchByService(compareMonthA.from, compareMonthA.to),
    enabled: !!compareMonthA && activeTab === 'compare'
  });

  const { data: byServiceB = [] } = useQuery({
    queryKey: ['byService', compareMonthB?.from, compareMonthB?.to],
    queryFn: () => fetchByService(compareMonthB.from, compareMonthB.to),
    enabled: !!compareMonthB && activeTab === 'compare'
  });

  const { data: byProjectA = [] } = useQuery({
    queryKey: ['byProject', compareMonthA?.from, compareMonthA?.to],
    queryFn: () => fetchByProject(compareMonthA.from, compareMonthA.to),
    enabled: !!compareMonthA && activeTab === 'compare'
  });

  const { data: byProjectB = [] } = useQuery({
    queryKey: ['byProject', compareMonthB?.from, compareMonthB?.to],
    queryFn: () => fetchByProject(compareMonthB.from, compareMonthB.to),
    enabled: !!compareMonthB && activeTab === 'compare'
  });

  return {
    compareMonthA,
    setCompareMonthA,
    compareMonthB,
    setCompareMonthB,
    compareSort,
    handleCompareSort,
    compareDataA,
    compareDataB,
    byServiceA,
    byServiceB,
    byProjectA,
    byProjectB,
  };
};

export { useCompareTab };
