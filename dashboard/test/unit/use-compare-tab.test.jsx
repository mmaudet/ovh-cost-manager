import { describe, it, expect } from 'vitest';
import { act } from '@testing-library/react';
import { useQuery } from '@tanstack/react-query';
import { fetchSummary } from '../../src/services/api.js';
import { useCompareTab } from '../../src/tabs/useCompareTab.js';
import { months } from '../fixtures/calendar.js';
import { api } from '../support/api.js';
import { renderTabHook, TAB_IDS, WAITING } from '../support/hooks.jsx';
import { settle } from '../support/query-client.js';

// The state and data queries of the Compare tab, as the dashboard shell sees them: what the
// hook requests and returns for the months list, the selected month and the active tab.

const [september, august, july] = months;
// What the shell passes on the render where the months list arrives: it selects its own
// month in that commit, on the same condition as the defaults of months A and B
const monthsArrive = { months, selectedMonth: null };
const onCompare = { ...monthsArrive, activeTab: 'compare' };

// Months A and B, as [A, B]
const compared = ({ compareMonthA, compareMonthB }) => [compareMonthA.value, compareMonthB.value];
// The service types of a month, as [name, cost]
const services = (byService) => byService.map(({ name, value }) => [name, value]);
// The projects of a month, as [name, cost]
const projects = (byProject) => byProject.map(({ projectName, total }) => [projectName, total]);

// The hook next to the summary query the shell runs for its selected month, with the same
// key and API function: both share the query cache, as they do in the page. The API
// stand-in answers them (setup.js).
const useSummaryAndCompareTab = (props) => {
  const { selectedMonth } = props;
  const { data: summary } = useQuery({
    queryKey: ['summary', selectedMonth?.from, selectedMonth?.to],
    queryFn: () => fetchSummary(selectedMonth.from, selectedMonth.to),
    enabled: !!selectedMonth,
  });
  return { summary, compareTab: useCompareTab(props) };
};

