import { describe, it, expect } from 'vitest';
import { act } from '@testing-library/react';
import { translations } from '../../src/i18n/translations.js';
import { useCompareTab } from '../../src/tabs/useCompareTab.js';
import { accountColumnOf, accountsOf } from '../../src/utils/accounts.js';
import { months } from '../fixtures/calendar.js';
import {
  lyonAccount, removedAccount, severalAccounts, unknownAccount,
} from '../fixtures/accounts.js';
import { api } from '../support/api.js';
import { renderTabHook, TAB_IDS, WAITING } from '../support/hooks.jsx';
import { settle } from '../support/query-client.js';

// The state and data queries of the Compare tab, as the dashboard shell sees them: what the
// hook requests and returns for the months list, the active tab and the account shown. The
// shell holds the account, which the header selects (#115): null for all accounts, undefined
// while the page does not know it yet. The months list is that account's. And the shell
// passes on the Account column of the lists (accountColumnOf()), null when they name no
// account, as with a single account.

const [september, august, july] = months;
// What the shell passes on the render where the months list arrives, all accounts shown: it
// selects its own month in that commit, as months A and B get their defaults
const monthsArrive = { months, selectedAccount: null, accountColumn: null };
const onCompare = { ...monthsArrive, activeTab: 'compare' };

// Months A and B, as [A, B]
const compared = ({ compareMonthA, compareMonthB }) => [compareMonthA.value, compareMonthB.value];
// The service types of a month, as [name, cost]
const services = (byService) => byService.map(({ name, value }) => [name, value]);
// The projects of a month, as [name, cost]
const projects = (byProject) => byProject.map(({ projectName, total }) => [projectName, total]);
// The costs by resource type of a month, as [resource type, cost]
const resourceTypes = (byResourceType) => byResourceType
  .map(({ resource_type, value }) => [resource_type, value]);
// What the hook requests for each of months A and B: the costs by resource type and the
// Veeam backups too, for the infrastructure, backup and Private Cloud comparisons (#32)
const FIGURES = [
  'fetchSummary', 'fetchByService', 'fetchByProject', 'fetchByResourceType', 'fetchBackupStats',
];

