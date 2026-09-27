import { describe, it, expect } from 'vitest';
import { act } from '@testing-library/react';
import { translations } from '../../src/i18n/translations.js';
import { useOverviewTab } from '../../src/tabs/useOverviewTab.js';
import { accountColumnOf, accountsOf } from '../../src/utils/accounts.js';
import { months } from '../fixtures/calendar.js';
import { severalAccounts } from '../fixtures/accounts.js';
import { api } from '../support/api.js';
import { renderTabHook, WAITING } from '../support/hooks.jsx';

// The state of the Overview tab, as the dashboard shell sees it: the sort order of the
// project breakdown, and what a click on a column header does to it; and, when its lists name
// the account of each project, their projects by account (#118). The page tests check that
// the order survives a tab switch (overview.test.jsx).

const [september, august] = months;

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
// What it requests itself, for the lists that name the account of each project
const requestsByAccount = [api.fetchProjectsByAccount, api.fetchGpuProjectsByAccount];

// The hook as the shell calls it: on the month selected, which the months of the account
// shown hold, with lists that name no account, as with a single account, or with the Account
// column of all accounts shown
const withoutAccountColumn = {
  selectedMonth: september, holdsSelectedMonth: true, accountColumn: null,
};
const withAccountColumn = {
  ...withoutAccountColumn,
  accountColumn: accountColumnOf(
    accountsOf(severalAccounts.accounts), null, (key) => translations.fr[key],
  ),
};

describe('useOverviewTab', () => {
  it('requests nothing without the Account column: what the tab shows loads with the shell',
    async () => {
      const { result, keysOf, queryClient } = await renderTabHook(
        useOverviewTab, withoutAccountColumn, severalAccounts,
      );

      for (const request of [...requestsOfTheShell, ...requestsByAccount]) {
        expect(request).not.toHaveBeenCalled();
      }
      expect(result.current.projectsByAccount).toEqual([]);
      expect(result.current.gpuProjectsByAccount).toEqual([]);
      // Its queries wait for the column, rather than fail
      expect(keysOf('projectsByAccount'))
        .toEqual([['projectsByAccount', '2026-09-01', '2026-09-30']]);
      expect(queryClient.getQueryState(['projectsByAccount', '2026-09-01', '2026-09-30']))
        .toMatchObject(WAITING);
    });

  it('requests the projects of the month by account for the Account column', async () => {
    const { result, keysOf } = await renderTabHook(
      useOverviewTab, withAccountColumn, severalAccounts,
    );

    for (const request of requestsByAccount) {
      expect(request).toHaveBeenCalledWith('2026-09-01', '2026-09-30');
    }
    expect(result.current.projectsByAccount)
      .toEqual(severalAccounts.projectsByAccount['2026-09']);
    expect(result.current.gpuProjectsByAccount)
      .toEqual(severalAccounts.gpuProjectsByAccount['2026-09']);
    // For all accounts, which the column shows: their keys name none
    expect(keysOf('projectsByAccount'))
      .toEqual([['projectsByAccount', '2026-09-01', '2026-09-30']]);
    expect(keysOf('gpuProjectsByAccount'))
      .toEqual([['gpuProjectsByAccount', '2026-09-01', '2026-09-30']]);
  });

  // As the shell's queries of the month: while the months of the account shown load, or lack
  // the month selected
  it('requests nothing until the months hold the month selected', async () => {
    const { rerender } = await renderTabHook(
      useOverviewTab, { ...withAccountColumn, holdsSelectedMonth: false }, severalAccounts,
    );

    for (const request of requestsByAccount) expect(request).not.toHaveBeenCalled();

    await rerender({ ...withAccountColumn, selectedMonth: august });

    for (const request of requestsByAccount) {
      expect(request).toHaveBeenCalledWith('2026-08-01', '2026-08-31');
      expect(request).not.toHaveBeenCalledWith('2026-09-01', '2026-09-30');
    }
  });

  it('returns the sort order, by amount descending, its handler, and the projects by account',
    async () => {
      const { result } = await renderTabHook(useOverviewTab, withoutAccountColumn);

      // What the shell spreads over the tab, and nothing else: the budget is the shell's
      expect(result.current).toEqual({
        projectSort: { column: 'total', direction: 'desc' },
        handleProjectSort: expect.any(Function),
        projectsByAccount: [],
        gpuProjectsByAccount: [],
      });
    });

  it('reverses the order on each click on the column it sorts by', async () => {
    const { result } = await renderTabHook(useOverviewTab, withoutAccountColumn);

    act(() => result.current.handleProjectSort('total'));
    expect(result.current.projectSort).toEqual({ column: 'total', direction: 'asc' });

    act(() => result.current.handleProjectSort('total'));
    expect(result.current.projectSort).toEqual({ column: 'total', direction: 'desc' });
  });

  it('sorts on another column from its highest value on a first click', async () => {
    const { result } = await renderTabHook(useOverviewTab, withoutAccountColumn);

    // By name, from Z to A
    act(() => result.current.handleProjectSort('name'));
    expect(result.current.projectSort).toEqual({ column: 'name', direction: 'desc' });

    act(() => result.current.handleProjectSort('name'));
    expect(result.current.projectSort).toEqual({ column: 'name', direction: 'asc' });

    // Back to the amount: most expensive first, whatever the order by name was
    act(() => result.current.handleProjectSort('total'));
    expect(result.current.projectSort).toEqual({ column: 'total', direction: 'desc' });
  });

  it('keeps the sort order across renders', async () => {
    const { result, rerender } = await renderTabHook(useOverviewTab, withoutAccountColumn);
    act(() => result.current.handleProjectSort('name'));
    act(() => result.current.handleProjectSort('name'));

    // The shell renders again, and calls the hook as before
    await rerender(withoutAccountColumn);

    expect(result.current.projectSort).toEqual({ column: 'name', direction: 'asc' });
  });
});
