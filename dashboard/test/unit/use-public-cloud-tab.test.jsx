import { describe, it, expect } from 'vitest';
import { act } from '@testing-library/react';
import { usePublicCloudTab } from '../../src/tabs/usePublicCloudTab.js';
import { account } from '../fixtures/account.js';
import {
  lyonAccount, severalAccounts, severalAccountsWithAiEndpoints, unknownAccount, unnamedAccount,
} from '../fixtures/accounts.js';
import { months } from '../fixtures/calendar.js';
import { aiEndpoints } from '../fixtures/public-cloud.js';
import { api } from '../support/api.js';
import { renderTabHook, TAB_IDS, WAITING } from '../support/hooks.jsx';

// The state and data queries of the Public Cloud tab, as the dashboard shell sees them: what
// the hook requests and returns for the selected month, the active tab, the selected project
// and the account shown. The shell holds the project: the tab, the Overview and the logo set
// it. It holds the account too, which the header selects (#115): null for all accounts. And it
// tells whether the months of the account shown hold the month selected (#120).

const [september, august] = months;
// Projects as the Overview selects them: an id and a name
const production = { id: 'project-production', name: 'Production' };
const staging = { id: 'project-staging', name: 'Staging' };
// The tab open on September, no project open, all accounts shown, whose months hold September
const onTheTab = {
  selectedMonth: september, holdsSelectedMonth: true, activeTab: 'inventory',
  selectedProject: null, selectedAccount: null,
};
// No month selected yet, as the shell holds it until the months list loads
const noMonth = { selectedMonth: null, holdsSelectedMonth: false };

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
  'savings plans': tab.showAllSavingsPlans,
}).filter(([, open]) => open).map(([resources]) => resources);