describe('useCompareTab', () => {
  describe('months A and B', () => {
    it('are the month before the latest one and the latest one once the list loads',
      async () => {
        const { result, rerender } = await renderTabHook(useCompareTab,
          { ...monthsArrive, months: [], activeTab: 'overview' });
        // No month yet: nothing to compare
        expect(result.current.compareMonthA).toBeNull();
        expect(result.current.compareMonthB).toBeNull();

        await rerender({ ...monthsArrive, activeTab: 'overview' });

        expect(compared(result.current)).toEqual(['2026-08', '2026-09']);
      });

    it('are both the only month when a single month was billed', async () => {
      const { result } = await renderTabHook(useCompareTab,
        { ...monthsArrive, months: [september], activeTab: 'overview' });

      expect(compared(result.current)).toEqual(['2026-09', '2026-09']);
    });

    it('stay as picked when the months list loads again with a month more', async () => {
      // August and September only, then July too, as after a full import
      const { result, rerender, queryClient } = await renderTabHook(useCompareTab,
        { ...onCompare, months: [september, august] });
      act(() => result.current.setCompareMonthA(september));
      act(() => result.current.setCompareMonthB(august));
      await settle(queryClient);

      await rerender(onCompare);

      expect(compared(result.current)).toEqual(['2026-09', '2026-08']);
    });

    // The months list of another account, selected in the header (#119): the months compared
    // are always months of the account shown, which the dropdowns of the tab list
    describe('with the months of another account', () => {
      it('stay as picked while that account was billed in both', async () => {
        const { result, rerender, queryClient } = await renderTabHook(useCompareTab, onCompare);
        act(() => result.current.setCompareMonthA(september));
        act(() => result.current.setCompareMonthB(july));
        await settle(queryClient);

        // An account billed in September and July, not in August
        await rerender({ ...onCompare, months: [september, july] });

        expect(compared(result.current)).toEqual(['2026-09', '2026-07']);
      });

      it('are those the tab opens on for that account when it lacks either', async () => {
        const { result, rerender } = await renderTabHook(useCompareTab, onCompare);

        // Not billed in September, month B: its latest month is August, and July the one
        // before, though August is month A
        await rerender({ ...onCompare, months: [august, july] });

        expect(compared(result.current)).toEqual(['2026-07', '2026-08']);

        // Not billed in July, month A now
        await rerender({ ...onCompare, months: [september, august] });

        expect(compared(result.current)).toEqual(['2026-08', '2026-09']);

        // Billed in July only: that month, compared with itself
        await rerender({ ...onCompare, months: [july] });

        expect(compared(result.current)).toEqual(['2026-07', '2026-07']);
      });

      it('stay while the months of that account load', async () => {
        const { result, rerender } = await renderTabHook(useCompareTab, onCompare);

        await rerender({ ...onCompare, months: [] });

        expect(compared(result.current)).toEqual(['2026-08', '2026-09']);
      });

      // As after the Unknown account, billed in July only, which compares July with itself
      it('are those the tab opens on for that account when they are the same month', async () => {
        const { result, rerender } = await renderTabHook(useCompareTab,
          { ...onCompare, months: [july] });
        expect(compared(result.current)).toEqual(['2026-07', '2026-07']);

        await rerender(onCompare);

        expect(compared(result.current)).toEqual(['2026-08', '2026-09']);
      });
    });

    // The months of another account move them, not the user, who may compare a month with
    // itself, as before several accounts
    it('stay as picked when the user picks the same month for both', async () => {
      const { result, queryClient } = await renderTabHook(useCompareTab, onCompare);

      act(() => result.current.setCompareMonthA(september));
      await settle(queryClient);

      expect(compared(result.current)).toEqual(['2026-09', '2026-09']);
    });
  });

  it.each(TAB_IDS.filter((tab) => tab !== 'compare'))(
    'requests nothing while the %s tab is active',
    async (activeTab) => {
      const { result } = await renderTabHook(useCompareTab, { ...monthsArrive, activeTab });

      // Nor the costs by resource type and the Veeam backups (#32)
      for (const name of FIGURES) {
        expect(api[name], name).not.toHaveBeenCalled();
      }
      // Months A and B are set whatever the tab
      expect(compared(result.current)).toEqual(['2026-08', '2026-09']);
      expect(result.current.compareDataA).toBeUndefined();
      expect(result.current.compareDataB).toBeUndefined();
      expect(result.current.byServiceA).toEqual([]);
      expect(result.current.byServiceB).toEqual([]);
      expect(result.current.byProjectA).toEqual([]);
      expect(result.current.byProjectB).toEqual([]);
      expect(result.current.byResourceTypeA).toEqual([]);
      expect(result.current.byResourceTypeB).toEqual([]);
      expect(result.current.backupStatsA).toBeUndefined();
      expect(result.current.backupStatsB).toBeUndefined();
    },
  );

  it('requests nothing before the months list loads', async () => {
    const { queryClient } = await renderTabHook(useCompareTab,
      { ...onCompare, months: [] });

    // Nor the costs by resource type and the Veeam backups (#32)
    for (const name of FIGURES) {
      expect(api[name], name).not.toHaveBeenCalled();
    }
    // The queries wait for months A and B, rather than failing for the lack of them
    const names = ['summary', 'byService', 'byProject', 'byResourceType', 'backupStats'];
    for (const name of names) {
      expect(queryClient.getQueryState([name, undefined, undefined]), name)
        .toMatchObject(WAITING);
    }
  });

  it('requests months A and B once the tab opens', async () => {
    const { rerender } = await renderTabHook(useCompareTab,
      { ...monthsArrive, activeTab: 'overview' });

    await rerender(onCompare);

    // Their costs by resource type and their Veeam backups too (#32), for all accounts
    for (const name of FIGURES) {
      expect(api[name], name).toHaveBeenCalledWith('2026-08-01', '2026-08-31', null);
      expect(api[name], name).toHaveBeenCalledWith('2026-09-01', '2026-09-30', null);
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
      // For the infrastructure, backup and Private Cloud comparisons (#32)
      byResourceTypeA: expect.any(Array),
      byResourceTypeB: expect.any(Array),
      backupStatsA: expect.any(Object),
      backupStatsB: expect.any(Object),
    });
    expect(compared(result.current)).toEqual(['2026-08', '2026-09']);
    expect(result.current.compareDataA.total).toBe(1042);
    expect(result.current.compareDataB.total).toBe(1250.4);
    expect(services(result.current.byServiceA))
      .toEqual([['Compute', 690], ['Storage', 202], ['Other', 150]]);
    expect(services(result.current.byServiceB))
      .toEqual([['Compute', 800.4], ['Storage', 250], ['Other', 200]]);
    expect(projects(result.current.byProjectA)).toEqual([['Production', 512], ['Staging', 190]]);
    expect(projects(result.current.byProjectB))
      .toEqual([['Production', 610.4], ['Staging', 220]]);
    expect(resourceTypes(result.current.byResourceTypeA)).toEqual([
      ['cloud_project', 702], ['dedicated_server', 270], ['backup', 40], ['domain', 30],
    ]);
    expect(resourceTypes(result.current.byResourceTypeB)).toEqual([
      ['cloud_project', 830.4], ['dedicated_server', 270], ['backup', 90], ['domain', 35],
      ['license', 25],
    ]);
    expect(result.current.backupStatsA)
      .toEqual({ vms: { count: 2, total: 40 }, enterprise: { count: 0, total: 0 } });
    expect(result.current.backupStatsB)
      .toEqual({ vms: { count: 3, total: 90 }, enterprise: { count: 1, total: 25 } });
  });

  it('caches each answer under the name of its query and its month', async () => {
    const { keysOf } = await renderTabHook(useCompareTab, onCompare);

    // The key the queries waited under before months A and B, then those of August and
    // September: the keys of the summary, service types, projects and costs by resource
    // type the page loads for its selected month, and of the Veeam backups the Backup tab
    // loads for it (#32). For all accounts, their keys name none (ADR 0001).
    const names = ['summary', 'byService', 'byProject', 'byResourceType', 'backupStats'];
    for (const name of names) {
      expect(keysOf(name)).toEqual([
        [name, undefined, undefined],
        [name, '2026-08-01', '2026-08-31'],
        [name, '2026-09-01', '2026-09-30'],
      ]);
    }
  });

  it('follows the months A and B the user picks', async () => {
    const { result, queryClient } = await renderTabHook(useCompareTab, onCompare);

    act(() => result.current.setCompareMonthA(july));
    await settle(queryClient);

    // Their costs by resource type and their Veeam backups too (#32)
    for (const name of FIGURES) {
      expect(api[name], name).toHaveBeenCalledWith('2026-07-01', '2026-07-31', null);
    }
    expect(compared(result.current)).toEqual(['2026-07', '2026-09']);
    expect(result.current.compareDataA.total).toBe(980);
    expect(services(result.current.byServiceA))
      .toEqual([['Compute', 650], ['Other', 200], ['Storage', 130]]);
    expect(projects(result.current.byProjectA)).toEqual([['Production', 680]]);
    expect(resourceTypes(result.current.byResourceTypeA))
      .toEqual([['cloud_project', 680], ['dedicated_server', 270], ['domain', 30]]);
    // Nothing backed up in July: what the server answers then
    expect(result.current.backupStatsA)
      .toEqual({ vms: { count: 0, total: 0 }, enterprise: { count: 0, total: 0 } });

    act(() => result.current.setCompareMonthB(august));
    await settle(queryClient);

    expect(compared(result.current)).toEqual(['2026-07', '2026-08']);
    expect(result.current.compareDataB.total).toBe(1042);
    expect(services(result.current.byServiceB))
      .toEqual([['Compute', 690], ['Storage', 202], ['Other', 150]]);
    expect(projects(result.current.byProjectB)).toEqual([['Production', 512], ['Staging', 190]]);
    expect(resourceTypes(result.current.byResourceTypeB)).toEqual([
      ['cloud_project', 702], ['dedicated_server', 270], ['backup', 40], ['domain', 30],
    ]);
    expect(result.current.backupStatsB)
      .toEqual({ vms: { count: 2, total: 40 }, enterprise: { count: 0, total: 0 } });
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

    await rerender({ ...monthsArrive, activeTab: 'overview' });

    expect(compared(result.current)).toEqual(['2026-07', '2026-08']);
    expect(result.current.compareSort).toEqual({ column: 'diff', direction: 'desc' });
    // The answers stay
    expect(result.current.compareDataA.total).toBe(980);
    expect(result.current.compareDataB.total).toBe(1042);
  });

  // Several accounts in the instance (#119), all of them shown, where the comparison by
  // project names the account of each project: see fixtures/accounts.js
  describe('projects of the Account column', () => {
    const withAccountColumn = {
      ...onCompare,
      accountColumn: accountColumnOf(
        accountsOf(severalAccounts.accounts), null, (key) => translations.fr[key],
      ),
    };

    it('are requested for months A and B by account, under the keys of the Overview\'s',
      async () => {
        const { result, keysOf } = await renderTabHook(useCompareTab, withAccountColumn,
          severalAccounts);

        for (const { from, to } of [august, september]) {
          expect(api.fetchProjectsByAccount).toHaveBeenCalledWith(from, to);
        }
        expect(api.fetchByProject).not.toHaveBeenCalled();
        // Each project once for each account that billed it, with that account
        expect(result.current.byProjectA).toEqual(severalAccounts.projectsByAccount['2026-08']);
        expect(result.current.byProjectB).toEqual(severalAccounts.projectsByAccount['2026-09']);
        // For all accounts, which the column shows: their keys name none
        expect(keysOf('projectsByAccount')).toEqual([
          ['projectsByAccount', undefined, undefined],
          ['projectsByAccount', '2026-08-01', '2026-08-31'],
          ['projectsByAccount', '2026-09-01', '2026-09-30'],
        ]);
        expect(keysOf('byProject')).toEqual([]);
      });

    it('are the projects once each without the column', async () => {
      const { result, rerender } = await renderTabHook(useCompareTab, withAccountColumn,
        severalAccounts);

      await rerender({ ...onCompare, selectedAccount: lyonAccount.id });

      expect(api.fetchByProject).toHaveBeenCalledWith('2026-08-01', '2026-08-31', lyonAccount.id);
      expect(projects(result.current.byProjectA)).toEqual([['Production', 512]]);
      expect(result.current.byProjectA[0]).not.toHaveProperty('account');
    });

    // As the other figures of the tab: on the tab only, and for a month of the months list
    it('wait for the tab, and for months A and B', async () => {
      const { queryClient } = await renderTabHook(useCompareTab,
        { ...withAccountColumn, months: [], activeTab: 'overview' }, severalAccounts);

      expect(api.fetchProjectsByAccount).not.toHaveBeenCalled();
      expect(queryClient.getQueryState(['projectsByAccount', undefined, undefined]))
        .toMatchObject(WAITING);
    });
  });

  // Several accounts in the instance (#119): see fixtures/accounts.js
  describe('figures of the account shown', () => {
    const lyon = lyonAccount.id;
    const NAMES = ['summary', 'byService', 'byProject', 'byResourceType', 'backupStats'];

    it('are requested for months A and B of that account, cached under keys that name it',
      async () => {
        const { result, keysOf } = await renderTabHook(useCompareTab,
          { ...onCompare, selectedAccount: lyon }, severalAccounts);

        for (const name of FIGURES) {
          expect(api[name], name).toHaveBeenCalledWith('2026-08-01', '2026-08-31', lyon);
          expect(api[name], name).toHaveBeenCalledWith('2026-09-01', '2026-09-30', lyon);
        }
        expect(result.current.compareDataA.total).toBe(612);
        expect(result.current.compareDataB.total).toBe(890.4);
        expect(services(result.current.byServiceA))
          .toEqual([['Compute', 450], ['Storage', 102], ['Other', 60]]);
        expect(projects(result.current.byProjectA)).toEqual([['Production', 512]]);
        expect(resourceTypes(result.current.byResourceTypeB)).toEqual([
          ['cloud_project', 610.4], ['dedicated_server', 270], ['domain', 10],
        ]);
        // No Veeam backup: what the server answers then
        expect(result.current.backupStatsB)
          .toEqual({ vms: { count: 0, total: 0 }, enterprise: { count: 0, total: 0 } });
        // The account after the other parts of the keys, which stay those of all accounts, so
        // that months A and B share the keys of the shell and the Backup tab (ADR 0001)
        for (const name of NAMES) {
          expect(keysOf(name)).toEqual([
            [name, undefined, undefined, lyon],
            [name, '2026-08-01', '2026-08-31', lyon],
            [name, '2026-09-01', '2026-09-30', lyon],
          ]);
        }
      });

    it('follow the account shown, the Unknown account too, and all accounts again', async () => {
      const { result, rerender } = await renderTabHook(useCompareTab, onCompare, severalAccounts);

      await rerender({ ...onCompare, selectedAccount: lyon });

      expect(result.current.compareDataA.total).toBe(612);

      // Billed in July only: that month, compared with itself
      await rerender({ ...onCompare, months: [july], selectedAccount: unknownAccount.id });

      expect(api.fetchSummary).toHaveBeenCalledWith('2026-07-01', '2026-07-31', 'unknown');
      expect(result.current.compareDataA.total).toBe(120);
      expect(resourceTypes(result.current.byResourceTypeB))
        .toEqual([['dedicated_server', 90], ['domain', 30]]);

      // Back to the months the tab opens on, rather than July twice
      await rerender(onCompare);

      expect(compared(result.current)).toEqual(['2026-08', '2026-09']);
      expect(result.current.compareDataA.total).toBe(1042);
      expect(result.current.compareDataB.total).toBe(1250.4);
    });

    // An account selected on an earlier visit, until the accounts list tells whether the page
    // still offers it (useSelectedAccount())
    it('wait while the page does not know the account shown', async () => {
      const { queryClient } = await renderTabHook(useCompareTab,
        { ...onCompare, selectedAccount: undefined }, severalAccounts);

      for (const name of FIGURES) {
        expect(api[name], name).not.toHaveBeenCalled();
      }
      for (const name of NAMES) {
        expect(queryClient.getQueryState([name, '2026-08-01', '2026-08-31', undefined]), name)
          .toMatchObject(WAITING);
      }
    });

    // The months list of an account just selected, which lacks September, month B: the shell
    // passes it on once it has loaded, as the tab moves to the months it opens on for that
    // account (see above)
    it('are never requested for a month that the account shown lacks', async () => {
      const { result, rerender } = await renderTabHook(useCompareTab, onCompare, severalAccounts);
      const removed = removedAccount.id;

      // While its months load
      await rerender({ ...onCompare, months: [], selectedAccount: removed });

      for (const name of FIGURES) {
        expect(api[name], name).not.toHaveBeenCalledWith(expect.anything(), expect.anything(),
          removed);
      }

      await rerender({ ...onCompare, months: [august, july], selectedAccount: removed });

      for (const name of FIGURES) {
        expect(api[name], name).not.toHaveBeenCalledWith('2026-09-01', '2026-09-30', removed);
        expect(api[name], name).toHaveBeenCalledWith('2026-07-01', '2026-07-31', removed);
        expect(api[name], name).toHaveBeenCalledWith('2026-08-01', '2026-08-31', removed);
      }
      expect(compared(result.current)).toEqual(['2026-07', '2026-08']);
      expect(result.current.compareDataA.total).toBe(180);
      expect(result.current.compareDataB.total).toBe(200);
    });
  });
});
