import { describe, it, expect } from 'vitest';
import { act } from '@testing-library/react';
import { usePublicCloudTab } from '../../src/tabs/usePublicCloudTab.js';
import { months } from '../fixtures/calendar.js';
import { api } from '../support/api.js';
import { renderTabHook, TAB_IDS, WAITING } from '../support/hooks.jsx';

// The state and data queries of the Public Cloud tab, as the dashboard shell sees them: what
// the hook requests and returns for the selected month, the active tab and the selected
// project. The shell holds the project: the tab, the Overview and the logo set it.

const [september, august] = months;
// Projects as the Overview selects them: an id and a name
const production = { id: 'project-production', name: 'Production' };
const staging = { id: 'project-staging', name: 'Staging' };
// The tab open on September, no project open
const onTheTab = { selectedMonth: september, activeTab: 'inventory', selectedProject: null };

// The requests of the resources of a project, and those the hook made
const PROJECT_REQUESTS = [
  'fetchProjectConsumption', 'fetchProjectQuotas', 'fetchProjectInstances',
  'fetchProjectInstanceTotal', 'fetchProjectBuckets', 'fetchProjectVolumes',
  'fetchProjectSnapshots', 'fetchProjectSavingsPlans',
];
const made = (requests) => requests.filter((name) => api[name].mock.calls.length > 0);

// What a project consumed, as [cloud resource kind, cost]
const consumption = (usage) =>
  usage.map(({ resource_type: kind, total_price: cost }) => [kind, cost]);
// The instances of a project, as [name, cost]; the bill lines of the instances gone from
// the inventory, as ['unallocated', cost]
const instances = (list) => list.map(({ name, total, unallocated }) =>
  (unallocated ? ['unallocated', total] : [name, total]));
const names = (list) => list.map(({ name }) => name);
// The "show all" modals open, by the resources they show
const openModals = (tab) => Object.entries({
  buckets: tab.showAllBuckets,
  instances: tab.showAllInstances,
  volumes: tab.showAllVolumes,
  snapshots: tab.showAllSnapshots,
  savingsPlans: tab.showAllSavingsPlans,
}).filter(([, open]) => open).map(([resources]) => resources);

