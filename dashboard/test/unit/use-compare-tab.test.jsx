import { describe, it, expect } from 'vitest';
import { act } from '@testing-library/react';
import { translations } from '../../src/i18n/translations.js';
import { useCompareTab } from '../../src/tabs/useCompareTab.js';
import { accountColumnOf, accountsOf } from '../../src/utils/accounts.js';
import { account } from '../fixtures/account.js';
import { months } from '../fixtures/calendar.js';
import {
  lyonAccount, lyonBilledLate, removedAccount, severalAccounts, unknownAccount, unnamedAccount,
} from '../fixtures/accounts.js';
import { enterpriseLicence } from '../fixtures/backup.js';
import { serverAndBackupsBilledLate } from '../fixtures/compare.js';
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

  it('returns months A and B, their figures and the sort orders of its tables', async () => {
    const { result } = await renderTabHook(useCompareTab, onCompare);

    // What the shell spreads over the tab, and nothing else
    expect(result.current).toEqual({
      compareMonthA: expect.any(Object),
      setCompareMonthA: expect.any(Function),
      compareMonthB: expect.any(Object),
      setCompareMonthB: expect.any(Function),
      // What the comparison knows of them, which decides its variations (#216, #218): two
      // complete months here
      comparedMonths: { includesMonthInProgress: false, projected: false },
      billedMonths: { includesMonthInProgress: false, projected: false },
      sortingOf: expect.any(Function),
      // The rows unfolded into their services, by comparison (#192)
      unfoldingOf: expect.any(Function),
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
      // The query of a project's products in a month, which the comparison of the project's
      // products runs once opened (#181)
      projectProductsQuery: expect.any(Function),
      // The query of a resource type's services in a month, which its row runs once unfolded
      // (#192)
      resourceTypeServicesQuery: expect.any(Function),
      // And that of a backup row's services (#197)
      backupServicesQuery: expect.any(Function),
    });
    // The comparison by project by month A, the most expensive first, until the user sorts it
    expect(result.current.sortingOf('projects').sort)
      .toEqual({ column: 'totalA', kind: 'number', direction: 'desc' });
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

  it('keeps months A and B and the sort order when another tab opens', async () => {
    const { result, rerender, queryClient } = await renderTabHook(useCompareTab, onCompare);
    act(() => result.current.setCompareMonthA(july));
    act(() => result.current.setCompareMonthB(august));
    // What a click on the header of the variation gives: the largest first
    const byVariation = { column: 'variation', kind: 'number', direction: 'desc' };
    act(() => result.current.sortingOf('projects').onSort(byVariation));
    await settle(queryClient);

    await rerender({ ...monthsArrive, activeTab: 'overview' });

    expect(compared(result.current)).toEqual(['2026-07', '2026-08']);
    expect(result.current.sortingOf('projects').sort).toEqual(byVariation);
    // The answers stay
    expect(result.current.compareDataA.total).toBe(980);
    expect(result.current.compareDataB.total).toBe(1042);
  });

  // What the bills of month A or B charged a project, product by product (#181): the query that
  // the comparison of the project's products runs once opened, which the hook defines
  describe("query of a project's products", () => {
    const PRODUCTION = 'project-production';

    it('asks for the products of a project in a month, under a key of its own', async () => {
      const { result } = await renderTabHook(useCompareTab, onCompare);

      const query = result.current.projectProductsQuery(PRODUCTION, august);

      // For all accounts, its key names none, as its request does not (ADR 0001)
      expect(query.queryKey).toEqual(['projectProducts', PRODUCTION, '2026-08-01', '2026-08-31']);
      expect(query.enabled).toBe(true);
      await expect(query.queryFn()).resolves.toMatchObject({ total: 512, credits: 0 });
      expect(api.fetchProjectProducts)
        .toHaveBeenCalledWith(PRODUCTION, '2026-08-01', '2026-08-31', null);
    });

    // As the comparison by project, whose cost of the project they break down (#119)
    it('asks for those of the bills of the account shown, under a key that names it',
      async () => {
        const { result } = await renderTabHook(useCompareTab,
          { ...onCompare, selectedAccount: lyonAccount.id }, severalAccounts);

        const query = result.current.projectProductsQuery(PRODUCTION, september);

        expect(query.queryKey)
          .toEqual(['projectProducts', PRODUCTION, '2026-09-01', '2026-09-30', lyonAccount.id]);
        await expect(query.queryFn()).resolves.toMatchObject({ total: 610.4 });
        expect(api.fetchProjectProducts)
          .toHaveBeenCalledWith(PRODUCTION, '2026-09-01', '2026-09-30', lyonAccount.id);
      });

    // As the other figures of the tab: on the tab only, for a month of the months list, once
    // the page knows the account shown
    it('waits for the tab, for a month of the account shown, and for that account', async () => {
      const { result, rerender } = await renderTabHook(useCompareTab,
        { ...monthsArrive, activeTab: 'overview' });

      expect(result.current.projectProductsQuery(PRODUCTION, august).enabled).toBe(false);

      // An account not billed in July
      await rerender({ ...onCompare, months: [september, august] });

      expect(result.current.projectProductsQuery(PRODUCTION, july).enabled).toBe(false);
      expect(result.current.projectProductsQuery(PRODUCTION, august).enabled).toBe(true);

      await rerender({ ...onCompare, selectedAccount: undefined });

      expect(result.current.projectProductsQuery(PRODUCTION, august).enabled).toBe(false);
    });
  });

  // The services of a resource type in month A or B (#192): the query that its row runs once
  // unfolded, which the hook defines, under the key of the bill lines that the Infrastructure
  // tab lists for the same resource type, month and account (ADR 0001)
  describe("query of a resource type's services", () => {
    const DEDICATED_SERVERS = 'dedicated_server';
    // The services of an answer, as [identifier, cost]
    const servicesIn = (answer) => answer.map(({ domain, total }) => [domain, total]);

    it('asks for the services of a resource type in a month, and runs none itself', async () => {
      const { result, keysOf } = await renderTabHook(useCompareTab, onCompare);
      // Nothing is asked for before a row unfolds
      expect(api.fetchResourceTypeDetails).not.toHaveBeenCalled();
      expect(keysOf('resourceTypeDetails')).toEqual([]);

      const query = result.current.resourceTypeServicesQuery(DEDICATED_SERVERS, august);

      // For all accounts, its key names none, as its request does not
      expect(query.queryKey)
        .toEqual(['resourceTypeDetails', DEDICATED_SERVERS, '2026-08-01', '2026-08-31']);
      expect(query.enabled).toBe(true);
      expect(servicesIn(await query.queryFn())).toEqual([['ns3000001.ip-203-0-113.eu', 270]]);
      expect(api.fetchResourceTypeDetails)
        .toHaveBeenCalledWith(DEDICATED_SERVERS, '2026-08-01', '2026-08-31', null);
    });

    it('asks for those of the account shown, under a key that names it last', async () => {
      const { result } = await renderTabHook(useCompareTab,
        { ...onCompare, selectedAccount: lyonAccount.id }, severalAccounts);

      const query = result.current.resourceTypeServicesQuery(DEDICATED_SERVERS, august);

      expect(query.queryKey).toEqual([
        'resourceTypeDetails', DEDICATED_SERVERS, '2026-08-01', '2026-08-31', lyonAccount.id,
      ]);
      // Lyon's server, rented from the end of August
      expect(servicesIn(await query.queryFn())).toEqual([['ns3000001.ip-203-0-113.eu', 70]]);
      expect(api.fetchResourceTypeDetails)
        .toHaveBeenCalledWith(DEDICATED_SERVERS, '2026-08-01', '2026-08-31', lyonAccount.id);
    });

    // As the other figures of the tab: on the tab only, for a month of the months list, once
    // the page knows the account shown
    it('waits for the tab, for a month of the account shown, and for that account', async () => {
      const { result, rerender } = await renderTabHook(useCompareTab,
        { ...monthsArrive, activeTab: 'overview' });

      expect(result.current.resourceTypeServicesQuery(DEDICATED_SERVERS, august).enabled)
        .toBe(false);

      // An account not billed in July
      await rerender({ ...onCompare, months: [september, august] });

      expect(result.current.resourceTypeServicesQuery(DEDICATED_SERVERS, july).enabled)
        .toBe(false);
      expect(result.current.resourceTypeServicesQuery(DEDICATED_SERVERS, august).enabled)
        .toBe(true);

      await rerender({ ...onCompare, selectedAccount: undefined });

      expect(result.current.resourceTypeServicesQuery(DEDICATED_SERVERS, august).enabled)
        .toBe(false);
    });

    // With several accounts, all of them shown, while the lists name the account of each
    // service (#194): see fixtures/accounts.js
    describe('by account', () => {
      const withAccountColumn = {
        ...onCompare,
        accountColumn: accountColumnOf(
          accountsOf(severalAccounts.accounts), null, (key) => translations.fr[key],
        ),
      };
      // The services of an answer by account, as [identifier, account, cost]
      const servicesByAccountIn = (answer) => answer
        .map(({ domain, account, total }) => [domain, account, total]);

      it("asks for every account's by account, under the Infrastructure tab's key", async () => {
        const { result } = await renderTabHook(useCompareTab, withAccountColumn,
          severalAccounts);

        const query = result.current.resourceTypeServicesQuery(DEDICATED_SERVERS, august);

        // For all accounts, which the column shows: its key names none
        expect(query.queryKey).toEqual([
          'resourceTypeDetailsByAccount', DEDICATED_SERVERS, '2026-08-01', '2026-08-31',
        ]);
        expect(query.enabled).toBe(true);
        // The server of the account no longer configured, and Lyon's
        expect(servicesByAccountIn(await query.queryFn())).toEqual([
          ['ns3000003.ip-203-0-113.eu', 'zz3333-ovh', 200],
          ['ns3000001.ip-203-0-113.eu', 'xx1111-ovh', 70],
        ]);
        expect(api.fetchResourceTypeDetailsByAccount)
          .toHaveBeenCalledWith(DEDICATED_SERVERS, '2026-08-01', '2026-08-31');
        expect(api.fetchResourceTypeDetails).not.toHaveBeenCalled();
      });

      // As the other figures of the tab
      it('waits for the tab, and for a month of the months list', async () => {
        const { result, rerender } = await renderTabHook(useCompareTab,
          { ...withAccountColumn, activeTab: 'overview' }, severalAccounts);

        expect(result.current.resourceTypeServicesQuery(DEDICATED_SERVERS, august).enabled)
          .toBe(false);

        await rerender({ ...withAccountColumn, months: [september, august] });

        expect(result.current.resourceTypeServicesQuery(DEDICATED_SERVERS, july).enabled)
          .toBe(false);
        expect(result.current.resourceTypeServicesQuery(DEDICATED_SERVERS, august).enabled)
          .toBe(true);
      });
    });
  });

  // The services of the Veeam backups in month A or B (#197): the query that a backup row runs
  // once unfolded, which the hook defines, one answer a month for both rows
  describe("query of a backup row's services", () => {
    // The services of a row, as [identifier, cost], and its account when it names one
    const servicesIn = (services) => services.map(({ domain, total, account }) => (
      account === undefined ? [domain, total] : [domain, total, account]
    ));

    it("asks for the backups' services of a month once for both rows, each taking its own",
      async () => {
        const { result, keysOf } = await renderTabHook(useCompareTab, onCompare);
        // Nothing is asked for before a row unfolds
        expect(api.fetchBackupServices).not.toHaveBeenCalled();
        expect(keysOf('backupServices')).toEqual([]);

        const vms = result.current.backupServicesQuery('vms', september);
        const licences = result.current.backupServicesQuery('enterprise', september);

        // One key for both rows, which names no account for all accounts
        expect(vms.queryKey).toEqual(['backupServices', '2026-09-01', '2026-09-30']);
        expect(licences.queryKey).toEqual(vms.queryKey);
        expect(vms.enabled).toBe(true);
        const answer = await vms.queryFn();
        expect(api.fetchBackupServices).toHaveBeenCalledWith('2026-09-01', '2026-09-30', null);
        expect(servicesIn(vms.select(answer))).toEqual([
          ['vm-app-1.example.com', 40], ['vm-db-1.example.com', 30],
          ['vm-files-1.example.com', 20],
        ]);
        expect(servicesIn(licences.select(answer))).toEqual([[enterpriseLicence.domain, 25]]);
      });

    it('asks for those of the account shown, under a key that names it last', async () => {
      const { result } = await renderTabHook(useCompareTab,
        { ...onCompare, selectedAccount: unnamedAccount.id }, severalAccounts);

      const query = result.current.backupServicesQuery('vms', august);

      expect(query.queryKey)
        .toEqual(['backupServices', '2026-08-01', '2026-08-31', unnamedAccount.id]);
      expect(servicesIn(query.select(await query.queryFn())))
        .toEqual([['vm-app-1.example.com', 25], ['vm-db-1.example.com', 15]]);
      expect(api.fetchBackupServices)
        .toHaveBeenCalledWith('2026-08-01', '2026-08-31', unnamedAccount.id);
    });

    // With several accounts, all of them shown, while the lists name the account of each
    // service: see fixtures/accounts.js
    it("asks for every account's by account while the lists name the account of each",
      async () => {
        const { result } = await renderTabHook(useCompareTab, {
          ...onCompare,
          accountColumn: accountColumnOf(
            accountsOf(severalAccounts.accounts), null, (key) => translations.fr[key],
          ),
        }, severalAccounts);

        const query = result.current.backupServicesQuery('vms', august);

        // For all accounts, which the column shows: its key names none
        expect(query.queryKey).toEqual(['backupServicesByAccount', '2026-08-01', '2026-08-31']);
        expect(servicesIn(query.select(await query.queryFn()))).toEqual([
          ['vm-app-1.example.com', 25, unnamedAccount.nic],
          ['vm-db-1.example.com', 15, unnamedAccount.nic],
        ]);
        expect(api.fetchBackupServicesByAccount).toHaveBeenCalledWith('2026-08-01', '2026-08-31');
        expect(api.fetchBackupServices).not.toHaveBeenCalled();
      });

    // As the other figures of the tab: on the tab only, for a month of the months list, once
    // the page knows the account shown
    it('waits for the tab, for a month of the account shown, and for that account', async () => {
      const { result, rerender } = await renderTabHook(useCompareTab,
        { ...monthsArrive, activeTab: 'overview' });

      expect(result.current.backupServicesQuery('vms', august).enabled).toBe(false);

      // An account not billed in July
      await rerender({ ...onCompare, months: [september, august] });

      expect(result.current.backupServicesQuery('vms', july).enabled).toBe(false);
      expect(result.current.backupServicesQuery('vms', august).enabled).toBe(true);

      await rerender({ ...onCompare, selectedAccount: undefined });

      expect(result.current.backupServicesQuery('vms', august).enabled).toBe(false);
    });
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

  // The month in progress (#216), as the months list marks it, at its projected cost while the
  // page projects it (#218): see fixtures/compare.js, where September has not billed its
  // dedicated server and the backups of two VMs yet
  describe('month in progress', () => {
    const inProgress = [{ ...september, inProgress: true }, august, july];
    const billedLate = { ...account, ...serverAndBackupsBilledLate };
    // What the shell passes while the page projects the month in progress
    const projecting = { ...onCompare, months: inProgress, projectsMonthInProgress: true };
    const SEPTEMBER = ['2026-09-01', '2026-09-30'];
    const AUGUST = ['2026-08-01', '2026-08-31'];
    const PROJECTED = { projected: true };
    // The figures that the hook asks for projected: all but the projects', until #219
    const PROJECTED_FIGURES = FIGURES.filter((name) => name !== 'fetchByProject');
    const NAMES = ['summary', 'byService', 'byResourceType', 'backupStats'];

    it('asks for its figures projected while the page projects it, under keys of their own',
      async () => {
        const { result, keysOf } = await renderTabHook(useCompareTab, projecting, billedLate);

        for (const name of PROJECTED_FIGURES) {
          expect(api[name], name).toHaveBeenCalledWith(...SEPTEMBER, null, PROJECTED);
          // Month A, August, complete, as before
          expect(api[name], name).toHaveBeenCalledWith(...AUGUST, null);
          expect(api[name], name).not.toHaveBeenCalledWith(...AUGUST, null, PROJECTED);
        }
        expect(api.fetchByProject).not.toHaveBeenCalledWith(...SEPTEMBER, null, PROJECTED);
        // September at its projected cost, and what projected lines make of it
        expect(result.current.compareDataB).toMatchObject({ total: 1220.4, projected: 310 });
        // Which the variations compare, but the projects', at what September billed (#219)
        expect(result.current.comparedMonths)
          .toEqual({ includesMonthInProgress: true, projected: true });
        expect(result.current.billedMonths)
          .toEqual({ includesMonthInProgress: true, projected: false });
        expect(resourceTypes(result.current.byResourceTypeB)).toEqual([
          ['cloud_project', 830.4], ['dedicated_server', 270], ['backup', 60], ['domain', 35],
          ['license', 25],
        ]);
        // The flag after the other parts, and none in August's: the shell's keys of September
        // stay its own, as the header never projects
        for (const name of NAMES) {
          expect(keysOf(name)).toEqual([
            [name, undefined, undefined],
            [name, ...AUGUST],
            [name, ...SEPTEMBER, 'projected'],
          ]);
        }
      });

    it('asks for them as before while the page does not project it', async () => {
      const { result, keysOf } = await renderTabHook(useCompareTab,
        { ...projecting, projectsMonthInProgress: false }, billedLate);

      for (const name of PROJECTED_FIGURES) {
        expect(api[name], name).toHaveBeenCalledWith(...SEPTEMBER, null);
        expect(api[name], name).not.toHaveBeenCalledWith(...SEPTEMBER, null, PROJECTED);
      }
      // What September billed so far, which leaves no variation to compute
      expect(result.current.compareDataB.total).toBe(910.4);
      expect(result.current.comparedMonths)
        .toEqual({ includesMonthInProgress: true, projected: false });
      expect(keysOf('summary')).toEqual([
        ['summary', undefined, undefined], ['summary', ...AUGUST], ['summary', ...SEPTEMBER],
      ]);
    });

    it('asks for them as before when no month is in progress', async () => {
      const { result } = await renderTabHook(useCompareTab, { ...projecting, months }, billedLate);

      for (const name of FIGURES) {
        expect(api[name].mock.calls.some((call) => call.length > 3), name).toBe(false);
      }
      // Two complete months, whatever the setting
      expect(result.current.comparedMonths)
        .toEqual({ includesMonthInProgress: false, projected: false });
    });

    it('asks for them projected once the page projects it, and as before once it stops',
      async () => {
        const notProjecting = { ...projecting, projectsMonthInProgress: false };
        const { result, rerender } = await renderTabHook(useCompareTab, notProjecting,
          billedLate);

        await rerender(projecting);

        expect(api.fetchSummary).toHaveBeenLastCalledWith(...SEPTEMBER, null, PROJECTED);
        expect(result.current.compareDataB.total).toBe(1220.4);

        await rerender(notProjecting);

        // Its answers kept in the cache, under their own key
        expect(result.current.compareDataB.total).toBe(910.4);
      });

    // Month B, then month A too: whichever the month in progress is
    it('asks for month A projected when it is the month in progress', async () => {
      const { result, queryClient } = await renderTabHook(useCompareTab, projecting, billedLate);

      act(() => result.current.setCompareMonthA(september));
      act(() => result.current.setCompareMonthB(july));
      await settle(queryClient);

      expect(result.current.compareDataA).toMatchObject({ total: 1220.4, projected: 310 });
      expect(api.fetchSummary).not.toHaveBeenCalledWith('2026-07-01', '2026-07-31', null,
        PROJECTED);
    });

    it('asks for the services that its rows unfold into projected, under keys of their own',
      async () => {
        const { result } = await renderTabHook(useCompareTab, projecting, billedLate);

        const servers = result.current.resourceTypeServicesQuery('dedicated_server', september);
        const backups = result.current.backupServicesQuery('vms', september);

        expect(servers.queryKey)
          .toEqual(['resourceTypeDetails', 'dedicated_server', ...SEPTEMBER, 'projected']);
        expect(await servers.queryFn()).toEqual([expect.objectContaining({
          domain: 'ns3000001.ip-203-0-113.eu', total: 270, projected: 270,
        })]);
        expect(api.fetchResourceTypeDetails)
          .toHaveBeenCalledWith('dedicated_server', ...SEPTEMBER, null, PROJECTED);
        expect(backups.queryKey).toEqual(['backupServices', ...SEPTEMBER, 'projected']);
        expect(backups.select(await backups.queryFn()).map(({ domain, projected }) => [
          domain, projected,
        ])).toEqual([
          ['vm-app-1.example.com', 25], ['vm-files-1.example.com', 0],
          ['vm-db-1.example.com', 15],
        ]);
        expect(api.fetchBackupServices).toHaveBeenCalledWith(...SEPTEMBER, null, PROJECTED);
        // Those of August, as the Infrastructure tab asks for them
        expect(result.current.resourceTypeServicesQuery('dedicated_server', august).queryKey)
          .toEqual(['resourceTypeDetails', 'dedicated_server', ...AUGUST]);
        expect(result.current.backupServicesQuery('vms', august).queryKey)
          .toEqual(['backupServices', ...AUGUST]);
      });

    // As the months list of the account shown marks it (see fixtures/accounts.js), and with the
    // flag before the account, as the Trends tab's keys name it (ADR 0001)
    it('asks for those of the account shown, the flag before the account in the keys',
      async () => {
        const lyonMonths = lyonBilledLate.ofAccount[lyonAccount.id].months;
        const { result, keysOf } = await renderTabHook(useCompareTab,
          { ...projecting, months: lyonMonths, selectedAccount: lyonAccount.id }, lyonBilledLate);

        expect(api.fetchSummary).toHaveBeenCalledWith(...SEPTEMBER, lyonAccount.id, PROJECTED);
        expect(keysOf('summary')).toContainEqual(
          ['summary', ...SEPTEMBER, 'projected', lyonAccount.id],
        );
        expect(result.current.resourceTypeServicesQuery('dedicated_server', september).queryKey)
          .toEqual([
            'resourceTypeDetails', 'dedicated_server', ...SEPTEMBER, 'projected', lyonAccount.id,
          ]);
      });

    // While the lists name the account of each service, all accounts shown (#194, #197)
    it('asks for the services by account projected, the flag last in their keys', async () => {
      const { result } = await renderTabHook(useCompareTab, {
        ...projecting,
        accountColumn: accountColumnOf(
          accountsOf(severalAccounts.accounts), null, (key) => translations.fr[key],
        ),
      }, lyonBilledLate);

      const servers = result.current.resourceTypeServicesQuery('dedicated_server', september);
      const backups = result.current.backupServicesQuery('vms', september);

      expect(servers.queryKey)
        .toEqual(['resourceTypeDetailsByAccount', 'dedicated_server', ...SEPTEMBER, 'projected']);
      await servers.queryFn();
      expect(api.fetchResourceTypeDetailsByAccount)
        .toHaveBeenCalledWith('dedicated_server', ...SEPTEMBER, PROJECTED);
      expect(backups.queryKey).toEqual(['backupServicesByAccount', ...SEPTEMBER, 'projected']);
      await backups.queryFn();
      expect(api.fetchBackupServicesByAccount).toHaveBeenCalledWith(...SEPTEMBER, PROJECTED);
    });
  });
});
