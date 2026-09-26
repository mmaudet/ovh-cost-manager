import { describe, it, expect } from 'vitest';
import { useBackupTab } from '../../src/tabs/useBackupTab.js';
import { months } from '../fixtures/calendar.js';
import { api } from '../support/api.js';
import { renderTabHook } from '../support/hooks.jsx';

// The data query of the Backup tab, as the dashboard shell sees it: what the hook requests
// and returns for the selected month and the active tab.

const [september, august] = months;

describe('useBackupTab', () => {
  it.each(['overview', 'compare', 'trends', 'inventory', 'infrastructure', 'webcloud'])(
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
      .toMatchObject({ status: 'pending', fetchStatus: 'idle', error: null });
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
    });
  });

  // The cache is the page's: each month keeps its own answer there, and the end of an
  // import invalidates it by the name of its query
  it('caches the answer under the name of its query and its month', async () => {
    const { queryClient } = await renderTabHook(useBackupTab,
      { selectedMonth: september, activeTab: 'backup' });
    const keys = queryClient.getQueriesData({ queryKey: ['backupStats'] })
      .map(([queryKey]) => queryKey);

    expect(keys).toEqual([['backupStats', '2026-09-01', '2026-09-30']]);
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
