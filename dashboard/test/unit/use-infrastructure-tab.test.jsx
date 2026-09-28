import { describe, it, expect } from 'vitest';
import { act } from '@testing-library/react';
import { translations } from '../../src/i18n/translations.js';
import { useInfrastructureTab } from '../../src/tabs/useInfrastructureTab.js';
import { accountColumnOf, accountsOf } from '../../src/utils/accounts.js';
import { lyonAccount, removedAccount, severalAccounts } from '../fixtures/accounts.js';
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
  // The page opens on the Overview, with no resource type open: nothing loads with it. The
  // Compare tab loads the dedicated servers (#35), see below.
  it.each(TAB_IDS.filter((tab) => !['infrastructure', 'compare'].includes(tab)))(
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
    // its tables too (#146)
    expect(result.current).toEqual({
      sortingOf: expect.any(Function),
      inventoryServers: expect.any(Array),
      inventoryVps: expect.any(Array),
      inventoryStorage: expect.any(Array),
      resourceTypeDetails: [],
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

  // The Compare tab lists the servers this hook returns, which the shell passes on: they
  // load on that tab too, under the same key, before the Infrastructure tab opens (#35)
  it('requests the servers, and only them, while the Compare tab is active (#35)', async () => {
    const { result, keysOf } = await renderTabHook(useInfrastructureTab,
      { ...onInfrastructure, activeTab: 'compare' });

    expect(api.fetchInventoryServers).toHaveBeenCalled();
    expect(api.fetchInventoryVps).not.toHaveBeenCalled();
    expect(api.fetchInventoryStorage).not.toHaveBeenCalled();
    expect(api.fetchResourceTypeDetails).not.toHaveBeenCalled();
    expect(servers(result.current.inventoryServers)).toEqual([
      ['ns3000001.ip-203-0-113.eu', 'backup-server'],
      ['ns3000002.ip-198-51-100.eu', 'ns3000002.ip-198-51-100.eu'],
    ]);
    expect(result.current.inventoryVps).toEqual([]);
    expect(result.current.inventoryStorage).toEqual([]);
    expect(keysOf('inventoryServers')).toEqual([['inventoryServers']]);
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

    // The servers that the Compare tab lists too (#35)
    it('requests the servers of the account selected on the Compare tab', async () => {
      const { result } = await renderTabHook(useInfrastructureTab,
        shown('unknown', { activeTab: 'compare' }), severalAccounts);

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

  it('keeps the "show all" modal of the servers open when another tab opens', async () => {
    const { result, rerender } = await renderTabHook(useInfrastructureTab, onInfrastructure);
    expect(result.current.showAllServers).toBe(false);

    act(() => result.current.setShowAllServers(true));
    await rerender({ ...onInfrastructure, activeTab: 'overview' });

    expect(result.current.showAllServers).toBe(true);
  });
});
