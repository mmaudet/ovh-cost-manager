import { describe, it, expect } from 'vitest';
import { useBackupTab } from '../../src/tabs/useBackupTab.js';
import { lyonAccount, severalAccounts, unnamedAccount } from '../fixtures/accounts.js';
import { months } from '../fixtures/calendar.js';
import { api } from '../support/api.js';
import { renderTabHook, TAB_IDS, WAITING } from '../support/hooks.jsx';

// The data query of the Backup tab, as the dashboard shell sees it: what the hook requests
// and returns for the selected month, the active tab and the account shown. The shell holds
// the account, which the header selects (#115): null for all accounts, undefined while the
// page does not know it yet. And it tells whether the months of that account hold the month
// selected (#120).

const [september, august] = months;
// The month selected, which the months of the account shown hold, all accounts shown
const onSeptember = { selectedMonth: september, holdsSelectedMonth: true, selectedAccount: null };
const onTheTab = { ...onSeptember, activeTab: 'backup' };

describe('useBackupTab', () => {
  it.each(TAB_IDS.filter((tab) => tab !== 'backup'))(
    'requests nothing while the %s tab is active',
    async (activeTab) => {
      const { result } = await renderTabHook(useBackupTab, { ...onSeptember, activeTab });

      expect(api.fetchBackupStats).not.toHaveBeenCalled();
      expect(result.current.backupStats).toBeUndefined();
    },
  );

  it('requests nothing before a month is selected', async () => {
    const { result, queryClient } = await renderTabHook(useBackupTab,
      { ...onTheTab, selectedMonth: null, holdsSelectedMonth: false });

    expect(api.fetchBackupStats).not.toHaveBeenCalled();
    expect(result.current.backupStats).toBeUndefined();
    // The query waits for a month, rather than failing for the lack of one
    expect(queryClient.getQueryState(['backupStats', undefined, undefined]))
      .toMatchObject(WAITING);
  });

  it('requests the selected month once the tab opens', async () => {
    const { rerender } = await renderTabHook(useBackupTab,
      { ...onSeptember, activeTab: 'overview' });

    await rerender(onTheTab);

    // For all accounts
    expect(api.fetchBackupStats).toHaveBeenCalledWith('2026-09-01', '2026-09-30', null);
  });

  it('returns the Veeam VMs and Enterprise licenses billed in the month', async () => {
    const { result } = await renderTabHook(useBackupTab, onTheTab);

    expect(result.current).toEqual({
      backupStats: { vms: { count: 3, total: 90 }, enterprise: { count: 1, total: 25 } },
      // Answered: the tab shows them (#64)
      loadingBackup: false,
      failedBackup: false,
    });
  });

  // Until then, the tab shows that it is loading, not figures that change once it arrives (#64)
  it('says it is loading until the answer for the month arrives (#64)', async () => {
    const { result, rerender } = await renderTabHook(useBackupTab,
      { ...onSeptember, activeTab: 'overview' });
    // What the hook says as the request leaves, and once its answer arrived
    const loading = [];
    const loadingUntilAnswered = async (props) => {
      const answered = rerender(props);
      loading.push(result.current.loadingBackup);
      await answered;
      loading.push(result.current.loadingBackup);
    };

    await loadingUntilAnswered(onTheTab);
    // Another month waits for its own answer
    await loadingUntilAnswered({ ...onTheTab, selectedMonth: august });

    expect(loading).toEqual([true, false, true, false]);
  });

  // The tab then says so (#64)
  it('says the answer could not be loaded once it fails (#64)', async () => {
    const { result, rerender } = await renderTabHook(useBackupTab, onTheTab);
    expect(result.current.failedBackup).toBe(false);
    api.fetchBackupStats.mockRejectedValue(new Error('Request failed with status code 500'));

    await rerender({ ...onTheTab, selectedMonth: august });

    expect(result.current.failedBackup).toBe(true);
    expect(result.current.loadingBackup).toBe(false);
  });

  // The key of the Veeam backups of the Compare tab's months (#32): for all accounts, it names
  // none (ADR 0001)
  it('caches the answer under the name of its query and its month', async () => {
    const { keysOf } = await renderTabHook(useBackupTab, onTheTab);

    expect(keysOf('backupStats')).toEqual([['backupStats', '2026-09-01', '2026-09-30']]);
  });

  it('follows the selected month', async () => {
    const { result, rerender } = await renderTabHook(useBackupTab, onTheTab);

    await rerender({ ...onTheTab, selectedMonth: august });

    expect(api.fetchBackupStats).toHaveBeenCalledWith('2026-08-01', '2026-08-31', null);
    expect(result.current.backupStats).toEqual({
      vms: { count: 2, total: 40 }, enterprise: { count: 0, total: 0 },
    });
  });

  // Several accounts in the instance (#119): see fixtures/accounts.js
  describe('Veeam backups of the account shown', () => {
    const unnamed = unnamedAccount.id;

    // Under the key of those of the Compare tab's months, which follow the account too (ADR 0001)
    it('are requested for that account, and cached under a key that names it', async () => {
      const { result, keysOf } = await renderTabHook(useBackupTab,
        { ...onTheTab, selectedAccount: unnamed }, severalAccounts);

      expect(api.fetchBackupStats).toHaveBeenCalledWith('2026-09-01', '2026-09-30', unnamed);
      expect(result.current.backupStats).toEqual({
        vms: { count: 3, total: 90 }, enterprise: { count: 1, total: 25 },
      });
      expect(keysOf('backupStats'))
        .toEqual([['backupStats', '2026-09-01', '2026-09-30', unnamed]]);
    });

    it('follow the account shown, and all accounts again', async () => {
      const { result, rerender } = await renderTabHook(useBackupTab, onTheTab, severalAccounts);

      // Without any Veeam backup: what the server answers then
      await rerender({ ...onTheTab, selectedAccount: lyonAccount.id });

      expect(result.current.backupStats).toEqual({
        vms: { count: 0, total: 0 }, enterprise: { count: 0, total: 0 },
      });

      await rerender(onTheTab);

      expect(result.current.backupStats.vms).toEqual({ count: 3, total: 90 });
    });

    // While the months of the account just selected load, or when it lacks the month selected,
    // until the shell selects its latest month (#115): the backups of a month it lacks would
    // never show
    it('wait until the months of the account shown hold the month selected', async () => {
      const { result, queryClient } = await renderTabHook(useBackupTab,
        { ...onTheTab, holdsSelectedMonth: false, selectedAccount: unnamed }, severalAccounts);

      expect(api.fetchBackupStats).not.toHaveBeenCalled();
      expect(queryClient.getQueryState(['backupStats', '2026-09-01', '2026-09-30', unnamed]))
        .toMatchObject(WAITING);
      expect(result.current.loadingBackup).toBe(true);
    });

    // An account selected on an earlier visit, until the accounts list tells whether the page
    // still offers it (useSelectedAccount())
    it('wait while the page does not know the account shown', async () => {
      const { queryClient } = await renderTabHook(useBackupTab,
        { ...onTheTab, selectedAccount: undefined }, severalAccounts);

      expect(api.fetchBackupStats).not.toHaveBeenCalled();
      expect(queryClient.getQueryState(['backupStats', '2026-09-01', '2026-09-30', undefined]))
        .toMatchObject(WAITING);
    });
  });
});
