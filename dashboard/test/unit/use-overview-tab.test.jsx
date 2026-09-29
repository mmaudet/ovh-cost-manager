import { describe, it, expect } from 'vitest';
import { act } from '@testing-library/react';
import { translations } from '../../src/i18n/translations.js';
import { useOverviewTab } from '../../src/tabs/useOverviewTab.js';
import { accountColumnOf, accountsOf } from '../../src/utils/accounts.js';
import { months } from '../fixtures/calendar.js';
import { severalAccounts } from '../fixtures/accounts.js';
import { api } from '../support/api.js';
import { renderTabHook, WAITING } from '../support/hooks.jsx';

// The state of the Overview tab, as the dashboard shell sees it: the sort order of each of its
// tables, which a click on a column header changes (#146); and, when its lists name the account
// of each project, their projects by account (#118). The page tests check what a click does,
// and that the order survives a tab switch (overview.test.jsx).

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

  // Which the Public Cloud tab's list of projects waits for, rather than show that nothing was
  // billed (#180)
  it('tells once the projects by account of the month have loaded', async () => {
    const { result, rerender } = await renderTabHook(
      useOverviewTab, { ...withAccountColumn, holdsSelectedMonth: false }, severalAccounts,
    );

    expect(result.current.projectsByAccountLoaded).toBe(false);

    await rerender(withAccountColumn);

    expect(result.current.projectsByAccountLoaded).toBe(true);

    api.fetchProjectsByAccount.mockRejectedValue(new Error('Request failed with status code 500'));
    await rerender({ ...withAccountColumn, selectedMonth: august });

    // August's could not load
    expect(result.current.projectsByAccount).toEqual([]);
    expect(result.current.projectsByAccountLoaded).toBe(false);
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

  it('returns the sort orders of its tables and the projects by account', async () => {
    const { result } = await renderTabHook(useOverviewTab, withoutAccountColumn);

    // What the shell spreads over the tab, and nothing else: the budget is the shell's. And
    // whether the projects by account have loaded, which the shell reads for the Public Cloud
    // tab (#180)
    expect(result.current).toEqual({
      sortingOf: expect.any(Function),
      projectsByAccount: [],
      projectsByAccountLoaded: false,
      projectsByAccountFailed: false,
      gpuProjectsByAccount: [],
    });
    // The project breakdown by amount, the most expensive first, until the user sorts it; the
    // GPU costs by project in the order of the server
    expect(result.current.sortingOf('projects').sort)
      .toEqual({ column: 'total', kind: 'number', direction: 'desc' });
    expect(result.current.sortingOf('gpuProjects').sort).toBeNull();
  });

  it('keeps the sort order across renders', async () => {
    const { result, rerender } = await renderTabHook(useOverviewTab, withoutAccountColumn);
    // What a second click on the header of the project names gives: from Z to A
    const byNameFromZ = { column: 'name', kind: 'text', direction: 'desc' };
    act(() => result.current.sortingOf('projects').onSort(byNameFromZ));

    // The shell renders again, and calls the hook as before
    await rerender(withoutAccountColumn);

    expect(result.current.sortingOf('projects').sort).toEqual(byNameFromZ);
  });
});
