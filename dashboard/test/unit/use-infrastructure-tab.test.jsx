import { describe, it, expect } from 'vitest';
import { act } from '@testing-library/react';
import { translations } from '../../src/i18n/translations.js';
import { useInfrastructureTab } from '../../src/tabs/useInfrastructureTab.js';
import { accountColumnOf, accountsOf } from '../../src/utils/accounts.js';
import { account, logsDataPlatformBilled } from '../fixtures/account.js';
import {
  lyonAccount, removedAccount, severalAccounts, severalAccountsWithLogsDataPlatform,
  unknownAccount,
} from '../fixtures/accounts.js';
import { months } from '../fixtures/calendar.js';
import { api } from '../support/api.js';
import { renderTabHook, TAB_IDS, WAITING } from '../support/hooks.jsx';

// The state and data queries of the Infrastructure tab, as the dashboard shell sees them:
// what the hook requests and returns for the selected month, the active tab, the resource
// type whose bill lines are open, the account shown, null for all accounts, and the Account
// column of the lists, null when they name no account (#123).

const [september, august] = months;
// What the shell passes while the Infrastructure tab is open on September, which the months
// of the account shown hold, with no resource type open, for all accounts, and lists that
// name no account, as with a single account (ADR 0001)
const onInfrastructure = {
  selectedMonth: september,
  holdsSelectedMonth: true,
  activeTab: 'infrastructure',
  selectedResourceType: null,
  selectedAccount: null,
  accountColumn: null,
};
// The Account column of the lists, as the shell builds it for all accounts shown, when the
// instance knows several
const accountColumn = accountColumnOf(
  accountsOf(severalAccounts.accounts), null, (key) => translations.fr[key],
);

// The dedicated servers of the inventory, as [id, display name]
const servers = (inventory) => inventory.map(({ id, display_name }) => [id, display_name]);
// The VPS of the inventory, as [id, model, zone]
const vpsInstances = (inventory) => inventory.map(({ id, model, zone }) => [id, model, zone]);
// The storage services of the inventory, as [id, display name, type]
const storageServices = (inventory) => inventory
  .map(({ id, display_name, service_type }) => [id, display_name, service_type]);
// The bill lines of a resource type, as [service, cost]
const billLines = (lines) => lines.map(({ domain, total }) => [domain, total]);

