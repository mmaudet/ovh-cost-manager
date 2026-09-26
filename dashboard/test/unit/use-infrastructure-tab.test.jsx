import { describe, it, expect } from 'vitest';
import { act } from '@testing-library/react';
import { useInfrastructureTab } from '../../src/tabs/useInfrastructureTab.js';
import { months } from '../fixtures/calendar.js';
import { api } from '../support/api.js';
import { renderTabHook, TAB_IDS, WAITING } from '../support/hooks.jsx';

// The state and data queries of the Infrastructure tab, as the dashboard shell sees them:
// what the hook requests and returns for the selected month, the active tab and the
// resource type whose bill lines are open.

const [september, august] = months;
// What the shell passes while the Infrastructure tab is open on September, with no
// resource type open
const onInfrastructure = {
  selectedMonth: september, activeTab: 'infrastructure', selectedResourceType: null,
};

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
  // The page opens on the Overview, with no resource type open: nothing loads with it
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

    // What the shell spreads over the tab and its modal, and nothing else
    expect(result.current).toEqual({
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

  // The Compare tab lists the servers this hook returns, which the shell passes on, though
  // they only load on the Infrastructure tab (#35)
  it('keeps the servers for the Compare tab once Infrastructure loaded them (#35)', async () => {
    const { result, rerender } = await renderTabHook(useInfrastructureTab,
      { ...onInfrastructure, activeTab: 'compare' });
    expect(result.current.inventoryServers).toEqual([]);

    await rerender(onInfrastructure);
    await rerender({ ...onInfrastructure, activeTab: 'compare' });

    expect(servers(result.current.inventoryServers)).toEqual([
      ['ns3000001.ip-203-0-113.eu', 'backup-server'],
      ['ns3000002.ip-198-51-100.eu', 'ns3000002.ip-198-51-100.eu'],
    ]);
  });

  it('requests the bill lines of the open resource type in the selected month', async () => {
    const { result } = await renderTabHook(useInfrastructureTab,
      { ...onInfrastructure, selectedResourceType: 'backup' });

    expect(api.fetchResourceTypeDetails)
      .toHaveBeenCalledWith('backup', '2026-09-01', '2026-09-30');
    // Most expensive service first, as the server sorts them
    expect(billLines(result.current.resourceTypeDetails)).toEqual([
      ['vm-app-1.example.com', 40],
      ['vm-db-1.example.com', 30],
      ['vm-files-1.example.com', 20],
    ]);
  });

  // The logo leads back to the Overview with the resource type still open (#56)
  it('requests the bill lines of an open resource type whatever the tab', async () => {
    const { result } = await renderTabHook(useInfrastructureTab,
      { ...onInfrastructure, activeTab: 'overview', selectedResourceType: 'dedicated_server' });

    expect(api.fetchResourceTypeDetails)
      .toHaveBeenCalledWith('dedicated_server', '2026-09-01', '2026-09-30');
    expect(billLines(result.current.resourceTypeDetails))
      .toEqual([['ns3000001.ip-203-0-113.eu', 270]]);
  });

  it('waits for a month before requesting the bill lines of a resource type', async () => {
    const { result, queryClient } = await renderTabHook(useInfrastructureTab,
      { ...onInfrastructure, selectedMonth: null, selectedResourceType: 'dedicated_server' });

    expect(api.fetchResourceTypeDetails).not.toHaveBeenCalled();
    expect(result.current.resourceTypeDetails).toEqual([]);
    // The query waits for a month, rather than failing for the lack of one
    const key = ['resourceTypeDetails', 'dedicated_server', undefined, undefined];
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
      .toHaveBeenCalledWith('backup', '2026-08-01', '2026-08-31');
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
      .toHaveBeenCalledWith('dedicated_server', '2026-09-01', '2026-09-30');
    expect(billLines(result.current.resourceTypeDetails))
      .toEqual([['ns3000001.ip-203-0-113.eu', 270]]);

    await rerender(onInfrastructure);

    expect(result.current.resourceTypeDetails).toEqual([]);
  });

  it('keeps the "show all" modal of the servers open when another tab opens', async () => {
    const { result, rerender } = await renderTabHook(useInfrastructureTab, onInfrastructure);
    expect(result.current.showAllServers).toBe(false);

    act(() => result.current.setShowAllServers(true));
    await rerender({ ...onInfrastructure, activeTab: 'overview' });

    expect(result.current.showAllServers).toBe(true);
  });
});
