// The Backup tab's data query, in a hook that the dashboard shell calls on every render:
// see docs/adr/0001-tab-state-lives-in-the-dashboard-shell.md

import { useQuery } from '@tanstack/react-query';
import { fetchBackupStats } from '../services/api.js';
import { accountQuery } from '../utils/accounts.js';

// The Veeam backups of the account shown in the header, selectedAccount, the shell's: null for
// all accounts, undefined while the page does not know it yet, which the query waits for. The
// Compare tab's Backup comparison asks for them too, under the same key, the account included
// (#119, ADR 0001). The query waits too until the months of the account shown hold the month
// selected, holdsSelectedMonth, as the shell checks it: not while they load, nor when the
// account lacks the month, until the shell selects its latest month (#115).
const useBackupTab = ({ selectedMonth, holdsSelectedMonth, activeTab, selectedAccount }) => {
  // Backup stats (Veeam VMs, licenses)
  const { data: backupStats, isPending, isError } = useQuery(accountQuery(selectedAccount, {
    key: ['backupStats', selectedMonth?.from, selectedMonth?.to],
    fetch: (account) => fetchBackupStats(selectedMonth.from, selectedMonth.to, account),
    enabled: holdsSelectedMonth && activeTab === 'backup',
  }));

  return {
    backupStats,
    // Until the query has answered, the tab shows that it is loading, and once it failed,
    // that it could not load, as the Web Cloud tab does (#64)
    loadingBackup: isPending,
    failedBackup: isError,
  };
};

export { useBackupTab };
