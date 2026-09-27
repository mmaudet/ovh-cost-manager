// The Backup tab's data query, in a hook that the dashboard shell calls on every render:
// see docs/adr/0001-tab-state-lives-in-the-dashboard-shell.md

import { useQuery } from '@tanstack/react-query';
import { fetchBackupStats } from '../services/api.js';
import { accountQuery } from '../utils/accounts.js';

/**
 * The data query of the Backup tab: the Veeam backups of the month selected, for the account
 * shown in the header (#119). The Compare tab's Backup comparison asks for them too, under
 * the same key, the account included (ADR 0001).
 * @param {object} shell - What the dashboard shell passes on, on every render
 * @param {?object} shell.selectedMonth - The month selected in the header
 * @param {boolean} shell.holdsSelectedMonth - Whether the months of the account shown hold
 *   it, as the shell checks it: the query waits until they do, not while they load, nor when
 *   the account lacks the month, until the shell selects its latest month (#115)
 * @param {string} shell.activeTab - The tab open: the query runs on the Backup tab only
 * @param {?string|undefined} shell.selectedAccount - The account shown (useSelectedAccount()):
 *   null for all accounts, undefined while the page does not know it, which the query waits
 *   for
 * @returns {{ backupStats: (object|undefined), loadingBackup: boolean, failedBackup: boolean }}
 *   The backups, and whether the tab shows that they load, or that they could not load
 */
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
