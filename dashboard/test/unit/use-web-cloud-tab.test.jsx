import { describe, it, expect } from 'vitest';
import { act } from '@testing-library/react';
import { useWebCloudTab } from '../../src/tabs/useWebCloudTab.js';
import { lyonAccount, severalAccounts } from '../fixtures/accounts.js';
import { months } from '../fixtures/calendar.js';
import { api } from '../support/api.js';
import { renderTabHook, TAB_IDS, WAITING } from '../support/hooks.jsx';

// The state and data queries of the Web Cloud tab, as the dashboard shell sees them: what
// the hook requests and returns for the selected month, the active tab and the account
// shown, null for all accounts (#122).

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
        { selectedMonth: september, activeTab, selectedAccount: null });

      expect(api.fetchWebCloudSummary).not.toHaveBeenCalled();
      expect(api.fetchWebCloudItems).not.toHaveBeenCalled();
      expect(result.current.webCloudSummary).toBeUndefined();
      expect(result.current.webCloudItems).toEqual([]);
    },
  );

  it('requests nothing before a month is selected', async () => {
    const { result, queryClient } = await renderTabHook(useWebCloudTab,
      { selectedMonth: null, activeTab: 'webcloud', selectedAccount: null });

    expect(api.fetchWebCloudSummary).not.toHaveBeenCalled();
    expect(api.fetchWebCloudItems).not.toHaveBeenCalled();
    expect(result.current.webCloudPeriod).toBeNull();
    // Both queries wait for a month, rather than failing for the lack of one
    expect(queryClient.getQueryState(['webCloudSummary', undefined, undefined]))
      .toMatchObject(WAITING);
    expect(queryClient.getQueryState(['webCloudItems', undefined, undefined]))
      .toMatchObject(WAITING);
  });

  it('requests the 12 months that end on the selected month once the tab opens', async () => {
    const { rerender } = await renderTabHook(useWebCloudTab,
      { selectedMonth: september, activeTab: 'overview', selectedAccount: null });

    await rerender({ selectedMonth: september, activeTab: 'webcloud', selectedAccount: null });

    expect(api.fetchWebCloudSummary).toHaveBeenCalledWith('2025-10-01', '2026-09-30', null);
    expect(api.fetchWebCloudItems).toHaveBeenCalledWith('2025-10-01', '2026-09-30', null);
  });

  it('returns the period, and the summary and the services billed over it', async () => {
    const { result } = await renderTabHook(useWebCloudTab,
      { selectedMonth: september, activeTab: 'webcloud', selectedAccount: null });

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
      { selectedMonth: september, activeTab: 'webcloud', selectedAccount: null });

    expect(keysOf('webCloudSummary')).toEqual([['webCloudSummary', '2025-10-01', '2026-09-30']]);
    expect(keysOf('webCloudItems')).toEqual([['webCloudItems', '2025-10-01', '2026-09-30']]);
  });

  it('follows the selected month', async () => {
    const { result, rerender } = await renderTabHook(useWebCloudTab,
      { selectedMonth: september, activeTab: 'webcloud', selectedAccount: null });

    await rerender({ selectedMonth: august, activeTab: 'webcloud', selectedAccount: null });

    expect(api.fetchWebCloudSummary).toHaveBeenCalledWith('2025-09-01', '2026-08-31', null);
    expect(api.fetchWebCloudItems).toHaveBeenCalledWith('2025-09-01', '2026-08-31', null);
    expect(result.current.webCloudPeriod).toEqual({ from: '2025-09-01', to: '2026-08-31' });
    expect(result.current.webCloudSummary.total).toBe(87.87);
    expect(services(result.current.webCloudItems)).toEqual([
      ['hosting', 'example.com', 71.88],
      ['domain', 'example.com', 15.99],
    ]);
  });

  // Until then, the tab shows that it is loading, not zero services billed (#62)
  it('says it is loading until the answers for the period arrive (#62)', async () => {
    const { result, rerender } = await renderTabHook(useWebCloudTab,
      { selectedMonth: september, activeTab: 'overview', selectedAccount: null });
    // What the hook says as the requests leave, and once their answers arrived
    const loading = [];
    const loadingUntilAnswered = async (props) => {
      const answered = rerender(props);
      loading.push(result.current.loadingWebCloud);
      await answered;
      loading.push(result.current.loadingWebCloud);
    };

    await loadingUntilAnswered(
      { selectedMonth: september, activeTab: 'webcloud', selectedAccount: null },
    );
    // Another period waits for its own answers
    await loadingUntilAnswered(
      { selectedMonth: august, activeTab: 'webcloud', selectedAccount: null },
    );

    expect(loading).toEqual([true, false, true, false]);
  });

  // The tab then says so, rather than that none was billed (#62)
  it.each(['fetchWebCloudSummary', 'fetchWebCloudItems'])(
    'says the answers could not be loaded once %s fails (#62)',
    async (request) => {
      const { result, rerender } = await renderTabHook(useWebCloudTab,
        { selectedMonth: september, activeTab: 'webcloud', selectedAccount: null });
      expect(result.current.failedWebCloud).toBe(false);
      api[request].mockRejectedValue(new Error('Request failed with status code 500'));

      await rerender({ selectedMonth: august, activeTab: 'webcloud', selectedAccount: null });

      expect(result.current.failedWebCloud).toBe(true);
      expect(result.current.loadingWebCloud).toBe(false);
    },
  );

  // The period itself is unit tested with webCloudPeriodEndingOn()
  it('requests the 12 months that end on a January from the February before', async () => {
    const { result } = await renderTabHook(useWebCloudTab,
      { selectedMonth: january, activeTab: 'webcloud', selectedAccount: null });

    expect(result.current.webCloudPeriod).toEqual({ from: '2025-02-01', to: '2026-01-31' });
    expect(api.fetchWebCloudSummary).toHaveBeenCalledWith('2025-02-01', '2026-01-31', null);
    expect(api.fetchWebCloudItems).toHaveBeenCalledWith('2025-02-01', '2026-01-31', null);
  });

  // With several accounts in the instance (#122): see fixtures/accounts.js
  describe('account shown', () => {
    const onTheTab = (selectedAccount) =>
      ({ selectedMonth: september, activeTab: 'webcloud', selectedAccount });

    it('requests the services of the account selected, and caches them under its id',
      async () => {
        const { result, keysOf } = await renderTabHook(useWebCloudTab,
          onTheTab(lyonAccount.id), severalAccounts);

        expect(api.fetchWebCloudSummary)
          .toHaveBeenCalledWith('2025-10-01', '2026-09-30', 'xx1111-ovh');
        expect(api.fetchWebCloudItems)
          .toHaveBeenCalledWith('2025-10-01', '2026-09-30', 'xx1111-ovh');
        expect(result.current.webCloudSummary.total).toBe(111.63);
        expect(services(result.current.webCloudItems)).toEqual([
          ['hosting', 'example.com', 71.88],
          ['domain', 'example.com', 15.99],
          ['email', 'example.com', 11.88],
          ['option', 'example.com', 11.88],
        ]);
        // After the other parts of the key, as the shell's queries that follow the account
        expect(keysOf('webCloudSummary'))
          .toEqual([['webCloudSummary', '2025-10-01', '2026-09-30', 'xx1111-ovh']]);
        expect(keysOf('webCloudItems'))
          .toEqual([['webCloudItems', '2025-10-01', '2026-09-30', 'xx1111-ovh']]);
      });

    it('follows the account selected, and all accounts again', async () => {
      const { result, rerender, keysOf } = await renderTabHook(useWebCloudTab,
        onTheTab(null), severalAccounts);

      await rerender(onTheTab(lyonAccount.id));

      expect(result.current.webCloudSummary.total).toBe(111.63);

      await rerender(onTheTab(null));

      expect(result.current.webCloudSummary.total).toBe(157.96);
      expect(services(result.current.webCloudItems)).toHaveLength(8);
      // Each account keeps its own answers
      expect(keysOf('webCloudItems')).toEqual([
        ['webCloudItems', '2025-10-01', '2026-09-30'],
        ['webCloudItems', '2025-10-01', '2026-09-30', 'xx1111-ovh'],
      ]);
    });

    // Rather than ask for all accounts, while the page may yet show a remembered one
    it('requests nothing while the page does not know the account it shows', async () => {
      const { result, queryClient } = await renderTabHook(useWebCloudTab,
        onTheTab(undefined), severalAccounts);

      expect(api.fetchWebCloudSummary).not.toHaveBeenCalled();
      expect(api.fetchWebCloudItems).not.toHaveBeenCalled();
      expect(result.current.webCloudItems).toEqual([]);
      // Both queries wait for the account, under a key that names none yet
      expect(queryClient.getQueryState(['webCloudSummary', '2025-10-01', '2026-09-30', undefined]))
        .toMatchObject(WAITING);
      expect(queryClient.getQueryState(['webCloudItems', '2025-10-01', '2026-09-30', undefined]))
        .toMatchObject(WAITING);
    });
  });

  it('keeps the family of the "show all" modal when another tab opens', async () => {
    const { result, rerender } = await renderTabHook(useWebCloudTab,
      { selectedMonth: september, activeTab: 'webcloud', selectedAccount: null });
    expect(result.current.showAllWebCloud).toBeNull();

    act(() => result.current.setShowAllWebCloud('email'));
    await rerender({ selectedMonth: september, activeTab: 'overview', selectedAccount: null });

    expect(result.current.showAllWebCloud).toBe('email');
  });
});
