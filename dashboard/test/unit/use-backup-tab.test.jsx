import { describe, it, expect } from 'vitest';
import { useBackupTab } from '../../src/tabs/useBackupTab.js';
import { months } from '../fixtures/calendar.js';
import { api } from '../support/api.js';
import { renderTabHook, TAB_IDS, WAITING } from '../support/hooks.jsx';

// The data query of the Backup tab, as the dashboard shell sees it: what the hook requests
// and returns for the selected month and the active tab.

const [september, august] = months;

describe('useBackupTab', () => {
  it.each(TAB_IDS.filter((tab) => tab !== 'backup'))(
    'requests nothing while the %s tab is active',
    async (activeTab) => {
      const { result } = await renderTabHook(useBackupTab,
        { selectedMonth: september, activeTab });

      expect(api.fetchBackupStats).not.toHaveBeenCalled();
      expect(result.current.backupStats).toBeUndefined();
    },
  );

  it('requests nothing before a month is selected', async () => {
    const { result, queryClient } = await renderTabHook(useBackupTab,
      { selectedMonth: null, activeTab: 'backup' });

    expect(api.fetchBackupStats).not.toHaveBeenCalled();
    expect(result.current.backupStats).toBeUndefined();
    // The query waits for a month, rather than failing for the lack of one
    expect(queryClient.getQueryState(['backupStats', undefined, undefined]))
      .toMatchObject(WAITING);
  });

  it('requests the selected month once the tab opens', async () => {
    const { rerender } = await renderTabHook(useBackupTab,
      { selectedMonth: september, activeTab: 'overview' });

    await rerender({ selectedMonth: september, activeTab: 'backup' });

    expect(api.fetchBackupStats).toHaveBeenCalledWith('2026-09-01', '2026-09-30');
  });

  it('returns the Veeam VMs and Enterprise licenses billed in the month', async () => {
    const { result } = await renderTabHook(useBackupTab,
      { selectedMonth: september, activeTab: 'backup' });

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
      { selectedMonth: september, activeTab: 'overview' });
    // What the hook says as the request leaves, and once its answer arrived
    const loading = [];
    const loadingUntilAnswered = async (props) => {
      const answered = rerender(props);
      loading.push(result.current.loadingBackup);
      await answered;
      loading.push(result.current.loadingBackup);
    };

    await loadingUntilAnswered({ selectedMonth: september, activeTab: 'backup' });
    // Another month waits for its own answer
    await loadingUntilAnswered({ selectedMonth: august, activeTab: 'backup' });

    expect(loading).toEqual([true, false, true, false]);
  });

  // The tab then says so (#64)
  it('says the answer could not be loaded once it fails (#64)', async () => {
    const { result, rerender } = await renderTabHook(useBackupTab,
      { selectedMonth: september, activeTab: 'backup' });
    expect(result.current.failedBackup).toBe(false);
    api.fetchBackupStats.mockRejectedValue(new Error('Request failed with status code 500'));

    await rerender({ selectedMonth: august, activeTab: 'backup' });

    expect(result.current.failedBackup).toBe(true);
    expect(result.current.loadingBackup).toBe(false);
  });

  it('caches the answer under the name of its query and its month', async () => {
    const { keysOf } = await renderTabHook(useBackupTab,
      { selectedMonth: september, activeTab: 'backup' });

    expect(keysOf('backupStats')).toEqual([['backupStats', '2026-09-01', '2026-09-30']]);
  });

  it('follows the selected month', async () => {
    const { result, rerender } = await renderTabHook(useBackupTab,
      { selectedMonth: september, activeTab: 'backup' });

    await rerender({ selectedMonth: august, activeTab: 'backup' });

    expect(api.fetchBackupStats).toHaveBeenCalledWith('2026-08-01', '2026-08-31');
    expect(result.current.backupStats).toEqual({
      vms: { count: 2, total: 40 }, enterprise: { count: 0, total: 0 },
    });
  });
});
