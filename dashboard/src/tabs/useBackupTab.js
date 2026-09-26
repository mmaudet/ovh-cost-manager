// The Backup tab's data query, in a hook that the dashboard shell calls on every render:
// see docs/adr/0001-tab-state-lives-in-the-dashboard-shell.md

import { useQuery } from '@tanstack/react-query';
import { fetchBackupStats } from '../services/api.js';

const useBackupTab = ({ selectedMonth, activeTab }) => {
  // Backup stats (Veeam VMs, licenses)
  const { data: backupStats } = useQuery({
    queryKey: ['backupStats', selectedMonth?.from, selectedMonth?.to],
    queryFn: () => fetchBackupStats(selectedMonth.from, selectedMonth.to),
    enabled: !!selectedMonth && activeTab === 'backup'
  });

  return {
    backupStats,
  };
};

export { useBackupTab };
