import { describe, it, expect } from 'vitest';
import { act } from '@testing-library/react';
import { useOverviewTab } from '../../src/tabs/useOverviewTab.js';
import { api } from '../support/api.js';
import { renderTabHook } from '../support/hooks.jsx';

// The state of the Overview tab, as the dashboard shell sees it: the sort order of the
// project breakdown, and what a click on a column header does to it. The shell calls the
// hook with nothing: another tab or another month is just another render.

// What the Overview shows, as the page requests it: at page start, from the shell, since the
// KPI cards, the header, the Markdown report or other tabs read it as well (see
// overview.test.jsx)
const requestsOfTheShell = [
  api.fetchConfig,
  api.fetchSummary,
  api.fetchByService,
  api.fetchByProject,
  api.fetchByResourceType,
  api.fetchGpuSummary,
  api.fetchExpiringServices,
];

describe('useOverviewTab', () => {
  it('requests nothing: what the tab shows loads with the shell', async () => {
    const { queryClient } = await renderTabHook(useOverviewTab);

    for (const request of requestsOfTheShell) expect(request).not.toHaveBeenCalled();
    // No query of its own, under any key
    expect(queryClient.getQueryCache().getAll().map(({ queryKey }) => queryKey)).toEqual([]);
  });

  it('returns the projects sorted by amount, most expensive first', async () => {
    const { result } = await renderTabHook(useOverviewTab);

    // What the shell spreads over the tab, and nothing else: the budget is the shell's
    expect(result.current).toEqual({
      projectSort: { column: 'total', direction: 'desc' },
      handleProjectSort: expect.any(Function),
    });
  });

  it('reverses the order on each click on the column it sorts by', async () => {
    const { result } = await renderTabHook(useOverviewTab);

    act(() => result.current.handleProjectSort('total'));
    expect(result.current.projectSort).toEqual({ column: 'total', direction: 'asc' });

    act(() => result.current.handleProjectSort('total'));
    expect(result.current.projectSort).toEqual({ column: 'total', direction: 'desc' });
  });

  it('sorts on another column from its highest value on a first click', async () => {
    const { result } = await renderTabHook(useOverviewTab);

    // By name, from Z to A
    act(() => result.current.handleProjectSort('name'));
    expect(result.current.projectSort).toEqual({ column: 'name', direction: 'desc' });

    act(() => result.current.handleProjectSort('name'));
    expect(result.current.projectSort).toEqual({ column: 'name', direction: 'asc' });

    // Back to the amount: most expensive first, whatever the order by name was
    act(() => result.current.handleProjectSort('total'));
    expect(result.current.projectSort).toEqual({ column: 'total', direction: 'desc' });
  });

  it('keeps the sort order when another tab opens or the month changes', async () => {
    const { result, rerender } = await renderTabHook(useOverviewTab);
    act(() => result.current.handleProjectSort('name'));
    act(() => result.current.handleProjectSort('name'));

    // The shell renders again, and calls the hook as before
    await rerender();

    expect(result.current.projectSort).toEqual({ column: 'name', direction: 'asc' });
  });
});
