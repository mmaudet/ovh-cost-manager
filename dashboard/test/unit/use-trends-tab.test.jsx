import { describe, it, expect } from 'vitest';
import { act } from '@testing-library/react';
import { useTrendsTab } from '../../src/tabs/useTrendsTab.js';
import { account } from '../fixtures/account.js';
import {
  lyonAccount, severalAccounts, severalAccountsWithAiEndpoints,
} from '../fixtures/accounts.js';
import { months } from '../fixtures/calendar.js';
import { aiEndpoints } from '../fixtures/public-cloud.js';
import { septemberBilledLate, sinceJuly2025 } from '../fixtures/trends.js';
import { api } from '../support/api.js';
import { renderTabHook, TAB_IDS, WAITING } from '../support/hooks.jsx';
import { settle } from '../support/query-client.js';

// The state and data queries of the Trends tab, as the dashboard shell sees them: what the
// hook requests and returns for the months list, the selected month, the active tab and the
// account shown. "Today" is 15 September 2026 (see setup.js).

const [september, august, july] = months;
// The account first billed in July 2025: 15 months of history
const fifteenMonths = sinceJuly2025.months;
const july2025 = fifteenMonths[fifteenMonths.length - 1];
const billedSinceJuly2025 = { ...account, ...sinceJuly2025 };

// The account shown when the page shows all accounts, as the shell holds it (#120)
const allAccounts = null;
// What the shell passes the hook (ADR 0001): the months list of the account shown, the month
// selected and whether that list holds it, which the shell checks as below, the active tab,
// and the account shown, all accounts unless told otherwise
const shellProps = (props) => ({
  holdsSelectedMonth: props.months.some(({ value }) => value === props.selectedMonth?.value),
  selectedAccount: allAccounts,
  ...props,
});

// The periods offered, as [months, translation key]
const periods = (options) => options.map(({ months: count, key }) => [count, key]);
// A cost trend, as [month, cost]
const costs = (trend) => trend.map(({ yearMonth, cost }) => [yearMonth, cost]);
// The resource types of the cost trend by resource type, most expensive first
const resourceTypes = (trend) => trend.categories.map(({ label }) => label);

