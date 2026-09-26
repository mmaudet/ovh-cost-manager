import { describe, it, expect } from 'vitest';
import { act } from '@testing-library/react';
import { useWebCloudTab } from '../../src/tabs/useWebCloudTab.js';
import { months } from '../fixtures/calendar.js';
import { api } from '../support/api.js';
import { renderTabHook } from '../support/hooks.jsx';

// The state and data queries of the Web Cloud tab, as the dashboard shell sees them: what
// the hook requests and returns for the selected month and the active tab.

const [september, august] = months;
// Months as /api/months lists them, at the turn of a year and in a leap year
const january = {
  value: '2026-01', label: 'Janvier 2026', from: '2026-01-01', to: '2026-01-31',
};
const december = {
  value: '2025-12', label: 'Décembre 2025', from: '2025-12-01', to: '2025-12-31',
};
const leapFebruary = {
  value: '2024-02', label: 'Février 2024', from: '2024-02-01', to: '2024-02-29',
};

// The services of a period, as [family, name, cost]
const services = (items) => items.map(({ category, name, total }) => [category, name, total]);

describe('useWebCloudTab', () => {
  it.each(['overview', 'compare', 'trends', 'inventory', 'infrastructure', 'backup'])(
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
    const { result } = await renderTabHook(useWebCloudTab,
      { selectedMonth: null, activeTab: 'webcloud' });

    expect(api.fetchWebCloudSummary).not.toHaveBeenCalled();
    expect(api.fetchWebCloudItems).not.toHaveBeenCalled();
    expect(result.current.webCloudPeriod).toBeNull();
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

  it.each([
    ['January 2026', january, { from: '2025-02-01', to: '2026-01-31' }],
    ['December 2025', december, { from: '2025-01-01', to: '2025-12-31' }],
    ['February 2024, in a leap year', leapFebruary, { from: '2023-03-01', to: '2024-02-29' }],
  ])('covers the 12 months that end on %s', async (_, selectedMonth, period) => {
    const { result } = await renderTabHook(useWebCloudTab,
      { selectedMonth, activeTab: 'webcloud' });

    expect(result.current.webCloudPeriod).toEqual(period);
    expect(api.fetchWebCloudSummary).toHaveBeenCalledWith(period.from, period.to);
    expect(api.fetchWebCloudItems).toHaveBeenCalledWith(period.from, period.to);
  });

  it('lists the Web Cloud families in display order', async () => {
    const { result } = await renderTabHook(useWebCloudTab,
      { selectedMonth: september, activeTab: 'webcloud' });

    expect(result.current.WEB_CLOUD_CATEGORIES.map(({ key, labelKey }) => [key, labelKey]))
      .toEqual([
        ['domain', 'domains'],
        ['dns_zone', 'dnsZones'],
        ['hosting', 'webHosting'],
        ['email', 'emails'],
        ['option', 'hostingOptions'],
      ]);
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