describe('usePublicCloudTab', () => {
  describe('projects and figures of the month', () => {
    it.each(TAB_IDS.filter((tab) => tab !== 'inventory'))(
      'are left out while the %s tab is active',
      async (activeTab) => {
        const { result } = await renderTabHook(usePublicCloudTab, { ...onTheTab, activeTab });

        expect(api.fetchProjectsEnriched).not.toHaveBeenCalled();
        expect(api.fetchPublicCloudStats).not.toHaveBeenCalled();
        expect(result.current.projectsEnriched).toEqual([]);
        expect(result.current.publicCloudStats).toBeUndefined();
      },
    );

    it('are requested once the tab opens', async () => {
      const { result, rerender } = await renderTabHook(usePublicCloudTab,
        { ...onTheTab, activeTab: 'overview' });

      await rerender(onTheTab);

      expect(api.fetchProjectsEnriched).toHaveBeenCalled();
      expect(api.fetchPublicCloudStats).toHaveBeenCalledWith('2026-09-01', '2026-09-30');
      // Most consuming first, as the server sorts them
      expect(names(result.current.projectsEnriched))
        .toEqual(['Production', 'Staging', 'Sandbox']);
      expect(result.current.publicCloudStats).toEqual({
        instances: { total: 718.9 },
        kubernetes: { count: 0, total: 0 },
        objectStorage: { count: 3, total: 25 },
        volumes: { count: 3, total: 12.5 },
        snapshots: { count: 2, total: 6 },
        savingsPlans: { count: 2, total: 28 },
        registry: { count: 1, total: 40 },
        aiml: { count: 0, total: 0 },
        loadBalancers: { count: 0, total: 0 },
      });
    });

    it('wait for a month for the figures, not for the projects', async () => {
      const { result, queryClient } = await renderTabHook(usePublicCloudTab,
        { ...onTheTab, selectedMonth: null });

      expect(names(result.current.projectsEnriched))
        .toEqual(['Production', 'Staging', 'Sandbox']);
      expect(api.fetchPublicCloudStats).not.toHaveBeenCalled();
      expect(queryClient.getQueryState(['publicCloudStats', undefined, undefined]))
        .toMatchObject(WAITING);
    });

    it('follow the selected month', async () => {
      const { result, rerender } = await renderTabHook(usePublicCloudTab, onTheTab);

      await rerender({ ...onTheTab, selectedMonth: august });

      expect(api.fetchPublicCloudStats).toHaveBeenCalledWith('2026-08-01', '2026-08-31');
      expect(result.current.publicCloudStats.instances).toEqual({ total: 590.6 });
      // The empty bucket was created in September
      expect(result.current.publicCloudStats.objectStorage).toEqual({ count: 2, total: 24.9 });
    });
  });

  describe('resources of a project', () => {
    it.each(TAB_IDS)('are left out while no project is open on the %s tab', async (activeTab) => {
      const { result, queryClient } = await renderTabHook(usePublicCloudTab,
        { ...onTheTab, activeTab });

      expect(made(PROJECT_REQUESTS)).toEqual([]);
      // Each query waits for a project, rather than failing for the lack of one
      for (const key of [
        ['projectConsumption', undefined],
        ['projectQuotas', undefined],
        ['projectInstances', undefined, '2026-09-01', '2026-09-30'],
        ['projectInstanceTotal', undefined, '2026-09-01', '2026-09-30'],
        ['projectBuckets', undefined, '2026-09-01', '2026-09-30'],
        ['projectVolumes', undefined, '2026-09-01', '2026-09-30'],
        ['projectSnapshots', undefined, '2026-09-01', '2026-09-30'],
        ['projectSavingsPlans', undefined, '2026-09-01', '2026-09-30'],
      ]) {
        expect(queryClient.getQueryState(key), key[0]).toMatchObject(WAITING);
      }
      expect(result.current.projectInstances).toEqual([]);
      expect(result.current.instanceCount).toBe(0);
    });

    // The Overview opens a project and the tab at once, and a project stays open when the
    // user leaves the tab (#56)
    it.each(TAB_IDS)('are requested once a project is open, while the %s tab is active',
      async (activeTab) => {
        await renderTabHook(usePublicCloudTab,
          { ...onTheTab, activeTab, selectedProject: production });

        // All it consumed so far, and its quotas: whatever the month
        expect(api.fetchProjectConsumption).toHaveBeenCalledWith('project-production');
        expect(api.fetchProjectQuotas).toHaveBeenCalledWith('project-production');
        for (const fetchResources of [
          api.fetchProjectInstances,
          api.fetchProjectInstanceTotal,
          api.fetchProjectBuckets,
          api.fetchProjectVolumes,
          api.fetchProjectSnapshots,
          api.fetchProjectSavingsPlans,
        ]) {
          expect(fetchResources)
            .toHaveBeenCalledWith('project-production', '2026-09-01', '2026-09-30');
        }
      });

    it('are returned for the selected project and month', async () => {
      const { result } = await renderTabHook(usePublicCloudTab,
        { ...onTheTab, selectedProject: production });

      expect(consumption(result.current.projectConsumption)).toEqual([
        ['instance', 210.25], ['instance', 12], ['instance', 12], ['instance_monthly', 64],
        ['volume', 5.25], ['volume', 2.25], ['snapshot', 3.25], ['objectStorage', 41],
      ]);
      // By name, as the server sorts them, then the bill lines of the deleted instances
      expect(instances(result.current.projectInstances)).toEqual([
        ['batch-1', null], ['db-1', 64], ['inference-1', 420.5], ['web-1', 24], ['web-2', 24],
        ['unallocated', 6.4],
      ]);
      // The unallocated row is not an instance
      expect(result.current.instanceCount).toBe(5);
      expect(result.current.projectInstanceTotal).toEqual({ total: 538.9 });
      // Most expensive first, as the server sorts them
      expect(names(result.current.projectBuckets))
        .toEqual(['assets-example-com', 'archives-2025', 'old-exports', 'logs-empty']);
      expect(names(result.current.projectVolumes)).toEqual([
        'db-data', 'web-shared', 'Disques supplémentaires à bhs5 de type classic', 'old-backup',
      ]);
      expect(names(result.current.projectSnapshots))
        .toEqual(['db-1-before-upgrade', 'web-1-golden']);
      expect(result.current.projectSavingsPlans.map(({ id }) => id))
        .toEqual(['savings-plan-b3-8-web', 'savings-plan-c3-4-legacy']);
      // Every region, those where the project runs nothing too
      expect(result.current.projectQuotas.map(({ region }) => region))
        .toEqual(['BHS5', 'GRA11', 'SBG5']);
    });

    it('are cached under the name of their query, their project and their month', async () => {
      const { keysOf } = await renderTabHook(usePublicCloudTab,
        { ...onTheTab, selectedProject: production });

      expect(keysOf('projectConsumption')).toEqual([['projectConsumption', 'project-production']]);
      expect(keysOf('projectQuotas')).toEqual([['projectQuotas', 'project-production']]);
      expect(keysOf('projectInstances'))
        .toEqual([['projectInstances', 'project-production', '2026-09-01', '2026-09-30']]);
      expect(keysOf('projectInstanceTotal'))
        .toEqual([['projectInstanceTotal', 'project-production', '2026-09-01', '2026-09-30']]);
      expect(keysOf('projectBuckets'))
        .toEqual([['projectBuckets', 'project-production', '2026-09-01', '2026-09-30']]);
      expect(keysOf('projectVolumes'))
        .toEqual([['projectVolumes', 'project-production', '2026-09-01', '2026-09-30']]);
      expect(keysOf('projectSnapshots'))
        .toEqual([['projectSnapshots', 'project-production', '2026-09-01', '2026-09-30']]);
      expect(keysOf('projectSavingsPlans'))
        .toEqual([['projectSavingsPlans', 'project-production', '2026-09-01', '2026-09-30']]);
      // The projects and the figures of the month, whatever the project
      expect(keysOf('projectsEnriched')).toEqual([['projectsEnriched']]);
      expect(keysOf('publicCloudStats'))
        .toEqual([['publicCloudStats', '2026-09-01', '2026-09-30']]);
    });

    it('follow the selected project', async () => {
      const { result, rerender, keysOf } = await renderTabHook(usePublicCloudTab,
        { ...onTheTab, selectedProject: production });

      await rerender({ ...onTheTab, selectedProject: staging });

      expect(api.fetchProjectConsumption).toHaveBeenCalledWith('project-staging');
      expect(api.fetchProjectInstances)
        .toHaveBeenCalledWith('project-staging', '2026-09-01', '2026-09-30');
      expect(consumption(result.current.projectConsumption)).toEqual([['instance', 52.35]]);
      // Its instances are gone: only their bill lines are left
      expect(instances(result.current.projectInstances)).toEqual([['unallocated', 180]]);
      expect(result.current.instanceCount).toBe(0);
      expect(result.current.projectInstanceTotal).toEqual({ total: 180 });
      expect(result.current.projectBuckets).toEqual([]);
      expect(result.current.projectVolumes).toEqual([]);
      expect(result.current.projectSnapshots).toEqual([]);
      expect(result.current.projectSavingsPlans).toEqual([]);
      expect(result.current.projectQuotas.map(({ region }) => region)).toEqual(['GRA11']);
      // Each project keeps its own answers
      expect(keysOf('projectInstances')).toEqual([
        ['projectInstances', 'project-production', '2026-09-01', '2026-09-30'],
        ['projectInstances', 'project-staging', '2026-09-01', '2026-09-30'],
      ]);
    });

    it('are left out again once the project is closed', async () => {
      const { result, rerender } = await renderTabHook(usePublicCloudTab,
        { ...onTheTab, selectedProject: production });

      await rerender(onTheTab);

      expect(result.current.projectConsumption).toEqual([]);
      expect(result.current.projectInstances).toEqual([]);
      expect(result.current.instanceCount).toBe(0);
      expect(result.current.projectInstanceTotal).toBeUndefined();
      expect(result.current.projectBuckets).toEqual([]);
      expect(result.current.projectQuotas).toEqual([]);
    });

    it('follow the selected month, but for what the project consumed and its quotas',
      async () => {
        const { result, rerender, keysOf } = await renderTabHook(usePublicCloudTab,
          { ...onTheTab, selectedProject: production });

        await rerender({ ...onTheTab, selectedMonth: august, selectedProject: production });

        expect(api.fetchProjectInstances)
          .toHaveBeenCalledWith('project-production', '2026-08-01', '2026-08-31');
        expect(instances(result.current.projectInstances)).toEqual([
          ['batch-1', 18.6], ['db-1', 64], ['inference-1', 310], ['web-1', 24], ['web-2', 24],
        ]);
        expect(result.current.instanceCount).toBe(5);
        expect(result.current.projectInstanceTotal).toEqual({ total: 440.6 });
        // No bucket billed in August
        expect(result.current.projectBuckets).toEqual([]);
        // The same answers as in September
        expect(keysOf('projectConsumption'))
          .toEqual([['projectConsumption', 'project-production']]);
        expect(keysOf('projectQuotas')).toEqual([['projectQuotas', 'project-production']]);
        expect(result.current.projectConsumption).toHaveLength(8);
        expect(result.current.projectQuotas).toHaveLength(3);
      });

    it('wait for a month for what is billed in it, not for the rest', async () => {
      const { result, queryClient } = await renderTabHook(usePublicCloudTab,
        { ...onTheTab, selectedMonth: null, selectedProject: production });

      expect(made(PROJECT_REQUESTS))
        .toEqual(['fetchProjectConsumption', 'fetchProjectQuotas', 'fetchProjectInstances']);
      // Without a month, the instances come without their costs
      expect(api.fetchProjectInstances)
        .toHaveBeenCalledWith('project-production', undefined, undefined);
      for (const key of [
        ['projectInstanceTotal', 'project-production', undefined, undefined],
        ['projectBuckets', 'project-production', undefined, undefined],
        ['projectVolumes', 'project-production', undefined, undefined],
        ['projectSnapshots', 'project-production', undefined, undefined],
        ['projectSavingsPlans', 'project-production', undefined, undefined],
      ]) {
        expect(queryClient.getQueryState(key), key[0]).toMatchObject(WAITING);
      }
      expect(result.current.projectInstanceTotal).toBeUndefined();
    });
  });

  it('opens each "show all" modal on its own, and keeps it when another tab opens', async () => {
    const { result, rerender } = await renderTabHook(usePublicCloudTab,
      { ...onTheTab, selectedProject: production });
    expect(openModals(result.current)).toEqual([]);

    act(() => result.current.setShowAllVolumes(true));
    expect(openModals(result.current)).toEqual(['volumes']);
    await rerender({ ...onTheTab, activeTab: 'overview', selectedProject: production });

    expect(openModals(result.current)).toEqual(['volumes']);
  });
});
