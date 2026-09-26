import { describe, it, expect } from 'vitest';
import { act } from '@testing-library/react';
import { useTrendsTab } from '../../src/tabs/useTrendsTab.js';
import { account } from '../fixtures/account.js';
import { months } from '../fixtures/calendar.js';
import { sinceJuly2025 } from '../fixtures/trends.js';
import { api } from '../support/api.js';
import { renderTabHook, TAB_IDS } from '../support/hooks.jsx';
import { settle } from '../support/query-client.js';

// The state and data queries of the Trends tab, as the dashboard shell sees them: what the
// hook requests and returns for the months list and the active tab. "Today" is 15 September
// 2026 (see setup.js).

// The account first billed in July 2025: 15 months of history
const fifteenMonths = sinceJuly2025.months;
const billedSinceJuly2025 = { ...account, ...sinceJuly2025 };

// The periods offered, as [months, translation key]
const periods = (options) => options.map(({ months: count, key }) => [count, key]);
// A cost trend, as [month, cost]
const costs = (trend) => trend.map(({ yearMonth, cost }) => [yearMonth, cost]);

describe('useTrendsTab', () => {
  // The months list has not loaded yet when the page starts
  it.each(TAB_IDS)('requests the trends over 6 months at page start on the %s tab',
    async (activeTab) => {
      const { result } = await renderTabHook(useTrendsTab, { months: [], activeTab });

      expect(api.fetchMonthlyTrend).toHaveBeenCalledWith(6);
      expect(api.fetchMonthlyTrendByCategory).toHaveBeenCalledWith(6);
      expect(result.current.trendPeriod).toBe(6);
      expect(costs(result.current.monthlyTrend))
        .toEqual([['2026-07', 980], ['2026-08', 1042], ['2026-09', 1250.4]]);
      expect(result.current.trendByCategory.categories.map(({ label }) => label))
        .toEqual(['Public Cloud', 'Dedicated Servers', 'Backup', 'Domains', 'Licenses']);
    });

  it.each(TAB_IDS.filter((tab) => tab !== 'trends'))(
    'leaves the GPU trend out while the %s tab is active',
    async (activeTab) => {
      const { result } = await renderTabHook(useTrendsTab, { months, activeTab });

      expect(api.fetchGpuSummary).not.toHaveBeenCalled();
      expect(result.current.gpuTrend).toBeUndefined();
    },
  );

  it('requests the GPU trend over all the billed months once the tab opens', async () => {
    const { result, rerender } = await renderTabHook(useTrendsTab,
      { months, activeTab: 'overview' });
    expect(api.fetchGpuSummary).not.toHaveBeenCalled();

    await rerender({ months, activeTab: 'trends' });

    // No period: every month
    expect(api.fetchGpuSummary).toHaveBeenCalledWith();
    expect(result.current.gpuTrend.total).toBe(730.5);
    expect(result.current.gpuTrend.monthlyTrend).toEqual([
      { month: '2026-08', total: 310 },
      { month: '2026-09', total: 420.5 },
    ]);
  });

  it('caches each answer under the name of its query and its period', async () => {
    const { result, queryClient, keysOf } = await renderTabHook(useTrendsTab,
      { months: fifteenMonths, activeTab: 'trends' }, billedSinceJuly2025);

    act(() => result.current.setTrendPeriod(24));
    await settle(queryClient);

    expect(keysOf('monthlyTrend')).toEqual([['monthlyTrend', 6], ['monthlyTrend', 24]]);
    expect(keysOf('monthlyTrendByCategory'))
      .toEqual([['monthlyTrendByCategory', 6], ['monthlyTrendByCategory', 24]]);
    // Every month, whatever the period
    expect(keysOf('gpuTrend')).toEqual([['gpuTrend']]);
  });

  describe('period', () => {
    it('offers the periods up to the first one that covers the billed months', async () => {
      const { result } = await renderTabHook(useTrendsTab,
        { months: fifteenMonths, activeTab: 'trends' }, billedSinceJuly2025);

      // 15 months: 2 years is the first period that covers them, 6 months is offered
      expect(periods(result.current.availablePeriods))
        .toEqual([[3, 'period3m'], [6, 'period6m'], [12, 'period1y'], [24, 'period2y']]);
      expect(result.current.trendPeriod).toBe(6);
    });

    it('comes down to 3 months once the list shows three billed months', async () => {
      const { result, rerender } = await renderTabHook(useTrendsTab,
        { months: [], activeTab: 'overview' });
      // No month yet: the period waits for the list
      expect(result.current.trendPeriod).toBe(6);

      await rerender({ months, activeTab: 'overview' });

      expect(periods(result.current.availablePeriods)).toEqual([[3, 'period3m']]);
      expect(result.current.trendPeriod).toBe(3);
      expect(api.fetchMonthlyTrend).toHaveBeenCalledWith(3);
      expect(api.fetchMonthlyTrendByCategory).toHaveBeenCalledWith(3);
    });

    it('comes down from the period picked when the months list gets shorter', async () => {
      const { result, rerender, queryClient } = await renderTabHook(useTrendsTab,
        { months: fifteenMonths, activeTab: 'trends' }, billedSinceJuly2025);
      act(() => result.current.setTrendPeriod(24));
      await settle(queryClient);
      expect(result.current.trendPeriod).toBe(24);

      // Only the last three months are left: 3 months cover them all
      await rerender({ months, activeTab: 'trends' });

      expect(periods(result.current.availablePeriods)).toEqual([[3, 'period3m']]);
      expect(result.current.trendPeriod).toBe(3);
    });
  });

  it('hides a resource type on a first toggle and shows it on a second', async () => {
    const { result } = await renderTabHook(useTrendsTab, { months, activeTab: 'trends' });
    expect([...result.current.hiddenCategories]).toEqual([]);

    act(() => result.current.toggleCategory('dedicated_server'));
    act(() => result.current.toggleCategory('backup'));
    expect([...result.current.hiddenCategories]).toEqual(['dedicated_server', 'backup']);

    act(() => result.current.toggleCategory('dedicated_server'));
    expect([...result.current.hiddenCategories]).toEqual(['backup']);
  });

  it('keeps the period and the hidden resource types when another tab opens', async () => {
    const { result, rerender } = await renderTabHook(useTrendsTab,
      { months: fifteenMonths, activeTab: 'trends' }, billedSinceJuly2025);

    act(() => result.current.setTrendPeriod(12));
    act(() => result.current.toggleCategory('dedicated_server'));
    await rerender({ months: fifteenMonths, activeTab: 'overview' });

    expect(result.current.trendPeriod).toBe(12);
    expect([...result.current.hiddenCategories]).toEqual(['dedicated_server']);
  });
});
