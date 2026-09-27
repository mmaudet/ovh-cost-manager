// The Compare tab's state and data queries, in a hook that the dashboard shell calls on
// every render: see docs/adr/0001-tab-state-lives-in-the-dashboard-shell.md
//
// Months A and B are months of the months list, that of the account shown in the header
// (#115), which its dropdowns list. They get their defaults when the list first loads: the
// shell then selects the latest month, in the same commit. They get them again when the list
// of an account selected since lacks either of them (#119).

import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  fetchSummary, fetchByProject, fetchByService, fetchByResourceType, fetchBackupStats,
} from '../services/api.js';

const useCompareTab = ({ months, activeTab }) => {
  const [compareMonthA, setCompareMonthA] = useState(null);
  const [compareMonthB, setCompareMonthB] = useState(null);
  const [compareSort, setCompareSort] = useState({ column: 'totalA', direction: 'desc' });

  const handleCompareSort = (column) => {
    setCompareSort(prev => ({
      column,
      direction: prev.column === column && prev.direction === 'desc' ? 'asc' : 'desc'
    }));
  };

  // Whether the months list holds a month compared: not before months A and B have their
  // defaults, nor while the list of the account just selected loads, nor when that account
  // was not billed that month
  const holds = (month) => months.some((m) => m.value === month?.value);
  const holdsMonthA = holds(compareMonthA);
  const holdsMonthB = holds(compareMonthB);

  // Months A and B by default: the second latest billed month and the latest one, or the only
  // month twice. Once the list has loaded without either of them, the tab compares the months
  // it opens on, rather than keep a month that its dropdowns do not list (#119): as the shell
  // selects the latest month of an account that lacks the month selected (#115).
  useEffect(() => {
    if (months.length > 0 && !(holdsMonthA && holdsMonthB)) {
      setCompareMonthA(months[1] ?? months[0]);
      setCompareMonthB(months[0]);
    }
  }, [months, holdsMonthA, holdsMonthB]);

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

  // What the infrastructure, backup and Private Cloud comparisons show (#32): the costs of
  // each resource type, under the key of those the page loads for its selected month, and
  // the Veeam backups, under the key of those the Backup tab loads for it
  const { data: byResourceTypeA = [] } = useQuery({
    queryKey: ['byResourceType', compareMonthA?.from, compareMonthA?.to],
    queryFn: () => fetchByResourceType(compareMonthA.from, compareMonthA.to),
    enabled: !!compareMonthA && activeTab === 'compare',
  });

  const { data: byResourceTypeB = [] } = useQuery({
    queryKey: ['byResourceType', compareMonthB?.from, compareMonthB?.to],
    queryFn: () => fetchByResourceType(compareMonthB.from, compareMonthB.to),
    enabled: !!compareMonthB && activeTab === 'compare',
  });

  const { data: backupStatsA } = useQuery({
    queryKey: ['backupStats', compareMonthA?.from, compareMonthA?.to],
    queryFn: () => fetchBackupStats(compareMonthA.from, compareMonthA.to),
    enabled: !!compareMonthA && activeTab === 'compare',
  });

  const { data: backupStatsB } = useQuery({
    queryKey: ['backupStats', compareMonthB?.from, compareMonthB?.to],
    queryFn: () => fetchBackupStats(compareMonthB.from, compareMonthB.to),
    enabled: !!compareMonthB && activeTab === 'compare',
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
    byResourceTypeA,
    byResourceTypeB,
    backupStatsA,
    backupStatsB,
  };
};

export { useCompareTab };