describe('useCompareTab', () => {
  describe('months A and B', () => {
    it('are the month before the latest one and the latest one once the list loads',
      async () => {
        const { result, rerender } = await renderTabHook(useCompareTab,
          { months: [], selectedMonth: null, activeTab: 'overview' });
        // No month yet: nothing to compare
        expect(result.current.compareMonthA).toBeNull();
        expect(result.current.compareMonthB).toBeNull();

        await rerender({ ...monthsArrive, activeTab: 'overview' });

        expect(compared(result.current)).toEqual(['2026-08', '2026-09']);
      });

    it('are both the only month when a single month was billed', async () => {
      const { result } = await renderTabHook(useCompareTab,
        { months: [september], selectedMonth: null, activeTab: 'overview' });

      expect(compared(result.current)).toEqual(['2026-09', '2026-09']);
    });

    it('get no default once the shell has selected its month', async () => {
      const { result } = await renderTabHook(useCompareTab,
        { months, selectedMonth: september, activeTab: 'compare' });

      expect(result.current.compareMonthA).toBeNull();
      expect(result.current.compareMonthB).toBeNull();
    });

    it('stay as picked when the months list loads again with a month more', async () => {
      // August and September only, then July too, as after a full import
      const { result, rerender, queryClient } = await renderTabHook(useCompareTab,
        { ...onCompare, months: [september, august] });
      await rerender({ ...onCompare, months: [september, august], selectedMonth: september });
      act(() => result.current.setCompareMonthA(september));
      act(() => result.current.setCompareMonthB(august));
      await settle(queryClient);

      await rerender({ ...onCompare, selectedMonth: september });

      expect(compared(result.current)).toEqual(['2026-09', '2026-08']);
    });
  });

  it.each(TAB_IDS.filter((tab) => tab !== 'compare'))(
    'requests nothing while the %s tab is active',
    async (activeTab) => {
      const { result } = await renderTabHook(useCompareTab, { ...monthsArrive, activeTab });

      expect(api.fetchSummary).not.toHaveBeenCalled();
      expect(api.fetchByService).not.toHaveBeenCalled();
      expect(api.fetchByProject).not.toHaveBeenCalled();
      // Months A and B are set whatever the tab
      expect(compared(result.current)).toEqual(['2026-08', '2026-09']);
      expect(result.current.compareDataA).toBeUndefined();
      expect(result.current.compareDataB).toBeUndefined();
      expect(result.current.byServiceA).toEqual([]);
      expect(result.current.byServiceB).toEqual([]);
      expect(result.current.byProjectA).toEqual([]);
      expect(result.current.byProjectB).toEqual([]);
    },
  );

  it('requests nothing before the months list loads', async () => {
    const { queryClient } = await renderTabHook(useCompareTab,
      { months: [], selectedMonth: null, activeTab: 'compare' });

    expect(api.fetchSummary).not.toHaveBeenCalled();
    expect(api.fetchByService).not.toHaveBeenCalled();
    expect(api.fetchByProject).not.toHaveBeenCalled();
    // The queries wait for months A and B, rather than failing for the lack of them
    for (const name of ['summary', 'byService', 'byProject']) {
      expect(queryClient.getQueryState([name, undefined, undefined]), name)
        .toMatchObject(WAITING);
    }
  });

  it('requests months A and B once the tab opens', async () => {
    const { rerender } = await renderTabHook(useCompareTab,
      { ...monthsArrive, activeTab: 'overview' });

    await rerender({ months, selectedMonth: september, activeTab: 'compare' });

    for (const fetchFigures of [api.fetchSummary, api.fetchByService, api.fetchByProject]) {
      expect(fetchFigures).toHaveBeenCalledWith('2026-08-01', '2026-08-31');
      expect(fetchFigures).toHaveBeenCalledWith('2026-09-01', '2026-09-30');
    }
  });

  it('returns months A and B, their figures and the sort order', async () => {
    const { result } = await renderTabHook(useCompareTab, onCompare);

    // What the shell spreads over the tab, and nothing else
    expect(result.current).toEqual({
      compareMonthA: expect.any(Object),
      setCompareMonthA: expect.any(Function),
      compareMonthB: expect.any(Object),
      setCompareMonthB: expect.any(Function),
      compareSort: { column: 'totalA', direction: 'desc' },
      handleCompareSort: expect.any(Function),
      compareDataA: expect.any(Object),
      compareDataB: expect.any(Object),
      byServiceA: expect.any(Array),
      byServiceB: expect.any(Array),
      byProjectA: expect.any(Array),
      byProjectB: expect.any(Array),
    });
    expect(compared(result.current)).toEqual(['2026-08', '2026-09']);
    expect(result.current.compareDataA.total).toBe(1042);
    // Also what the "vs previous month" KPI of the shell reads (#50)
    expect(result.current.compareDataB.total).toBe(1250.4);
    expect(services(result.current.byServiceA))
      .toEqual([['Compute', 690], ['Storage', 202], ['Other', 150]]);
    expect(services(result.current.byServiceB))
      .toEqual([['Compute', 800.4], ['Storage', 250], ['Other', 200]]);
    expect(projects(result.current.byProjectA)).toEqual([['Production', 512], ['Staging', 190]]);
    expect(projects(result.current.byProjectB))
      .toEqual([['Production', 610.4], ['Staging', 220]]);
  });

  it('caches each answer under the name of its query and its month', async () => {
    const { keysOf } = await renderTabHook(useCompareTab, onCompare);

    // The key the queries waited under before months A and B, then those of August and
    // September: the keys of the summary, service types and projects the page loads for
    // its selected month
    for (const name of ['summary', 'byService', 'byProject']) {
      expect(keysOf(name)).toEqual([
        [name, undefined, undefined],
        [name, '2026-08-01', '2026-08-31'],
        [name, '2026-09-01', '2026-09-30'],
      ]);
    }
  });

  // The page loads the summary of its selected month at start, under the key of month B's:
  // the KPI compares the latest month with itself before the Compare tab opens (#50)
  it('returns the summary of month B the page loads, whatever the tab', async () => {
    const { result, rerender } = await renderTabHook(useSummaryAndCompareTab,
      { ...monthsArrive, activeTab: 'overview' });
    // The shell selects the latest month in the commit where months A and B get theirs
    await rerender({ months, selectedMonth: september, activeTab: 'overview' });

    // The page asked for September, the Compare tab would have asked for August too
    expect(api.fetchSummary).toHaveBeenCalledWith('2026-09-01', '2026-09-30');
    expect(api.fetchSummary).not.toHaveBeenCalledWith('2026-08-01', '2026-08-31');
    expect(result.current.summary.total).toBe(1250.4);
    expect(result.current.compareTab.compareDataB.total).toBe(1250.4);
    expect(result.current.compareTab.compareDataA).toBeUndefined();
  });

  it('follows the months A and B the user picks', async () => {
    const { result, queryClient } = await renderTabHook(useCompareTab, onCompare);

    act(() => result.current.setCompareMonthA(july));
    await settle(queryClient);

    for (const fetchFigures of [api.fetchSummary, api.fetchByService, api.fetchByProject]) {
      expect(fetchFigures).toHaveBeenCalledWith('2026-07-01', '2026-07-31');
    }
    expect(compared(result.current)).toEqual(['2026-07', '2026-09']);
    expect(result.current.compareDataA.total).toBe(980);
    expect(services(result.current.byServiceA))
      .toEqual([['Compute', 650], ['Other', 200], ['Storage', 130]]);
    expect(projects(result.current.byProjectA)).toEqual([['Production', 680]]);

    act(() => result.current.setCompareMonthB(august));
    await settle(queryClient);

    expect(compared(result.current)).toEqual(['2026-07', '2026-08']);
    // The "vs previous month" KPI of the shell follows month B (#50)
    expect(result.current.compareDataB.total).toBe(1042);
    expect(services(result.current.byServiceB))
      .toEqual([['Compute', 690], ['Storage', 202], ['Other', 150]]);
    expect(projects(result.current.byProjectB)).toEqual([['Production', 512], ['Staging', 190]]);
  });

  it('sorts on a new column most expensive first, then each way in turn', async () => {
    const { result } = await renderTabHook(useCompareTab, onCompare);

    act(() => result.current.handleCompareSort('totalA'));
    expect(result.current.compareSort).toEqual({ column: 'totalA', direction: 'asc' });

    act(() => result.current.handleCompareSort('name'));
    expect(result.current.compareSort).toEqual({ column: 'name', direction: 'desc' });

    act(() => result.current.handleCompareSort('name'));
    expect(result.current.compareSort).toEqual({ column: 'name', direction: 'asc' });

    act(() => result.current.handleCompareSort('name'));
    expect(result.current.compareSort).toEqual({ column: 'name', direction: 'desc' });

    act(() => result.current.handleCompareSort('diff'));
    expect(result.current.compareSort).toEqual({ column: 'diff', direction: 'desc' });
  });

  it('keeps months A and B and the sort order when another tab opens', async () => {
    const { result, rerender, queryClient } = await renderTabHook(useCompareTab, onCompare);
    act(() => result.current.setCompareMonthA(july));
    act(() => result.current.setCompareMonthB(august));
    act(() => result.current.handleCompareSort('diff'));
    await settle(queryClient);

    await rerender({ months, selectedMonth: september, activeTab: 'overview' });

    expect(compared(result.current)).toEqual(['2026-07', '2026-08']);
    expect(result.current.compareSort).toEqual({ column: 'diff', direction: 'desc' });
    // The answers stay, and the KPI of the shell keeps reading month B (#50)
    expect(result.current.compareDataA.total).toBe(980);
    expect(result.current.compareDataB.total).toBe(1042);
  });
});
