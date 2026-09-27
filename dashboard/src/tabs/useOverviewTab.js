// The Overview tab's state and data queries, in a hook that the dashboard shell calls on
// every render: see docs/adr/0001-tab-state-lives-in-the-dashboard-shell.md
//
// Most of what the tab shows, the shell requests at page start, for the account selected in
// the header, and passes on: the KPI cards, the header, the Markdown report or other tabs
// read it as well. So do the costs by project and the GPU costs, once for each project. The
// budget stays in the shell too, since the month-end forecast card reads it.
//
// The tab queries only what its lists alone show when they name the account of each project,
// with all accounts shown (#118): their projects once for each account that billed them.
// Everything else lists each project once, as before.

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchGpuProjectsByAccount, fetchProjectsByAccount } from '../services/api.js';

// selectedMonth: the month of the header, which the months of the account shown hold when
// holdsSelectedMonth says so, as the shell checks it. showAccountColumn: whether the tab's
// lists name the account of each project (showsAccountColumn()).
const useOverviewTab = ({ selectedMonth, holdsSelectedMonth, showAccountColumn }) => {
  const [projectSort, setProjectSort] = useState({ column: 'total', direction: 'desc' });

  const handleProjectSort = (column) => {
    setProjectSort(prev => ({
      column,
      direction: prev.column === column && prev.direction === 'desc' ? 'asc' : 'desc'
    }));
  };

  // The projects of the month by account, for all accounts, while the lists name the account
  // of each: the breakdown by project, and the GPU costs by project. As the shell's queries of
  // the month, they wait until the months of the account shown hold it.
  const byAccount = (key, fetch) => ({
    queryKey: [key, selectedMonth?.from, selectedMonth?.to],
    queryFn: () => fetch(selectedMonth.from, selectedMonth.to),
    enabled: showAccountColumn && holdsSelectedMonth,
  });
  const { data: projectsByAccount = [] } = useQuery(
    byAccount('projectsByAccount', fetchProjectsByAccount),
  );
  const { data: gpuProjectsByAccount = [] } = useQuery(
    byAccount('gpuProjectsByAccount', fetchGpuProjectsByAccount),
  );

  return {
    projectSort,
    handleProjectSort,
    projectsByAccount,
    gpuProjectsByAccount,
  };
};

export { useOverviewTab };
