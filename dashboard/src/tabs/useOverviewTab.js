// The Overview tab's state, in a hook that the dashboard shell calls on every render: see
// docs/adr/0001-tab-state-lives-in-the-dashboard-shell.md
//
// The tab queries nothing of its own: the KPI cards, the header, the Markdown report or
// other tabs read what it shows as well, so the shell requests it at page start and passes
// it on. The budget stays in the shell too, since the month-end forecast card reads it.

import { useState } from 'react';

const useOverviewTab = () => {
  const [projectSort, setProjectSort] = useState({ column: 'total', direction: 'desc' });

  const handleProjectSort = (column) => {
    setProjectSort(prev => ({
      column,
      direction: prev.column === column && prev.direction === 'desc' ? 'asc' : 'desc'
    }));
  };

  return {
    projectSort,
    handleProjectSort,
  };
};

export { useOverviewTab };
