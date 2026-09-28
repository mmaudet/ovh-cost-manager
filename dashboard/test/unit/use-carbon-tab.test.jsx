import { describe, it, expect } from 'vitest';
import { useCarbonTab } from '../../src/tabs/useCarbonTab.js';
import { lyonAccount, severalAccounts, unnamedAccount } from '../fixtures/accounts.js';
import { months } from '../fixtures/calendar.js';
import { api } from '../support/api.js';
import { renderTabHook, TAB_IDS, WAITING } from '../support/hooks.jsx';

// The data query of the Carbon tab (#147), as the dashboard shell sees it: what the hook
// requests and returns for the selected month, the active tab and the account shown. The
// shell holds the account, which the header selects (#115): null for all accounts, undefined
// while the page does not know it yet. And it tells whether the months of that account hold
// the month selected (#120).

const [september, august, july] = months;
// The month selected, which the months of the account shown hold, all accounts shown
const onAugust = { selectedMonth: august, holdsSelectedMonth: true, selectedAccount: null };
const onTheTab = { ...onAugust, activeTab: 'carbon' };

describe('useCarbonTab', () => {
  it.each(TAB_IDS.filter((tab) => tab !== 'carbon'))(
    'requests nothing while the %s tab is active',
    async (activeTab) => {
      const { result } = await renderTabHook(useCarbonTab, { ...onAugust, activeTab });

      expect(api.fetchCarbonFootprint).not.toHaveBeenCalled();
      expect(result.current.carbonFootprint).toBeUndefined();
    },
  );

  it('requests nothing before a month is selected', async () => {
    const { result, queryClient } = await renderTabHook(useCarbonTab,
      { ...onTheTab, selectedMonth: null, holdsSelectedMonth: false });

    expect(api.fetchCarbonFootprint).not.toHaveBeenCalled();
    expect(result.current.carbonFootprint).toBeUndefined();
    // The query waits for a month, rather than failing for the lack of one
    expect(queryClient.getQueryState(['carbonFootprint', undefined])).toMatchObject(WAITING);
  });

  it('requests the selected month once the tab opens', async () => {
    const { rerender } = await renderTabHook(useCarbonTab, { ...onAugust, activeTab: 'backup' });

    await rerender(onTheTab);

    // For all accounts
    expect(api.fetchCarbonFootprint).toHaveBeenCalledWith('2026-08', null);
  });

  it('returns the carbon footprint of the month', async () => {
    const { result } = await renderTabHook(useCarbonTab, onTheTab);

    expect(result.current).toEqual({
      carbonFootprint: {
        month: '2026-08',
        footprint: {
          manufacturing: 1234.5, electricity: 2345.25, operations: 456.75, total: 4036.5,
        },
      },
      // Answered: the tab shows it (#64)
      loadingCarbon: false,
      failedCarbon: false,
    });
  });

  // Until then, the tab shows that it is loading, not figures that change once it arrives (#64)
  it('says it is loading until the answer for the month arrives', async () => {
    const { result, rerender } = await renderTabHook(useCarbonTab,
      { ...onAugust, activeTab: 'overview' });
    // What the hook says as the request leaves, and once its answer arrived
    const loading = [];
    const loadingUntilAnswered = async (props) => {
      const answered = rerender(props);
      loading.push(result.current.loadingCarbon);
      await answered;
      loading.push(result.current.loadingCarbon);
    };

    await loadingUntilAnswered(onTheTab);
    // Another month waits for its own answer
    await loadingUntilAnswered({ ...onTheTab, selectedMonth: july });

    expect(loading).toEqual([true, false, true, false]);
  });

  it('says the answer could not be loaded once it fails', async () => {
    const { result, rerender } = await renderTabHook(useCarbonTab, onTheTab);
    expect(result.current.failedCarbon).toBe(false);
    api.fetchCarbonFootprint.mockRejectedValue(new Error('Request failed with status code 500'));

    await rerender({ ...onTheTab, selectedMonth: july });

    expect(result.current.failedCarbon).toBe(true);
    expect(result.current.loadingCarbon).toBe(false);
  });

  // For all accounts, the key names none, as the request does not (ADR 0001)
  it('caches the answer under the name of its query and its month', async () => {
    const { keysOf } = await renderTabHook(useCarbonTab, onTheTab);

    expect(keysOf('carbonFootprint')).toEqual([['carbonFootprint', '2026-08']]);
  });

  it('follows the selected month', async () => {
    const { result, rerender } = await renderTabHook(useCarbonTab, onTheTab);

    await rerender({ ...onTheTab, selectedMonth: september });

    // September, the current month, has none
    expect(api.fetchCarbonFootprint).toHaveBeenCalledWith('2026-09', null);
    expect(result.current.carbonFootprint).toEqual({ month: '2026-09', footprint: null });
  });

  // Several accounts in the instance: see fixtures/accounts.js
  describe('carbon footprint of the account shown', () => {
    const unnamed = unnamedAccount.id;

    it('is requested for that account, and cached under a key that names it', async () => {
      const { result, keysOf } = await renderTabHook(useCarbonTab,
        { ...onTheTab, selectedAccount: unnamed }, severalAccounts);

      expect(api.fetchCarbonFootprint).toHaveBeenCalledWith('2026-08', unnamed);
      expect(result.current.carbonFootprint.footprint.total).toBe(2600);
      expect(keysOf('carbonFootprint')).toEqual([['carbonFootprint', '2026-08', unnamed]]);
    });

    it('follows the account shown, and all accounts again', async () => {
      const { result, rerender } = await renderTabHook(useCarbonTab, onTheTab, severalAccounts);

      // Without a footprint: what the server answers then
      await rerender({ ...onTheTab, selectedAccount: lyonAccount.id });

      expect(result.current.carbonFootprint).toEqual({ month: '2026-08', footprint: null });

      await rerender(onTheTab);

      expect(result.current.carbonFootprint.footprint.total).toBe(4036.5);
    });

    // While the months of the account just selected load, or when it lacks the month selected,
    // until the shell selects its latest month (#115)
    it('waits until the months of the account shown hold the month selected', async () => {
      const { result, queryClient } = await renderTabHook(useCarbonTab,
        { ...onTheTab, holdsSelectedMonth: false, selectedAccount: unnamed }, severalAccounts);

      expect(api.fetchCarbonFootprint).not.toHaveBeenCalled();
      expect(queryClient.getQueryState(['carbonFootprint', '2026-08', unnamed]))
        .toMatchObject(WAITING);
      expect(result.current.loadingCarbon).toBe(true);
    });

    // An account selected on an earlier visit, until the accounts list tells whether the page
    // still offers it (useSelectedAccount())
    it('waits while the page does not know the account shown', async () => {
      const { queryClient } = await renderTabHook(useCarbonTab,
        { ...onTheTab, selectedAccount: undefined }, severalAccounts);

      expect(api.fetchCarbonFootprint).not.toHaveBeenCalled();
      expect(queryClient.getQueryState(['carbonFootprint', '2026-08', undefined]))
        .toMatchObject(WAITING);
    });
  });
});