describe('useTrendsTab', () => {
  // The months list has not loaded yet when the page starts: no month is selected
  it.each(TAB_IDS)('waits for a month before requesting the trends on the %s tab',
    async (activeTab) => {
      const { result, queryClient } = await renderTabHook(useTrendsTab,
        shellProps({ months: [], selectedMonth: null, activeTab }));

      expect(api.fetchMonthlyTrend).not.toHaveBeenCalled();
      expect(api.fetchMonthlyTrendByCategory).not.toHaveBeenCalled();
      expect(api.fetchGpuSummary).not.toHaveBeenCalled();
      // They wait for the month their period ends on, rather than failing for the lack of it
      expect(queryClient.getQueryState(['monthlyTrend', 3, undefined])).toMatchObject(WAITING);
      expect(queryClient.getQueryState(['monthlyTrendByCategory', 3, undefined]))
        .toMatchObject(WAITING);
      expect(queryClient.getQueryState(['gpuTrend', undefined, undefined]))
        .toMatchObject(WAITING);
      // No month to count the billed months up to: 3 months are the only period offered
      expect(result.current.trendPeriod).toBe(3);
      expect(result.current.monthlyTrend).toEqual([]);
      expect(result.current.trendByCategory).toEqual({ categories: [], data: [] });
      expect(result.current.gpuTrend).toBeUndefined();
    });

  it.each(TAB_IDS)('requests the trends that end on the selected month on the %s tab',
    async (activeTab) => {
      const { result } = await renderTabHook(useTrendsTab,
        shellProps({ months, selectedMonth: september, activeTab }));

      // Over 3 months, the longest period that three billed months allow
      expect(api.fetchMonthlyTrend).toHaveBeenLastCalledWith(3, '2026-09', allAccounts);
      expect(api.fetchMonthlyTrendByCategory)
        .toHaveBeenLastCalledWith(3, '2026-09', allAccounts);
      expect(result.current.trendPeriod).toBe(3);
      expect(costs(result.current.monthlyTrend))
        .toEqual([['2026-07', 980], ['2026-08', 1042], ['2026-09', 1250.4]]);
      expect(resourceTypes(result.current.trendByCategory))
        .toEqual(['Public Cloud', 'Dedicated Servers', 'Backup', 'Domains', 'Licenses']);
    });

  it('requests the trends over the same period again when another month is selected',
    async () => {
      const { result, rerender } = await renderTabHook(useTrendsTab,
        shellProps({ months: fifteenMonths, selectedMonth: september, activeTab: 'trends' }),
        billedSinceJuly2025);

      await rerender(
        shellProps({ months: fifteenMonths, selectedMonth: august, activeTab: 'trends' }),
      );

      expect(api.fetchMonthlyTrend).toHaveBeenLastCalledWith(6, '2026-08', allAccounts);
      expect(api.fetchMonthlyTrendByCategory)
        .toHaveBeenLastCalledWith(6, '2026-08', allAccounts);
      expect(api.fetchGpuSummary)
        .toHaveBeenLastCalledWith('2026-03-01', '2026-08-31', allAccounts);
      expect(result.current.trendPeriod).toBe(6);
      // March to August: March to June, not billed, come at 0 € (#65)
      expect(costs(result.current.monthlyTrend)).toEqual([
        ['2026-03', 0], ['2026-04', 0], ['2026-05', 0], ['2026-06', 0],
        ['2026-07', 980], ['2026-08', 1042],
      ]);
      expect(resourceTypes(result.current.trendByCategory))
        .toEqual(['Public Cloud', 'Dedicated Servers', 'Domains', 'Backup']);
    });

  it.each(TAB_IDS.filter((tab) => tab !== 'trends'))(
    'leaves the GPU trend out while the %s tab is active',
    async (activeTab) => {
      const { result } = await renderTabHook(useTrendsTab,
        shellProps({ months, selectedMonth: september, activeTab }));

      expect(api.fetchGpuSummary).not.toHaveBeenCalled();
      expect(result.current.gpuTrend).toBeUndefined();
    },
  );

  it('requests the GPU trend over the period once the tab opens', async () => {
    const { result, rerender } = await renderTabHook(useTrendsTab,
      shellProps({ months, selectedMonth: september, activeTab: 'overview' }));
    expect(api.fetchGpuSummary).not.toHaveBeenCalled();

    await rerender(shellProps({ months, selectedMonth: september, activeTab: 'trends' }));

    // The same 3 months as the cost trends, from their first day to their last
    expect(api.fetchGpuSummary).toHaveBeenCalledWith('2026-07-01', '2026-09-30', allAccounts);
    expect(result.current.gpuTrend.total).toBe(730.5);
    expect(result.current.gpuTrend.monthlyTrend).toEqual([
      { month: '2026-08', total: 310 },
      { month: '2026-09', total: 420.5 },
    ]);
  });

  it('caches each answer under the name of its query, its period and its last month',
    async () => {
      const { result, rerender, queryClient, keysOf } = await renderTabHook(useTrendsTab,
        shellProps({ months: fifteenMonths, selectedMonth: september, activeTab: 'trends' }),
        billedSinceJuly2025);

      act(() => result.current.setTrendPeriod(24));
      await settle(queryClient);
      await rerender(
        shellProps({ months: fifteenMonths, selectedMonth: august, activeTab: 'trends' }),
      );

      // For all accounts, the keys name none (ADR 0001)
      expect(keysOf('monthlyTrend')).toEqual([
        ['monthlyTrend', 6, '2026-09'],
        ['monthlyTrend', 24, '2026-09'],
        ['monthlyTrend', 24, '2026-08'],
      ]);
      expect(keysOf('monthlyTrendByCategory')).toEqual([
        ['monthlyTrendByCategory', 6, '2026-09'],
        ['monthlyTrendByCategory', 24, '2026-09'],
        ['monthlyTrendByCategory', 24, '2026-08'],
      ]);
      // The same months, as dates
      expect(keysOf('gpuTrend')).toEqual([
        ['gpuTrend', '2026-04-01', '2026-09-30'],
        ['gpuTrend', '2024-10-01', '2026-09-30'],
        ['gpuTrend', '2024-09-01', '2026-08-31'],
      ]);
    });

  // The cost of each AI Endpoints model month by month (#196), over the months of the GPU
  // trend: see fixtures/public-cloud.js and fixtures/accounts.js
  describe('AI Endpoints trend', () => {
    // The synthetic account, whose projects called AI Endpoints models
    const withAiEndpoints = { ...account, aiEndpoints };
    // The models of an answer, by name, in its order
    const models = ({ models: list }) => list.map(({ model }) => model);

    it.each(TAB_IDS.filter((tab) => tab !== 'trends'))(
      'is left out while the %s tab is active',
      async (activeTab) => {
        const { result } = await renderTabHook(useTrendsTab,
          shellProps({ months, selectedMonth: september, activeTab }), withAiEndpoints);

        expect(api.fetchAiEndpoints).not.toHaveBeenCalled();
        expect(result.current.aiEndpointsTrend).toBeUndefined();
      },
    );

    it('is requested over the period once the tab opens', async () => {
      const { result, rerender } = await renderTabHook(useTrendsTab,
        shellProps({ months, selectedMonth: september, activeTab: 'overview' }),
        withAiEndpoints);

      await rerender(shellProps({ months, selectedMonth: september, activeTab: 'trends' }));

      // The months of the GPU trend, from their first day to their last
      expect(api.fetchAiEndpoints).toHaveBeenCalledWith('2026-07-01', '2026-09-30', allAccounts);
      expect(result.current.aiEndpointsTrend).toEqual(aiEndpoints['2026-07/2026-09']);
    });

    it('waits for a month', async () => {
      const { result, queryClient } = await renderTabHook(useTrendsTab,
        shellProps({ months: [], selectedMonth: null, activeTab: 'trends' }), withAiEndpoints);

      expect(api.fetchAiEndpoints).not.toHaveBeenCalled();
      expect(queryClient.getQueryState(['aiEndpointsTrend', undefined, undefined]))
        .toMatchObject(WAITING);
      expect(result.current.aiEndpointsTrend).toBeUndefined();
    });

    // A trend up to a month that the account lacks would never show (#115, #120)
    it('waits until the months list holds the month selected', async () => {
      const { result } = await renderTabHook(useTrendsTab,
        shellProps({ months: [august, july], selectedMonth: september, activeTab: 'trends' }),
        withAiEndpoints);

      expect(api.fetchAiEndpoints).not.toHaveBeenCalled();
      expect(result.current.aiEndpointsTrend).toBeUndefined();
    });

    it('follows the period and the month selected', async () => {
      const { result, rerender, queryClient, keysOf } = await renderTabHook(useTrendsTab,
        shellProps({ months: fifteenMonths, selectedMonth: september, activeTab: 'trends' }),
        { ...billedSinceJuly2025, aiEndpoints });

      act(() => result.current.setTrendPeriod(24));
      await settle(queryClient);

      expect(api.fetchAiEndpoints)
        .toHaveBeenLastCalledWith('2024-10-01', '2026-09-30', allAccounts);
      expect(models(result.current.aiEndpointsTrend)).toEqual([
        'gpt-oss-120b', 'gpt-oss-20b', 'bge-m3', 'whisper-large-v3', 'Mistral-7B-Instruct-v0.3',
        'stable-diffusion-xl-base-v10',
      ]);

      await rerender(
        shellProps({ months: fifteenMonths, selectedMonth: august, activeTab: 'trends' }),
      );

      expect(api.fetchAiEndpoints)
        .toHaveBeenLastCalledWith('2024-09-01', '2026-08-31', allAccounts);
      // The same months as the GPU trend's, and for all accounts, keys that name none
      expect(keysOf('aiEndpointsTrend')).toEqual([
        ['aiEndpointsTrend', '2026-04-01', '2026-09-30'],
        ['aiEndpointsTrend', '2024-10-01', '2026-09-30'],
        ['aiEndpointsTrend', '2024-09-01', '2026-08-31'],
      ]);
    });

    it('is requested for the account shown, under a key that names it', async () => {
      const lyonMonths = severalAccounts.ofAccount[lyonAccount.id].months;
      const { result, keysOf } = await renderTabHook(useTrendsTab,
        shellProps({
          months: lyonMonths, selectedMonth: september, activeTab: 'trends',
          selectedAccount: lyonAccount.id,
        }),
        severalAccountsWithAiEndpoints);

      expect(api.fetchAiEndpoints)
        .toHaveBeenCalledWith('2026-07-01', '2026-09-30', lyonAccount.id);
      expect(models(result.current.aiEndpointsTrend)).toEqual([
        'gpt-oss-120b', 'gpt-oss-20b', 'bge-m3', 'Mistral-7B-Instruct-v0.3',
      ]);
      // The account after the other parts of the key (ADR 0001)
      expect(keysOf('aiEndpointsTrend'))
        .toEqual([['aiEndpointsTrend', '2026-07-01', '2026-09-30', lyonAccount.id]]);
    });

    // An account remembered from an earlier visit, until the accounts list tells whether the
    // page still offers it
    it('waits until the page knows the account shown', async () => {
      const { result, queryClient } = await renderTabHook(useTrendsTab,
        shellProps({
          months, selectedMonth: september, activeTab: 'trends', selectedAccount: undefined,
        }),
        severalAccountsWithAiEndpoints);

      expect(api.fetchAiEndpoints).not.toHaveBeenCalled();
      expect(queryClient.getQueryState(
        ['aiEndpointsTrend', '2026-07-01', '2026-09-30', undefined],
      )).toMatchObject(WAITING);
      expect(result.current.aiEndpointsTrend).toBeUndefined();
    });
  });

  // As while the months list of the account just selected loads, or when that account lacks
  // the month selected, until the shell selects its latest month (#115): the shell then says
  // the list does not hold the month (holdsSelectedMonth), and the periods offered would
  // count the months of no list, or would end on a month the account lacks (#120)
  describe('months list without the selected month', () => {
    it.each([
      ['while it loads', []],
      ['when it lacks it', [august, july]],
    ])('asks for no trend %s', async (_, list) => {
      const { result } = await renderTabHook(useTrendsTab,
        shellProps({ months: list, selectedMonth: september, activeTab: 'trends' }));

      expect(api.fetchMonthlyTrend).not.toHaveBeenCalled();
      expect(api.fetchMonthlyTrendByCategory).not.toHaveBeenCalled();
      expect(api.fetchGpuSummary).not.toHaveBeenCalled();
      expect(result.current.monthlyTrend).toEqual([]);
    });

    it('asks for the trends over the period that the list offers, once it holds the month',
      async () => {
        const { rerender } = await renderTabHook(useTrendsTab,
          shellProps({ months: [], selectedMonth: september, activeTab: 'trends' }),
          billedSinceJuly2025);

        await rerender(
          shellProps({ months: fifteenMonths, selectedMonth: september, activeTab: 'trends' }),
        );

        // Over the 6 months that 15 billed months offer, not over the 3 of no month
        expect(api.fetchMonthlyTrend).toHaveBeenCalledOnce();
        expect(api.fetchMonthlyTrend).toHaveBeenCalledWith(6, '2026-09', allAccounts);
        expect(api.fetchMonthlyTrendByCategory).toHaveBeenCalledOnce();
        expect(api.fetchMonthlyTrendByCategory).toHaveBeenCalledWith(6, '2026-09', allAccounts);
        expect(api.fetchGpuSummary).toHaveBeenCalledOnce();
        expect(api.fetchGpuSummary)
          .toHaveBeenCalledWith('2026-04-01', '2026-09-30', allAccounts);
      });
  });

  // The account shown in the header (#115): the shell passes its months list, and the hook
  // requests its trends (#120)
  describe('account', () => {
    const lyonMonths = severalAccounts.ofAccount[lyonAccount.id].months;
    const inLyon = (props) => shellProps({ ...props, selectedAccount: lyonAccount.id });

    // As while the accounts list loads, which tells whether an account remembered from an
    // earlier visit is still offered
    it('waits until the page knows the account shown', async () => {
      const { result, queryClient } = await renderTabHook(useTrendsTab,
        shellProps({
          months, selectedMonth: september, activeTab: 'trends', selectedAccount: undefined,
        }),
        severalAccounts);

      expect(api.fetchMonthlyTrend).not.toHaveBeenCalled();
      expect(api.fetchMonthlyTrendByCategory).not.toHaveBeenCalled();
      expect(api.fetchGpuSummary).not.toHaveBeenCalled();
      expect(queryClient.getQueryState(['monthlyTrend', 3, '2026-09', undefined]))
        .toMatchObject(WAITING);
      expect(result.current.monthlyTrend).toEqual([]);
    });

    it('requests the trends of the account shown, under keys that name it', async () => {
      const { result, keysOf } = await renderTabHook(useTrendsTab,
        inLyon({ months: lyonMonths, selectedMonth: september, activeTab: 'trends' }),
        severalAccounts);

      expect(api.fetchMonthlyTrend).toHaveBeenCalledWith(3, '2026-09', lyonAccount.id);
      expect(api.fetchMonthlyTrendByCategory)
        .toHaveBeenCalledWith(3, '2026-09', lyonAccount.id);
      expect(api.fetchGpuSummary)
        .toHaveBeenCalledWith('2026-07-01', '2026-09-30', lyonAccount.id);
      expect(costs(result.current.monthlyTrend))
        .toEqual([['2026-07', 680], ['2026-08', 612], ['2026-09', 890.4]]);
      expect(resourceTypes(result.current.trendByCategory))
        .toEqual(['Public Cloud', 'Dedicated Servers', 'Domains', 'Licenses']);
      expect(result.current.gpuTrend.total).toBe(730.5);
      // The account comes after the other parts of each key (ADR 0001)
      expect(keysOf('monthlyTrend')).toEqual([['monthlyTrend', 3, '2026-09', lyonAccount.id]]);
      expect(keysOf('monthlyTrendByCategory'))
        .toEqual([['monthlyTrendByCategory', 3, '2026-09', lyonAccount.id]]);
      expect(keysOf('gpuTrend'))
        .toEqual([['gpuTrend', '2026-07-01', '2026-09-30', lyonAccount.id]]);
    });

    it('requests the trends of all accounts again once they are shown', async () => {
      const { result, rerender, keysOf } = await renderTabHook(useTrendsTab,
        inLyon({ months: lyonMonths, selectedMonth: september, activeTab: 'trends' }),
        severalAccounts);

      await rerender(shellProps({ months, selectedMonth: september, activeTab: 'trends' }));

      expect(api.fetchMonthlyTrend).toHaveBeenLastCalledWith(3, '2026-09', allAccounts);
      expect(costs(result.current.monthlyTrend))
        .toEqual([['2026-07', 980], ['2026-08', 1042], ['2026-09', 1250.4]]);
      expect(result.current.gpuTrend.total).toBe(730.5);
      // Each keeps its answers under its own key
      expect(keysOf('monthlyTrend')).toEqual([
        ['monthlyTrend', 3, '2026-09', lyonAccount.id],
        ['monthlyTrend', 3, '2026-09'],
      ]);
    });
  });

  describe('period', () => {
    it('offers the periods up to the first one that covers the billed months', async () => {
      const { result } = await renderTabHook(useTrendsTab,
        shellProps({ months: fifteenMonths, selectedMonth: september, activeTab: 'trends' }),
        billedSinceJuly2025);

      // 15 months: 2 years is the first period that covers them, 6 months is offered
      expect(periods(result.current.availablePeriods))
        .toEqual([[3, 'period3m'], [6, 'period6m'], [12, 'period1y'], [24, 'period2y']]);
      expect(result.current.trendPeriod).toBe(6);
    });

    it('counts the billed months up to the selected month only', async () => {
      const { result } = await renderTabHook(useTrendsTab,
        shellProps({ months: fifteenMonths, selectedMonth: july2025, activeTab: 'trends' }),
        billedSinceJuly2025);

      // July 2025, the first billed month, is the only one up to itself
      expect(periods(result.current.availablePeriods)).toEqual([[3, 'period3m']]);
      expect(result.current.trendPeriod).toBe(3);
      // Only for the period shown, not for the 6 months of the default
      expect(api.fetchMonthlyTrend).toHaveBeenCalledOnce();
      expect(api.fetchMonthlyTrend).toHaveBeenCalledWith(3, '2025-07', allAccounts);
    });

    it('keeps the period picked through the renders before a month is selected', async () => {
      const { result, rerender } = await renderTabHook(useTrendsTab,
        shellProps({ months: [], selectedMonth: null, activeTab: 'overview' }));

      // The list comes before the shell selects its latest month: no month to count up to
      await rerender(
        shellProps({ months: fifteenMonths, selectedMonth: null, activeTab: 'overview' }),
      );
      await rerender(
        shellProps({ months: fifteenMonths, selectedMonth: september, activeTab: 'overview' }),
      );

      // The 6 months of the default, which 15 billed months allow
      expect(result.current.trendPeriod).toBe(6);
      expect(api.fetchMonthlyTrend).toHaveBeenCalledOnce();
      expect(api.fetchMonthlyTrend).toHaveBeenCalledWith(6, '2026-09', allAccounts);
    });

    it('shows the longest period offered when the one picked is longer', async () => {
      const { result, rerender } = await renderTabHook(useTrendsTab,
        shellProps({ months: [], selectedMonth: null, activeTab: 'overview' }));

      await rerender(shellProps({ months, selectedMonth: september, activeTab: 'overview' }));

      // Three billed months: 3 months, not the 6 of the default, shown and requested
      expect(periods(result.current.availablePeriods)).toEqual([[3, 'period3m']]);
      expect(result.current.trendPeriod).toBe(3);
      expect(api.fetchMonthlyTrend).toHaveBeenCalledOnce();
      expect(api.fetchMonthlyTrend).toHaveBeenCalledWith(3, '2026-09', allAccounts);
      expect(api.fetchMonthlyTrendByCategory).toHaveBeenCalledOnce();
      expect(api.fetchMonthlyTrendByCategory).toHaveBeenCalledWith(3, '2026-09', allAccounts);
    });

    it('keeps the period picked while an older month offers only shorter ones', async () => {
      const { result, rerender, queryClient } = await renderTabHook(useTrendsTab,
        shellProps({ months: fifteenMonths, selectedMonth: september, activeTab: 'trends' }),
        billedSinceJuly2025);
      act(() => result.current.setTrendPeriod(24));
      await settle(queryClient);

      // Up to July 2025, a single billed month: 3 months cover it
      await rerender(
        shellProps({ months: fifteenMonths, selectedMonth: july2025, activeTab: 'trends' }),
      );

      expect(periods(result.current.availablePeriods)).toEqual([[3, 'period3m']]);
      expect(result.current.trendPeriod).toBe(3);
      expect(api.fetchMonthlyTrend).toHaveBeenLastCalledWith(3, '2025-07', allAccounts);
      // Nothing for 2 years up to July 2025, a period that month does not offer
      expect(api.fetchMonthlyTrend).not.toHaveBeenCalledWith(24, '2025-07', allAccounts);
      expect(api.fetchGpuSummary)
        .not.toHaveBeenCalledWith('2023-08-01', '2025-07-31', allAccounts);

      // Back to the latest month: the 2 years picked
      await rerender(
        shellProps({ months: fifteenMonths, selectedMonth: september, activeTab: 'trends' }),
      );

      expect(result.current.trendPeriod).toBe(24);
    });

    it('comes down from the period picked when the months list gets shorter', async () => {
      const { result, rerender, queryClient } = await renderTabHook(useTrendsTab,
        shellProps({ months: fifteenMonths, selectedMonth: september, activeTab: 'trends' }),
        billedSinceJuly2025);
      act(() => result.current.setTrendPeriod(24));
      await settle(queryClient);
      expect(result.current.trendPeriod).toBe(24);

      // Only the last three months are left: 3 months cover them all
      await rerender(shellProps({ months, selectedMonth: september, activeTab: 'trends' }));

      expect(periods(result.current.availablePeriods)).toEqual([[3, 'period3m']]);
      expect(result.current.trendPeriod).toBe(3);
    });
  });

  // The month in progress (#216), as the months list marks it, which the page may project (#217):
  // see fixtures/trends.js, where September has not billed the dedicated servers yet
  describe('month in progress', () => {
    const inProgress = [{ ...september, inProgress: true }, august, july];
    const billedLate = { ...account, ...septemberBilledLate };
    // What the shell passes while the page projects the month in progress
    const projecting = (props) => shellProps({ ...props, projectsMonthInProgress: true });

    it('asks for the trends projected while the page projects it, over a period that covers it',
      async () => {
        const { result, keysOf } = await renderTabHook(useTrendsTab,
          projecting({ months: inProgress, selectedMonth: september, activeTab: 'trends' }),
          billedLate);

        expect(api.fetchMonthlyTrend)
          .toHaveBeenCalledWith(3, '2026-09', allAccounts, { projected: true });
        expect(api.fetchMonthlyTrendByCategory)
          .toHaveBeenCalledWith(3, '2026-09', allAccounts, { projected: true });
        // September at its projected cost
        expect(costs(result.current.monthlyTrend))
          .toEqual([['2026-07', 980], ['2026-08', 1042], ['2026-09', 1250.4]]);
        expect(result.current.monthInProgress).toBe('2026-09');
        expect(result.current.projected).toBe(true);
        // What the cards compare: September at its projected cost
        expect(result.current.periodMonths)
          .toEqual({ includesMonthInProgress: true, projected: true });
        // Under keys that name the flag, after the other parts
        expect(keysOf('monthlyTrend')).toEqual([['monthlyTrend', 3, '2026-09', 'projected']]);
        expect(keysOf('monthlyTrendByCategory'))
          .toEqual([['monthlyTrendByCategory', 3, '2026-09', 'projected']]);
      });

    it('asks for them as before while the page does not project it', async () => {
      const { result, keysOf } = await renderTabHook(useTrendsTab,
        shellProps({ months: inProgress, selectedMonth: september, activeTab: 'trends' }),
        billedLate);

      expect(api.fetchMonthlyTrend).toHaveBeenCalledWith(3, '2026-09', allAccounts);
      expect(api.fetchMonthlyTrend)
        .not.toHaveBeenCalledWith(3, '2026-09', allAccounts, { projected: true });
      // September as billed so far
      expect(costs(result.current.monthlyTrend))
        .toEqual([['2026-07', 980], ['2026-08', 1042], ['2026-09', 980.4]]);
      expect(result.current.monthInProgress).toBe('2026-09');
      expect(result.current.projected).toBe(false);
      // What the cards compare: September at what it billed so far
      expect(result.current.periodMonths)
        .toEqual({ includesMonthInProgress: true, projected: false });
      expect(keysOf('monthlyTrend')).toEqual([['monthlyTrend', 3, '2026-09']]);
    });

    // Complete months are never projected
    it('asks for them as before over a period that ends before it', async () => {
      const { result, keysOf } = await renderTabHook(useTrendsTab,
        projecting({ months: inProgress, selectedMonth: august, activeTab: 'trends' }),
        billedLate);

      expect(api.fetchMonthlyTrend).toHaveBeenCalledWith(3, '2026-08', allAccounts);
      expect(api.fetchMonthlyTrendByCategory).toHaveBeenCalledWith(3, '2026-08', allAccounts);
      expect(result.current.monthInProgress).toBeNull();
      expect(result.current.projected).toBe(false);
      expect(result.current.periodMonths)
        .toEqual({ includesMonthInProgress: false, projected: false });
      expect(keysOf('monthlyTrend')).toEqual([['monthlyTrend', 3, '2026-08']]);
    });

    it('asks for them as before when no month is in progress', async () => {
      const { result } = await renderTabHook(useTrendsTab,
        projecting({ months, selectedMonth: september, activeTab: 'trends' }));

      expect(api.fetchMonthlyTrend).toHaveBeenCalledWith(3, '2026-09', allAccounts);
      expect(result.current.monthInProgress).toBeNull();
      expect(result.current.projected).toBe(false);
    });

    it('asks for them projected once the page projects it, and as before once it stops',
      async () => {
        const props = { months: inProgress, selectedMonth: september, activeTab: 'trends' };
        const { result, rerender } = await renderTabHook(useTrendsTab, shellProps(props),
          billedLate);

        await rerender(projecting(props));

        expect(api.fetchMonthlyTrend)
          .toHaveBeenLastCalledWith(3, '2026-09', allAccounts, { projected: true });
        expect(result.current.monthlyTrend.at(-1).cost).toBe(1250.4);

        await rerender(shellProps(props));

        // Its answers kept in the cache, under their own key
        expect(result.current.monthlyTrend.at(-1).cost).toBe(980.4);
        expect(result.current.projected).toBe(false);
      });

    // The flag before the account (ADR 0001)
    it('names the flag before the account shown in the keys', async () => {
      const lyonMonths = severalAccounts.ofAccount[lyonAccount.id].months
        .map((month) => (month.value === '2026-09' ? { ...month, inProgress: true } : month));
      const { keysOf } = await renderTabHook(useTrendsTab,
        projecting({
          months: lyonMonths, selectedMonth: september, activeTab: 'trends',
          selectedAccount: lyonAccount.id,
        }),
        severalAccounts);

      expect(api.fetchMonthlyTrend)
        .toHaveBeenCalledWith(3, '2026-09', lyonAccount.id, { projected: true });
      expect(keysOf('monthlyTrend'))
        .toEqual([['monthlyTrend', 3, '2026-09', 'projected', lyonAccount.id]]);
      expect(keysOf('monthlyTrendByCategory'))
        .toEqual([['monthlyTrendByCategory', 3, '2026-09', 'projected', lyonAccount.id]]);
    });
  });

  it('hides a resource type on a first toggle and shows it on a second', async () => {
    const { result } = await renderTabHook(useTrendsTab,
      shellProps({ months, selectedMonth: september, activeTab: 'trends' }));
    expect([...result.current.hiddenCategories]).toEqual([]);

    act(() => result.current.toggleCategory('dedicated_server'));
    act(() => result.current.toggleCategory('backup'));
    expect([...result.current.hiddenCategories]).toEqual(['dedicated_server', 'backup']);

    act(() => result.current.toggleCategory('dedicated_server'));
    expect([...result.current.hiddenCategories]).toEqual(['backup']);
  });

  it('keeps the period and the hidden resource types when another tab opens', async () => {
    const { result, rerender } = await renderTabHook(useTrendsTab,
      shellProps({ months: fifteenMonths, selectedMonth: september, activeTab: 'trends' }),
      billedSinceJuly2025);

    act(() => result.current.setTrendPeriod(12));
    act(() => result.current.toggleCategory('dedicated_server'));
    await rerender(
      shellProps({ months: fifteenMonths, selectedMonth: september, activeTab: 'overview' }),
    );

    expect(result.current.trendPeriod).toBe(12);
    expect([...result.current.hiddenCategories]).toEqual(['dedicated_server']);
  });
});