describe('useInfrastructureTab', () => {
  // The page opens on the Overview, with no resource type open: nothing loads with it. Nor
  // does anything load on the Compare tab, which no longer lists the dedicated servers of the
  // inventory, but those billed (#194).
  it.each(TAB_IDS.filter((tab) => tab !== 'infrastructure'))(
    'requests nothing while the %s tab is active',
    async (activeTab) => {
      const { result } = await renderTabHook(useInfrastructureTab,
        { ...onInfrastructure, activeTab });

      expect(api.fetchInventoryServers).not.toHaveBeenCalled();
      expect(api.fetchInventoryVps).not.toHaveBeenCalled();
      expect(api.fetchInventoryStorage).not.toHaveBeenCalled();
      expect(api.fetchResourceTypeDetails).not.toHaveBeenCalled();
      expect(result.current.inventoryServers).toEqual([]);
      expect(result.current.inventoryVps).toEqual([]);
      expect(result.current.inventoryStorage).toEqual([]);
      expect(result.current.resourceTypeDetails).toEqual([]);
    },
  );

  it('requests the inventory once the tab opens', async () => {
    const { rerender } = await renderTabHook(useInfrastructureTab,
      { ...onInfrastructure, activeTab: 'overview' });

    await rerender(onInfrastructure);

    expect(api.fetchInventoryServers).toHaveBeenCalled();
    expect(api.fetchInventoryVps).toHaveBeenCalled();
    expect(api.fetchInventoryStorage).toHaveBeenCalled();
    // The bill lines of a resource type wait until the user opens one
    expect(api.fetchResourceTypeDetails).not.toHaveBeenCalled();
  });

  it('returns the inventory, and the "show all" modal of the servers closed', async () => {
    const { result } = await renderTabHook(useInfrastructureTab, onInfrastructure);

    // What the shell spreads over the tab and its modal, and nothing else: the sort order of
    // its tables too (#146), and the query of the month's Logs Data Platform charges, which
    // their table runs (#247)
    expect(result.current).toEqual({
      sortingOf: expect.any(Function),
      inventoryServers: expect.any(Array),
      inventoryVps: expect.any(Array),
      inventoryStorage: expect.any(Array),
      resourceTypeDetails: [],
      logsDataPlatformQuery: expect.any(Object),
      showAllServers: false,
      setShowAllServers: expect.any(Function),
    });
    expect(servers(result.current.inventoryServers)).toEqual([
      ['ns3000001.ip-203-0-113.eu', 'backup-server'],
      ['ns3000002.ip-198-51-100.eu', 'ns3000002.ip-198-51-100.eu'],
    ]);
    expect(vpsInstances(result.current.inventoryVps))
      .toEqual([['vps-0a1b2c3d.vps.ovh.net', 'vps-le-2-2-40', 'Region OpenStack: os-gra7']]);
    expect(storageServices(result.current.inventoryStorage))
      .toEqual([['netapp-5f2c9a1e', 'shared-files', 'netapp']]);
  });

  it('requests the bill lines of the open resource type in the selected month', async () => {
    const { result } = await renderTabHook(useInfrastructureTab,
      { ...onInfrastructure, selectedResourceType: 'backup' });

    expect(api.fetchResourceTypeDetails)
      .toHaveBeenCalledWith('backup', '2026-09-01', '2026-09-30', null);
    // Most expensive service first, as the server sorts them
    expect(billLines(result.current.resourceTypeDetails)).toEqual([
      ['vm-app-1.example.com', 40],
      ['vm-db-1.example.com', 30],
      ['vm-files-1.example.com', 20],
    ]);
  });

  // A resource type can stay open while another tab is active: its bill lines keep loading
  // there, so that the user finds them ready when coming back (#56, ADR 0001)
  it('requests the bill lines of an open resource type whatever the tab', async () => {
    const { result } = await renderTabHook(useInfrastructureTab,
      { ...onInfrastructure, activeTab: 'overview', selectedResourceType: 'dedicated_server' });

    expect(api.fetchResourceTypeDetails)
      .toHaveBeenCalledWith('dedicated_server', '2026-09-01', '2026-09-30', null);
    expect(billLines(result.current.resourceTypeDetails))
      .toEqual([['ns3000001.ip-203-0-113.eu', 270]]);
  });

  it('waits for a month before requesting the bill lines of a resource type', async () => {
    const { result, queryClient } = await renderTabHook(useInfrastructureTab, {
      ...onInfrastructure, selectedMonth: null, holdsSelectedMonth: false,
      selectedResourceType: 'dedicated_server',
    });

    expect(api.fetchResourceTypeDetails).not.toHaveBeenCalled();
    expect(result.current.resourceTypeDetails).toEqual([]);
    // The query waits for a month, rather than failing for the lack of one
    const key = ['resourceTypeDetails', 'dedicated_server', undefined, undefined];
    expect(queryClient.getQueryState(key)).toMatchObject(WAITING);
  });

  // While the months of the account just selected load, or when it lacks the month selected,
  // until the shell selects its latest month (#115): the bill lines of that month would never
  // show (#120)
  it('waits until the months of the account shown hold the month selected', async () => {
    const { result, queryClient } = await renderTabHook(useInfrastructureTab, {
      ...onInfrastructure, holdsSelectedMonth: false, selectedResourceType: 'dedicated_server',
    });

    expect(api.fetchResourceTypeDetails).not.toHaveBeenCalled();
    expect(result.current.resourceTypeDetails).toEqual([]);
    const key = ['resourceTypeDetails', 'dedicated_server', '2026-09-01', '2026-09-30'];
    expect(queryClient.getQueryState(key)).toMatchObject(WAITING);
  });

  // The inventory is what exists now, whatever the month: one answer for every month
  it('caches each answer under the name of its query', async () => {
    const { keysOf } = await renderTabHook(useInfrastructureTab,
      { ...onInfrastructure, selectedResourceType: 'backup' });

    expect(keysOf('inventoryServers')).toEqual([['inventoryServers']]);
    expect(keysOf('inventoryVps')).toEqual([['inventoryVps']]);
    expect(keysOf('inventoryStorage')).toEqual([['inventoryStorage']]);
    // The bill lines, by resource type and month
    expect(keysOf('resourceTypeDetails'))
      .toEqual([['resourceTypeDetails', 'backup', '2026-09-01', '2026-09-30']]);
  });

  it('follows the selected month', async () => {
    const { result, rerender } = await renderTabHook(useInfrastructureTab,
      { ...onInfrastructure, selectedResourceType: 'backup' });

    await rerender({ ...onInfrastructure, selectedMonth: august, selectedResourceType: 'backup' });

    expect(api.fetchResourceTypeDetails)
      .toHaveBeenCalledWith('backup', '2026-08-01', '2026-08-31', null);
    expect(billLines(result.current.resourceTypeDetails)).toEqual([
      ['vm-app-1.example.com', 25],
      ['vm-db-1.example.com', 15],
    ]);
  });

  it('follows the open resource type, and returns no bill lines once it closes', async () => {
    const { result, rerender } = await renderTabHook(useInfrastructureTab,
      { ...onInfrastructure, selectedResourceType: 'backup' });

    await rerender({ ...onInfrastructure, selectedResourceType: 'dedicated_server' });

    expect(api.fetchResourceTypeDetails)
      .toHaveBeenCalledWith('dedicated_server', '2026-09-01', '2026-09-30', null);
    expect(billLines(result.current.resourceTypeDetails))
      .toEqual([['ns3000001.ip-203-0-113.eu', 270]]);

    await rerender(onInfrastructure);

    expect(result.current.resourceTypeDetails).toEqual([]);
  });

  // With several accounts in the instance (#123): see fixtures/accounts.js
  describe('account shown', () => {
    const shown = (selectedAccount, props = {}) =>
      ({ ...onInfrastructure, selectedAccount, ...props });

    it('requests the inventory of the account selected, and caches it under its id',
      async () => {
        const { result, keysOf } = await renderTabHook(useInfrastructureTab,
          shown(lyonAccount.id), severalAccounts);

        for (const request of [
          api.fetchInventoryServers, api.fetchInventoryVps, api.fetchInventoryStorage,
        ]) {
          expect(request).toHaveBeenCalledWith('xx1111-ovh');
        }
        expect(servers(result.current.inventoryServers))
          .toEqual([['ns3000001.ip-203-0-113.eu', 'backup-server']]);
        expect(vpsInstances(result.current.inventoryVps))
          .toEqual([['vps-0a1b2c3d.vps.ovh.net', 'vps-le-2-2-40', 'Region OpenStack: os-gra7']]);
        expect(storageServices(result.current.inventoryStorage))
          .toEqual([['netapp-5f2c9a1e', 'shared-files', 'netapp']]);
        // After the other parts of the key, as the shell's queries that follow the account
        expect(keysOf('inventoryServers')).toEqual([['inventoryServers', 'xx1111-ovh']]);
        expect(keysOf('inventoryVps')).toEqual([['inventoryVps', 'xx1111-ovh']]);
        expect(keysOf('inventoryStorage')).toEqual([['inventoryStorage', 'xx1111-ovh']]);
      });

    it('requests the bill lines of the account selected, and caches them under its id',
      async () => {
        const { result, keysOf } = await renderTabHook(useInfrastructureTab,
          shown('yy2222-ovh', { selectedResourceType: 'backup' }), severalAccounts);

        expect(api.fetchResourceTypeDetails)
          .toHaveBeenCalledWith('backup', '2026-09-01', '2026-09-30', 'yy2222-ovh');
        expect(billLines(result.current.resourceTypeDetails)).toEqual([
          ['vm-app-1.example.com', 40],
          ['vm-db-1.example.com', 30],
          ['vm-files-1.example.com', 20],
        ]);
        expect(keysOf('resourceTypeDetails'))
          .toEqual([['resourceTypeDetails', 'backup', '2026-09-01', '2026-09-30', 'yy2222-ovh']]);
      });

    it('follows the account selected, and all accounts again', async () => {
      const { result, rerender, keysOf } = await renderTabHook(useInfrastructureTab,
        shown(null), severalAccounts);

      await rerender(shown(removedAccount.id));

      expect(servers(result.current.inventoryServers))
        .toEqual([['ns3000003.ip-203-0-113.eu', 'db-server']]);
      expect(result.current.inventoryVps).toEqual([]);

      await rerender(shown(null));

      expect(servers(result.current.inventoryServers)).toEqual([
        ['ns3000001.ip-203-0-113.eu', 'backup-server'],
        ['ns3000003.ip-203-0-113.eu', 'db-server'],
        ['ns3000004.ip-203-0-113.eu', 'legacy-server'],
        ['ns3000002.ip-198-51-100.eu', 'ns3000002.ip-198-51-100.eu'],
      ]);
      // Each account keeps its own answers
      expect(keysOf('inventoryServers')).toEqual([
        ['inventoryServers'],
        ['inventoryServers', 'zz3333-ovh'],
      ]);
    });

    // Those that no account claimed
    it('requests the servers of the Unknown account', async () => {
      const { result } = await renderTabHook(useInfrastructureTab, shown('unknown'),
        severalAccounts);

      expect(api.fetchInventoryServers).toHaveBeenCalledWith('unknown');
      expect(servers(result.current.inventoryServers))
        .toEqual([['ns3000004.ip-203-0-113.eu', 'legacy-server']]);
    });

    // For the list that names the account of each service: a service billed to several
    // accounts once for each, which only all accounts have
    it('requests the bill lines by account while the lists name the account of each service',
      async () => {
        const { result, keysOf } = await renderTabHook(useInfrastructureTab,
          shown(null, { selectedResourceType: 'backup', accountColumn }), severalAccounts);

        expect(api.fetchResourceTypeDetailsByAccount)
          .toHaveBeenCalledWith('backup', '2026-09-01', '2026-09-30');
        expect(api.fetchResourceTypeDetails).not.toHaveBeenCalled();
        expect(result.current.resourceTypeDetails)
          .toEqual(severalAccounts.resourceTypeDetailsByAccount.backup['2026-09']);
        // For all accounts, which the column shows: its key names none
        expect(keysOf('resourceTypeDetailsByAccount'))
          .toEqual([['resourceTypeDetailsByAccount', 'backup', '2026-09-01', '2026-09-30']]);
        expect(keysOf('resourceTypeDetails')).toEqual([]);
      });

    it('waits for the month of the bill lines by account, as for those of an account',
      async () => {
        const { queryClient } = await renderTabHook(useInfrastructureTab, shown(null, {
          selectedResourceType: 'backup', accountColumn, holdsSelectedMonth: false,
        }), severalAccounts);

        expect(api.fetchResourceTypeDetailsByAccount).not.toHaveBeenCalled();
        expect(queryClient.getQueryState(
          ['resourceTypeDetailsByAccount', 'backup', '2026-09-01', '2026-09-30'],
        )).toMatchObject(WAITING);
      });

    // Rather than ask for all accounts, while the page may yet show a remembered one
    it('requests nothing while the page does not know the account it shows', async () => {
      const { result, queryClient } = await renderTabHook(useInfrastructureTab,
        shown(undefined, { selectedResourceType: 'backup' }), severalAccounts);

      for (const request of [
        api.fetchInventoryServers, api.fetchInventoryVps, api.fetchInventoryStorage,
        api.fetchResourceTypeDetails,
      ]) {
        expect(request).not.toHaveBeenCalled();
      }
      expect(result.current.inventoryServers).toEqual([]);
      // The queries wait for the account, under keys that name none yet
      expect(queryClient.getQueryState(['inventoryServers', undefined])).toMatchObject(WAITING);
      expect(queryClient.getQueryState(
        ['resourceTypeDetails', 'backup', '2026-09-01', '2026-09-30', undefined],
      )).toMatchObject(WAITING);
    });
  });

  // The charges of the Logs Data Platform services that the month selected billed (#247), the
  // services together, as the figures of the month: the query that their table runs once the tab
  // shows it, which the hook defines, so that the page opens with the queries it had (see
  // fixtures/account.js and fixtures/accounts.js)
  describe('query of the Logs Data Platform charges of the month', () => {
    // The synthetic account, billed for Logs Data Platform in August and September
    const withLogsDataPlatform = { ...account, ...logsDataPlatformBilled };
    const ofAccount = (id) => severalAccountsWithLogsDataPlatform.ofAccount[id].logsDataPlatform;
    const shown = (selectedAccount, props = {}) =>
      ({ ...onInfrastructure, selectedAccount, ...props });

    it('asks for the charges of the month selected, and runs none itself', async () => {
      const { result, keysOf } = await renderTabHook(useInfrastructureTab, onInfrastructure,
        withLogsDataPlatform);
      // Nothing is asked for before the table shows
      expect(api.fetchLogsDataPlatform).not.toHaveBeenCalled();
      expect(keysOf('logsDataPlatform')).toEqual([]);

      const query = result.current.logsDataPlatformQuery;

      // For all accounts, its key names none, as its request does not (ADR 0001)
      expect(query.queryKey).toEqual(['logsDataPlatform', '2026-09-01', '2026-09-30']);
      expect(query.enabled).toBe(true);
      await expect(query.queryFn())
        .resolves.toEqual(logsDataPlatformBilled.logsDataPlatform['2026-09']);
      expect(api.fetchLogsDataPlatform).toHaveBeenCalledWith('2026-09-01', '2026-09-30', null);
    });

    it('follows the selected month', async () => {
      const { result, rerender } = await renderTabHook(useInfrastructureTab, onInfrastructure,
        withLogsDataPlatform);

      await rerender({ ...onInfrastructure, selectedMonth: august });

      const query = result.current.logsDataPlatformQuery;
      expect(query.queryKey).toEqual(['logsDataPlatform', '2026-08-01', '2026-08-31']);
      await expect(query.queryFn())
        .resolves.toEqual(logsDataPlatformBilled.logsDataPlatform['2026-08']);
      expect(api.fetchLogsDataPlatform).toHaveBeenCalledWith('2026-08-01', '2026-08-31', null);
    });

    // As the inventory: on the tab only, for a month of the months list, once the page knows the
    // account shown. A month that the account shown lacks would never show (#115, #120).
    it('waits for the tab, for a month of the account shown, and for that account', async () => {
      const { result, rerender } = await renderTabHook(useInfrastructureTab,
        { ...onInfrastructure, activeTab: 'overview' }, withLogsDataPlatform);

      expect(result.current.logsDataPlatformQuery.enabled).toBe(false);

      await rerender({ ...onInfrastructure, selectedMonth: null, holdsSelectedMonth: false });

      expect(result.current.logsDataPlatformQuery)
        .toMatchObject({ queryKey: ['logsDataPlatform', undefined, undefined], enabled: false });

      await rerender({ ...onInfrastructure, holdsSelectedMonth: false });

      expect(result.current.logsDataPlatformQuery.enabled).toBe(false);

      await rerender(shown(undefined));

      expect(result.current.logsDataPlatformQuery.enabled).toBe(false);
    });

    it('asks for those of the account shown, under a key that names it', async () => {
      const { result } = await renderTabHook(useInfrastructureTab, shown(lyonAccount.id),
        severalAccountsWithLogsDataPlatform);

      const query = result.current.logsDataPlatformQuery;

      // The account after the other parts of the key, which stay those of all accounts
      expect(query.queryKey)
        .toEqual(['logsDataPlatform', '2026-09-01', '2026-09-30', 'xx1111-ovh']);
      await expect(query.queryFn()).resolves.toEqual(ofAccount(lyonAccount.id)['2026-09']);
      expect(api.fetchLogsDataPlatform)
        .toHaveBeenCalledWith('2026-09-01', '2026-09-30', 'xx1111-ovh');
    });

    // Those that no account claimed, in July, its only month
    it('asks for those of the Unknown account', async () => {
      const [, , july] = months;
      const { result } = await renderTabHook(useInfrastructureTab,
        shown(unknownAccount.id, { selectedMonth: july }), severalAccountsWithLogsDataPlatform);

      const query = result.current.logsDataPlatformQuery;

      expect(query.queryKey).toEqual(['logsDataPlatform', '2026-07-01', '2026-07-31', 'unknown']);
      await expect(query.queryFn()).resolves.toEqual(ofAccount(unknownAccount.id)['2026-07']);
    });

    // The table names no account: while the lists name the account of each row, it adds up all
    // accounts' charges, under the key of all accounts, rather than ask for them by account
    it('asks for those of all accounts while the lists name the account of each row',
      async () => {
        const { result } = await renderTabHook(useInfrastructureTab,
          shown(null, { accountColumn }), severalAccountsWithLogsDataPlatform);

        const query = result.current.logsDataPlatformQuery;

        expect(query.queryKey).toEqual(['logsDataPlatform', '2026-09-01', '2026-09-30']);
        await expect(query.queryFn())
          .resolves.toEqual(severalAccountsWithLogsDataPlatform.logsDataPlatform['2026-09']);
        expect(api.fetchLogsDataPlatform).toHaveBeenCalledWith('2026-09-01', '2026-09-30', null);
      });
  });

  it('keeps the "show all" modal of the servers open when another tab opens', async () => {
    const { result, rerender } = await renderTabHook(useInfrastructureTab, onInfrastructure);
    expect(result.current.showAllServers).toBe(false);

    act(() => result.current.setShowAllServers(true));
    await rerender({ ...onInfrastructure, activeTab: 'overview' });

    expect(result.current.showAllServers).toBe(true);
  });
});
