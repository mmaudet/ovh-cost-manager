import { describe, it, expect } from 'vitest';
import { act } from '@testing-library/react';
import { useWebCloudTab } from '../../src/tabs/useWebCloudTab.js';
import { months } from '../fixtures/calendar.js';
import { api } from '../support/api.js';
import { renderTabHook, TAB_IDS } from '../support/hooks.jsx';

// The state and data queries of the Web Cloud tab, as the dashboard shell sees them: what
// the hook requests and returns for the selected month and the active tab.

const [september, august] = months;
// A month as /api/months lists it, at the turn of a year
const january = {
  value: '2026-01', label: 'Janvier 2026', from: '2026-01-01', to: '2026-01-31',
};

// The services of a period, as [family, name, cost]
const services = (items) => items.map(({ category, name, total }) => [category, name, total]);

describe('useWebCloudTab', () => {
  it.each(TAB_IDS.filter((tab) => tab !== 'webcloud'))(
    'requests nothing while the %s tab is active',
    async (activeTab) => {
      const { result } = await renderTabHook(useWebCloudTab,
        { selectedMonth: september, activeTab });

      expect(api.fetchWebCloudSummary).not.toHaveBeenCalled();
      expect(api.fetchWebCloudItems).not.toHaveBeenCalled();
      expect(result.current.webCloudSummary).toBeUndefined();
      expect(result.current.webCloudItems).toEqual([]);
    },
  );

  it('requests nothing before a month is selected', async () => {
    const { result, queryClient } = await renderTabHook(useWebCloudTab,
      { selectedMonth: null, activeTab: 'webcloud' });

    expect(api.fetchWebCloudSummary).not.toHaveBeenCalled();
    expect(api.fetchWebCloudItems).not.toHaveBeenCalled();
    expect(result.current.webCloudPeriod).toBeNull();
    // Both queries wait for a month, rather than failing for the lack of one
    const waiting = { status: 'pending', fetchStatus: 'idle', error: null };
    expect(queryClient.getQueryState(['webCloudSummary', undefined, undefined]))
      .toMatchObject(waiting);
    expect(queryClient.getQueryState(['webCloudItems', undefined, undefined]))
      .toMatchObject(waiting);
  });

  it('requests the 12 months that end on the selected month once the tab opens', async () => {
    const { rerender } = await renderTabHook(useWebCloudTab,
      { selectedMonth: september, activeTab: 'overview' });

    await rerender({ selectedMonth: september, activeTab: 'webcloud' });

    expect(api.fetchWebCloudSummary).toHaveBeenCalledWith('2025-10-01', '2026-09-30');
    expect(api.fetchWebCloudItems).toHaveBeenCalledWith('2025-10-01', '2026-09-30');
  });

  it('returns the period, and the summary and the services billed over it', async () => {
    const { result } = await renderTabHook(useWebCloudTab,
      { selectedMonth: september, activeTab: 'webcloud' });

    expect(result.current.webCloudPeriod).toEqual({ from: '2025-10-01', to: '2026-09-30' });
    expect(result.current.webCloudSummary).toEqual({
      domain: { count: 2, total: 28.48 },
      dns_zone: { count: 1, total: 1.2 },
      hosting: { count: 1, total: 71.88 },
      email: { count: 2, total: 44.52 },
      option: { count: 1, total: 11.88 },
      total: 157.96,
    });
    // Most expensive first, as the server sorts them
    expect(services(result.current.webCloudItems)).toEqual([
      ['hosting', 'example.com', 71.88],
      ['email', 'example.com', 47.52],
      ['domain', 'example.com', 15.99],
      ['domain', 'example.org', 12.49],
      ['option', 'example.com', 11.88],
      ['dns_zone', 'example.com', 1.2],
      ['email', 'example.org', -3],
    ]);
  });

  it('caches each answer under the name of its query and its period', async () => {
    const { keysOf } = await renderTabHook(useWebCloudTab,
      { selectedMonth: september, activeTab: 'webcloud' });

    expect(keysOf('webCloudSummary')).toEqual([['webCloudSummary', '2025-10-01', '2026-09-30']]);
    expect(keysOf('webCloudItems')).toEqual([['webCloudItems', '2025-10-01', '2026-09-30']]);
  });

  it('follows the selected month', async () => {
    const { result, rerender } = await renderTabHook(useWebCloudTab,
      { selectedMonth: september, activeTab: 'webcloud' });

    await rerender({ selectedMonth: august, activeTab: 'webcloud' });

    expect(api.fetchWebCloudSummary).toHaveBeenCalledWith('2025-09-01', '2026-08-31');
    expect(api.fetchWebCloudItems).toHaveBeenCalledWith('2025-09-01', '2026-08-31');
    expect(result.current.webCloudPeriod).toEqual({ from: '2025-09-01', to: '2026-08-31' });
    expect(result.current.webCloudSummary.total).toBe(87.87);
    expect(services(result.current.webCloudItems)).toEqual([
      ['hosting', 'example.com', 71.88],
      ['domain', 'example.com', 15.99],
    ]);
  });

  // The period itself is unit tested with webCloudPeriodEndingOn()
  it('requests the 12 months that end on a January from the February before', async () => {
    const { result } = await renderTabHook(useWebCloudTab,
      { selectedMonth: january, activeTab: 'webcloud' });

    expect(result.current.webCloudPeriod).toEqual({ from: '2025-02-01', to: '2026-01-31' });
    expect(api.fetchWebCloudSummary).toHaveBeenCalledWith('2025-02-01', '2026-01-31');
    expect(api.fetchWebCloudItems).toHaveBeenCalledWith('2025-02-01', '2026-01-31');
  });

  it('keeps the family of the "show all" modal when another tab opens', async () => {
    const { result, rerender } = await renderTabHook(useWebCloudTab,
      { selectedMonth: september, activeTab: 'webcloud' });
    expect(result.current.showAllWebCloud).toBeNull();

    act(() => result.current.setShowAllWebCloud('email'));
    await rerender({ selectedMonth: september, activeTab: 'overview' });

    expect(result.current.showAllWebCloud).toBe('email');
  });
});