describe('usePublicCloudTab', () => {
  it('returns what the tab and its modals read, and nothing else', async () => {
    const { result } = await renderTabHook(usePublicCloudTab,
      { ...onTheTab, selectedProject: production });

    // What the shell spreads over the tab and its modals: the sort order of its tables (#146),
    // the "show all" modals, closed, the projects and the figures of the month, the AI
    // Endpoints models of the month (#193), none in the synthetic account's figures, the open
    // project and its resources, whose lists the tests below read
    expect(result.current).toEqual({
      sortingOf: expect.any(Function),
      showAllBuckets: false,
      setShowAllBuckets: expect.any(Function),
      showAllInstances: false,
      setShowAllInstances: expect.any(Function),
      showAllVolumes: false,
      setShowAllVolumes: expect.any(Function),
      showAllSnapshots: false,
      setShowAllSnapshots: expect.any(Function),
      showAllSavingsPlans: false,
      setShowAllSavingsPlans: expect.any(Function),
      projectsEnriched: expect.any(Array),
      projectsLoaded: true,
      publicCloudStats: expect.any(Object),
      aiEndpoints: { total: 0, models: [] },
      openProject: production,
      projectConsumption: expect.any(Array),
      projectInstances: expect.any(Array),
      instanceCount: 5,
      projectInstanceTotal: { total: 538.9 },
      projectQuotas: expect.any(Array),
      projectBuckets: expect.any(Array),
      projectVolumes: expect.any(Array),
      projectSnapshots: expect.any(Array),
      projectSavingsPlans: expect.any(Array),
      projectOtherServices: {
        total: 40, products: [{ product: 'registry', total: 40 }], credits: 0,
      },
    });
  });

  describe('projects and figures of the month', () => {
    it.each(TAB_IDS.filter((tab) => tab !== 'inventory'))(
      'are left out while the %s tab is active',
      async (activeTab) => {
        const { result } = await renderTabHook(usePublicCloudTab, { ...onTheTab, activeTab });

        expect(api.fetchProjectsEnriched).not.toHaveBeenCalled();
        expect(api.fetchPublicCloudStats).not.toHaveBeenCalled();
        expect(result.current.projectsEnriched).toEqual([]);
        expect(result.current.projectsLoaded).toBe(false);
        expect(result.current.publicCloudStats).toBeUndefined();
      },
    );

    // Until then, the tab cannot tell which projects billed in the month the list lacks (#180)
    it('tell once the list of projects has loaded', async () => {
      const { result, rerender } = await renderTabHook(usePublicCloudTab,
        { ...onTheTab, activeTab: 'overview' });

      await rerender(onTheTab);

      expect(result.current.projectsLoaded).toBe(true);
    });

    it('tell that the list of projects has not loaded when it fails to', async () => {
      const { result, rerender } = await renderTabHook(usePublicCloudTab,
        { ...onTheTab, activeTab: 'overview' });
      api.fetchProjectsEnriched.mockRejectedValue(new Error('Request failed with status code 500'));

      await rerender(onTheTab);

      expect(result.current.projectsEnriched).toEqual([]);
      expect(result.current.projectsLoaded).toBe(false);
    });

    // As when the page asks for it again once an import is over: the list keeps the projects it
    // had, and so the tab those that it lacks
    it('keep telling that the list of projects has loaded when a later request for it fails',
      async () => {
        const { result, rerender, queryClient } = await renderTabHook(usePublicCloudTab, onTheTab);
        api.fetchProjectsEnriched.mockRejectedValue(
          new Error('Request failed with status code 500'),
        );

        await act(() => queryClient.invalidateQueries({ queryKey: ['projectsEnriched'] }));
        await rerender(onTheTab);

        expect(queryClient.getQueryState(['projectsEnriched']).status).toBe('error');
        expect(names(result.current.projectsEnriched))
          .toEqual(['Production', 'Staging', 'Sandbox']);
        expect(result.current.projectsLoaded).toBe(true);
      });

    it('are requested once the tab opens', async () => {
      const { result, rerender } = await renderTabHook(usePublicCloudTab,
        { ...onTheTab, activeTab: 'overview' });

      await rerender(onTheTab);

      // For all accounts
      expect(api.fetchProjectsEnriched).toHaveBeenCalledWith(null);
      expect(api.fetchPublicCloudStats).toHaveBeenCalledWith('2026-09-01', '2026-09-30', null);
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
        other: { total: 0, products: [] },
        credits: { total: 0 },
        aiml: { count: 0, total: 0 },
        loadBalancers: { count: 0, total: 0 },
      });
    });

    it('wait for a month for the figures, not for the projects', async () => {
      const { result, queryClient } = await renderTabHook(usePublicCloudTab,
        { ...onTheTab, ...noMonth });

      expect(names(result.current.projectsEnriched))
        .toEqual(['Production', 'Staging', 'Sandbox']);
      expect(api.fetchPublicCloudStats).not.toHaveBeenCalled();
      expect(queryClient.getQueryState(['publicCloudStats', undefined, undefined]))
        .toMatchObject(WAITING);
    });

    // While the months of the account just selected load, or when it lacks the month selected,
    // until the shell selects its latest month (#115): the figures of a month it lacks would
    // never show
    it('wait until the months of the account shown hold the month selected', async () => {
      const { result, queryClient } = await renderTabHook(usePublicCloudTab,
        { ...onTheTab, holdsSelectedMonth: false });

      expect(api.fetchProjectsEnriched).toHaveBeenCalledWith(null);
      expect(api.fetchPublicCloudStats).not.toHaveBeenCalled();
      expect(queryClient.getQueryState(['publicCloudStats', '2026-09-01', '2026-09-30']))
        .toMatchObject(WAITING);
      expect(result.current.publicCloudStats).toBeUndefined();
    });

    it('follow the selected month', async () => {
      const { result, rerender } = await renderTabHook(usePublicCloudTab, onTheTab);

      await rerender({ ...onTheTab, selectedMonth: august });

      expect(api.fetchPublicCloudStats).toHaveBeenCalledWith('2026-08-01', '2026-08-31', null);
      expect(result.current.publicCloudStats.instances).toEqual({ total: 590.6 });
      // The empty bucket was created in September
      expect(result.current.publicCloudStats.objectStorage).toEqual({ count: 2, total: 24.9 });
    });
  });

  // Several accounts in the instance (#121): see fixtures/accounts.js
  describe('projects and figures of the account shown', () => {
    const lyon = lyonAccount.id;

    it('are requested for the account shown, and cached under keys that name it', async () => {
      const { result, keysOf } = await renderTabHook(usePublicCloudTab,
        { ...onTheTab, selectedAccount: lyon }, severalAccounts);

      expect(api.fetchProjectsEnriched).toHaveBeenCalledWith(lyon);
      expect(api.fetchPublicCloudStats).toHaveBeenCalledWith('2026-09-01', '2026-09-30', lyon);
      expect(names(result.current.projectsEnriched)).toEqual(['Production']);
      expect(result.current.publicCloudStats.instances).toEqual({ total: 538.9 });
      expect(result.current.publicCloudStats.registry).toEqual({ count: 0, total: 0 });
      // The account after the other parts of the keys, which stay those of all accounts
      expect(keysOf('projectsEnriched')).toEqual([['projectsEnriched', lyon]]);
      expect(keysOf('publicCloudStats'))
        .toEqual([['publicCloudStats', '2026-09-01', '2026-09-30', lyon]]);
    });

    it('follow the account shown, the Unknown account too, and all accounts again', async () => {
      const { result, rerender } =
        await renderTabHook(usePublicCloudTab, onTheTab, severalAccounts);

      await rerender({ ...onTheTab, selectedAccount: unnamedAccount.id });

      expect(names(result.current.projectsEnriched)).toEqual(['Staging']);
      expect(result.current.publicCloudStats.instances).toEqual({ total: 180 });
      expect(result.current.publicCloudStats.registry).toEqual({ count: 1, total: 40 });

      await rerender({ ...onTheTab, selectedAccount: unknownAccount.id });

      expect(api.fetchProjectsEnriched).toHaveBeenCalledWith('unknown');
      expect(names(result.current.projectsEnriched)).toEqual(['Sandbox']);
      expect(result.current.publicCloudStats.instances).toEqual({ total: 0 });

      await rerender(onTheTab);

      expect(names(result.current.projectsEnriched))
        .toEqual(['Production', 'Staging', 'Sandbox']);
      expect(result.current.publicCloudStats.instances).toEqual({ total: 718.9 });
    });

    // An account selected on an earlier visit, until the accounts list tells whether the page
    // still offers it (useSelectedAccount())
    it('wait while the page does not know the account shown', async () => {
      const { result, queryClient } = await renderTabHook(usePublicCloudTab,
        { ...onTheTab, selectedAccount: undefined }, severalAccounts);

      expect(api.fetchProjectsEnriched).not.toHaveBeenCalled();
      expect(api.fetchPublicCloudStats).not.toHaveBeenCalled();
      expect(queryClient.getQueryState(['projectsEnriched', undefined])).toMatchObject(WAITING);
      expect(queryClient.getQueryState(
        ['publicCloudStats', '2026-09-01', '2026-09-30', undefined],
      )).toMatchObject(WAITING);
      expect(result.current.projectsEnriched).toEqual([]);
      expect(result.current.projectsLoaded).toBe(false);
      expect(result.current.publicCloudStats).toBeUndefined();
    });

    // The project selected stays selected across account switches (#56), but it is open only
    // while the list of the account shown holds it: nothing of it is asked for otherwise
    it('leave out the project selected while the list of the account shown lacks it',
      async () => {
        const { result } = await renderTabHook(usePublicCloudTab,
          { ...onTheTab, selectedAccount: unnamedAccount.id, selectedProject: production },
          severalAccounts);

        expect(names(result.current.projectsEnriched)).toEqual(['Staging']);
        expect(result.current.openProject).toBeNull();
        expect(made(PROJECT_REQUESTS)).toEqual([]);
        expect(result.current.projectInstances).toEqual([]);
        expect(result.current.instanceCount).toBe(0);
      });

    it('open the project selected again with an account that lists it', async () => {
      const { result, rerender } = await renderTabHook(usePublicCloudTab,
        { ...onTheTab, selectedAccount: unnamedAccount.id, selectedProject: production },
        severalAccounts);

      await rerender({ ...onTheTab, selectedAccount: lyon, selectedProject: production });

      expect(result.current.openProject).toEqual(production);
      expect(api.fetchProjectInstances)
        .toHaveBeenCalledWith('project-production', '2026-09-01', '2026-09-30');
      expect(result.current.instanceCount).toBe(5);
    });

    // The list loads on the tab: the Overview opens the tab along with the project
    it('open no project before the list of the account shown loads', async () => {
      const { result } = await renderTabHook(usePublicCloudTab,
        { ...onTheTab, activeTab: 'overview', selectedProject: production }, severalAccounts);

      expect(api.fetchProjectsEnriched).not.toHaveBeenCalled();
      expect(result.current.openProject).toBeNull();
      expect(made(PROJECT_REQUESTS)).toEqual([]);
    });

    // A project belongs to one account: its resources are asked for by its id alone
    it('leave the account out of the resources of the open project', async () => {
      const { result, keysOf } = await renderTabHook(usePublicCloudTab,
        { ...onTheTab, selectedAccount: lyon, selectedProject: production }, severalAccounts);

      expect(api.fetchProjectConsumption).toHaveBeenCalledWith('project-production');
      expect(api.fetchProjectInstances)
        .toHaveBeenCalledWith('project-production', '2026-09-01', '2026-09-30');
      // Under no project while the list loaded: none was open then
      expect(keysOf('projectInstances')).toEqual([
        ['projectInstances', undefined, '2026-09-01', '2026-09-30'],
        ['projectInstances', 'project-production', '2026-09-01', '2026-09-30'],
      ]);
      expect(result.current.instanceCount).toBe(5);
    });
  });

  // The AI Endpoints models of the month (#193), as the figures of the month: see
  // fixtures/public-cloud.js and fixtures/accounts.js
  describe('AI Endpoints models of the month', () => {
    // The synthetic account, whose projects called AI Endpoints models
    const withAiEndpoints = { ...account, aiEndpoints };
    const lyon = lyonAccount.id;
    // The models of an answer, by name, in its order
    const models = ({ models: list }) => list.map(({ model }) => model);

    it.each(TAB_IDS.filter((tab) => tab !== 'inventory'))(
      'are left out while the %s tab is active',
      async (activeTab) => {
        const { result } = await renderTabHook(usePublicCloudTab,
          { ...onTheTab, activeTab }, withAiEndpoints);

        expect(api.fetchAiEndpoints).not.toHaveBeenCalled();
        expect(result.current.aiEndpoints).toBeUndefined();
      },
    );

    it('are requested once the tab opens, for all accounts', async () => {
      const { result, rerender } = await renderTabHook(usePublicCloudTab,
        { ...onTheTab, activeTab: 'overview' }, withAiEndpoints);

      await rerender(onTheTab);

      expect(api.fetchAiEndpoints).toHaveBeenCalledWith('2026-09-01', '2026-09-30', null);
      expect(result.current.aiEndpoints).toEqual(aiEndpoints['2026-09']);
    });

    it('wait for a month', async () => {
      const { result, queryClient } = await renderTabHook(usePublicCloudTab,
        { ...onTheTab, ...noMonth }, withAiEndpoints);

      expect(api.fetchAiEndpoints).not.toHaveBeenCalled();
      expect(queryClient.getQueryState(['aiEndpoints', undefined, undefined]))
        .toMatchObject(WAITING);
      expect(result.current.aiEndpoints).toBeUndefined();
    });

    // Those of a month that the account shown lacks would never show (#115, #120)
    it('wait until the months of the account shown hold the month selected', async () => {
      const { result, queryClient } = await renderTabHook(usePublicCloudTab,
        { ...onTheTab, holdsSelectedMonth: false }, withAiEndpoints);

      expect(api.fetchAiEndpoints).not.toHaveBeenCalled();
      expect(queryClient.getQueryState(['aiEndpoints', '2026-09-01', '2026-09-30']))
        .toMatchObject(WAITING);
      expect(result.current.aiEndpoints).toBeUndefined();
    });

    it('follow the selected month', async () => {
      const { result, rerender } = await renderTabHook(usePublicCloudTab,
        onTheTab, withAiEndpoints);

      await rerender({ ...onTheTab, selectedMonth: august });

      expect(api.fetchAiEndpoints).toHaveBeenCalledWith('2026-08-01', '2026-08-31', null);
      expect(result.current.aiEndpoints).toEqual(aiEndpoints['2026-08']);
    });

    it('are requested for the account shown, and cached under keys that name it', async () => {
      const { result, keysOf } = await renderTabHook(usePublicCloudTab,
        { ...onTheTab, selectedAccount: lyon }, severalAccountsWithAiEndpoints);

      expect(api.fetchAiEndpoints).toHaveBeenCalledWith('2026-09-01', '2026-09-30', lyon);
      expect(models(result.current.aiEndpoints)).toEqual([
        'gpt-oss-120b', 'gpt-oss-20b', 'bge-m3', 'Mistral-7B-Instruct-v0.3',
      ]);
      // The account after the other parts of the key, which stay those of all accounts
      expect(keysOf('aiEndpoints')).toEqual([['aiEndpoints', '2026-09-01', '2026-09-30', lyon]]);
    });

    it('follow the account shown, the Unknown account too, and all accounts again', async () => {
      const { result, rerender } = await renderTabHook(usePublicCloudTab,
        onTheTab, severalAccountsWithAiEndpoints);

      await rerender({ ...onTheTab, selectedAccount: unnamedAccount.id });

      expect(models(result.current.aiEndpoints))
        .toEqual(['whisper-large-v3', 'stable-diffusion-xl-base-v10']);

      await rerender({ ...onTheTab, selectedAccount: unknownAccount.id });

      expect(api.fetchAiEndpoints).toHaveBeenCalledWith('2026-09-01', '2026-09-30', 'unknown');
      expect(result.current.aiEndpoints).toEqual({ total: 0, models: [] });

      await rerender(onTheTab);

      expect(result.current.aiEndpoints).toEqual(aiEndpoints['2026-09']);
    });

    // An account selected on an earlier visit, until the accounts list tells whether the page
    // still offers it (useSelectedAccount())
    it('wait while the page does not know the account shown', async () => {
      const { result, queryClient } = await renderTabHook(usePublicCloudTab,
        { ...onTheTab, selectedAccount: undefined }, severalAccountsWithAiEndpoints);

      expect(api.fetchAiEndpoints).not.toHaveBeenCalled();
      expect(queryClient.getQueryState(
        ['aiEndpoints', '2026-09-01', '2026-09-30', undefined],
      )).toMatchObject(WAITING);
      expect(result.current.aiEndpoints).toBeUndefined();
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
        ['projectOtherServices', undefined, '2026-09-01', '2026-09-30'],
      ]) {
        expect(queryClient.getQueryState(key), key[0]).toMatchObject(WAITING);
      }
      expect(result.current.projectInstances).toEqual([]);
      expect(result.current.instanceCount).toBe(0);
    });

    // The Overview opens a project and the tab at once, and a project stays open when the
    // user leaves the tab (#56), with the list of the account shown that holds it
    it.each(TAB_IDS)('are requested for the open project, and stay while the %s tab is active',
      async (activeTab) => {
        const { result, rerender } = await renderTabHook(usePublicCloudTab,
          { ...onTheTab, selectedProject: production });

        await rerender({ ...onTheTab, activeTab, selectedProject: production });

        expect(result.current.openProject).toEqual(production);
        expect(result.current.instanceCount).toBe(5);
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
        ['volume', 5.25], ['volume', 2.25], ['snapshot', 3.25], ['storage', 41],
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

      // Under no project first, while the list of the account shown loaded: until it holds
      // the project selected, none is open
      expect(keysOf('projectConsumption')).toEqual([
        ['projectConsumption', undefined],
        ['projectConsumption', 'project-production'],
      ]);
      expect(keysOf('projectQuotas')).toEqual([
        ['projectQuotas', undefined],
        ['projectQuotas', 'project-production'],
      ]);
      for (const name of [
        'projectInstances', 'projectInstanceTotal', 'projectBuckets', 'projectVolumes',
        'projectSnapshots', 'projectSavingsPlans', 'projectOtherServices',
      ]) {
        expect(keysOf(name), name).toEqual([
          [name, undefined, '2026-09-01', '2026-09-30'],
          [name, 'project-production', '2026-09-01', '2026-09-30'],
        ]);
      }
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
        ['projectInstances', undefined, '2026-09-01', '2026-09-30'],
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
        expect(keysOf('projectConsumption')).toEqual([
          ['projectConsumption', undefined], ['projectConsumption', 'project-production'],
        ]);
        expect(keysOf('projectQuotas'))
          .toEqual([['projectQuotas', undefined], ['projectQuotas', 'project-production']]);
        expect(result.current.projectConsumption).toHaveLength(8);
        expect(result.current.projectQuotas).toHaveLength(3);
      });

    it('wait for a month for what is billed in it, not for the rest', async () => {
      const { result, queryClient } = await renderTabHook(usePublicCloudTab,
        { ...onTheTab, ...noMonth, selectedProject: production });

      // The instances too, which come with their costs in the month (#71)
      expect(made(PROJECT_REQUESTS)).toEqual(['fetchProjectConsumption', 'fetchProjectQuotas']);
      expect(result.current.projectInstances).toEqual([]);
      expect(result.current.instanceCount).toBe(0);
      for (const key of [
        ['projectInstances', 'project-production', undefined, undefined],
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

    it('wait until the months of the account shown hold the month selected, but for the rest',
      async () => {
        const { result, queryClient } = await renderTabHook(usePublicCloudTab,
          { ...onTheTab, holdsSelectedMonth: false, selectedProject: production });

        expect(made(PROJECT_REQUESTS)).toEqual(['fetchProjectConsumption', 'fetchProjectQuotas']);
        for (const name of [
          'projectInstances', 'projectInstanceTotal', 'projectBuckets', 'projectVolumes',
          'projectSnapshots', 'projectSavingsPlans',
        ]) {
          expect(queryClient.getQueryState(
            [name, 'project-production', '2026-09-01', '2026-09-30'],
          ), name).toMatchObject(WAITING);
        }
        expect(result.current.projectInstances).toEqual([]);
      });
  });

  // Each panel of the open project opens its "show all" modal with a setter of its own
  it.each([
    ['buckets', 'setShowAllBuckets'],
    ['instances', 'setShowAllInstances'],
    ['volumes', 'setShowAllVolumes'],
    ['snapshots', 'setShowAllSnapshots'],
    ['savings plans', 'setShowAllSavingsPlans'],
  ])('opens the modal of the %s alone, keeps it open on another tab, and closes it',
    async (modal, setShowAll) => {
      const { result, rerender } = await renderTabHook(usePublicCloudTab,
        { ...onTheTab, selectedProject: production });
      expect(openModals(result.current)).toEqual([]);

      act(() => result.current[setShowAll](true));
      expect(openModals(result.current)).toEqual([modal]);
      await rerender({ ...onTheTab, activeTab: 'overview', selectedProject: production });
      expect(openModals(result.current)).toEqual([modal]);

      act(() => result.current[setShowAll](false));
      expect(openModals(result.current)).toEqual([]);
    });
});
