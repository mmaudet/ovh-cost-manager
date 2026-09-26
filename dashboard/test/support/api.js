import { vi } from 'vitest';

// Stand-in for src/services/api.js, the only module of the page the tests
// replace. Each test file installs it with:
//
//   vi.mock('../src/services/api.js', async () => (await import('./support/api.js')).api);
//
// and renderDashboard() makes it answer from a dataset (see fixtures/account.js).

export const api = {
  fetchMonths: vi.fn(),
  fetchSummary: vi.fn(),
  fetchProjects: vi.fn(),
  fetchProjectsEnriched: vi.fn(),
  fetchByProject: vi.fn(),
  fetchByService: vi.fn(),
  fetchDailyTrend: vi.fn(),
  fetchMonthlyTrend: vi.fn(),
  fetchMonthlyTrendByCategory: vi.fn(),
  fetchImportStatus: vi.fn(),
  triggerImport: vi.fn(),
  fetchConfig: vi.fn(),
  fetchUser: vi.fn(),
  fetchConsumptionCurrent: vi.fn(),
  fetchConsumptionForecast: vi.fn(),
  fetchConsumptionHistory: vi.fn(),
  fetchAccountBalance: vi.fn(),
  fetchAccountCredits: vi.fn(),
  fetchInventoryServers: vi.fn(),
  fetchInventoryVps: vi.fn(),
  fetchInventoryStorage: vi.fn(),
  fetchInventorySummary: vi.fn(),
  fetchExpiringServices: vi.fn(),
  fetchByResourceType: vi.fn(),
  fetchResourceTypeDetails: vi.fn(),
  fetchProjectConsumption: vi.fn(),
  fetchProjectInstances: vi.fn(),
  fetchProjectVolumes: vi.fn(),
  fetchProjectSnapshots: vi.fn(),
  fetchProjectSavingsPlans: vi.fn(),
  fetchWebCloudSummary: vi.fn(),
  fetchWebCloudItems: vi.fn(),
  fetchProjectQuotas: vi.fn(),
  fetchProjectBuckets: vi.fn(),
  fetchProjectInstanceTotal: vi.fn(),
  fetchGpuSummary: vi.fn(),
  fetchPublicCloudStats: vi.fn(),
  fetchBackupStats: vi.fn(),
};

// The period a request covers, as the fixtures key it:
//   ('2026-09-01', '2026-09-30') -> '2026-09'
//   ('2025-10-01', '2026-09-30') -> '2025-10/2026-09'
//   no dates                     -> 'all'
// Dates that do not span whole months get a key no fixture uses: a page that
// asks for the wrong period gets nothing.
export function periodKey(from, to) {
  if (!from && !to) return 'all';
  const first = from.slice(0, 7);
  const last = to.slice(0, 7);
  const [year, month] = last.split('-').map(Number);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (from !== `${first}-01` || to !== `${last}-${lastDay}`) return `${from}/${to}`;
  return first === last ? first : `${first}/${last}`;
}

// What the server answers when there is nothing to show
const nothing = {
  summary: (from, to) => ({
    period: { from, to },
    total: 0,
    cloudTotal: 0,
    nonCloudTotal: 0,
    dailyAverage: 0,
    billsCount: 0,
    projectsCount: 0,
    topProjects: [],
  }),
  trendByCategory: () => ({ categories: [], data: [] }),
  // No import yet: the server sends no "latest"
  importStatus: () => ({ running: false, history: [] }),
  config: () => ({ budget: 50000, currency: 'EUR' }),
  user: () => ({ id: null, name: 'Anonymous', email: null, authEnabled: false }),
  consumptionCurrent: () => ({ current_total: 0, currency: 'EUR' }),
  consumptionForecast: () => ({ forecast_total: 0, currency: 'EUR' }),
  accountBalance: () => ({ debt_balance: 0, credit_balance: 0, deposit_total: 0, currency: 'EUR' }),
  inventorySummary: () => ({
    servers: 0, vps: 0, storage: 0, cloud_projects: 0, total: 0, expiring_soon: 0,
  }),
  webCloudSummary: () => ({
    domain: { count: 0, total: 0 },
    dns_zone: { count: 0, total: 0 },
    hosting: { count: 0, total: 0 },
    email: { count: 0, total: 0 },
    option: { count: 0, total: 0 },
    total: 0,
  }),
  instanceTotal: () => ({ total: 0 }),
  gpuSummary: () => ({
    total: 0, project_count: 0, byModel: [], byProject: [], monthlyTrend: [], instances: [],
  }),
  publicCloudStats: () => ({
    kubernetes: { count: 0, total: 0 },
    instances: { total: 0 },
    volumes: { count: 0, total: 0 },
    snapshots: { count: 0, total: 0 },
    savingsPlans: { count: 0, total: 0 },
    objectStorage: { count: 0, total: 0 },
    registry: { count: 0, total: 0 },
    aiml: { count: 0, total: 0 },
    loadBalancers: { count: 0, total: 0 },
  }),
  backupStats: () => ({ vms: { count: 0, total: 0 }, enterprise: { count: 0, total: 0 } }),
  list: () => [],
};

// Makes every API function answer from the dataset.
export function serve(data) {
  const answer = (fn, respond) => fn.mockImplementation(async (...args) => respond(...args));
  const whole = (key, empty) => () => data[key] ?? empty();
  const perPeriod = (key, empty) => (from, to) =>
    data[key]?.[periodKey(from, to)] ?? empty(from, to);
  const perProject = (key, empty) => (projectId, from, to) =>
    data[key]?.[projectId]?.[periodKey(from, to)] ?? empty();

  answer(api.fetchMonths, whole('months', nothing.list));
  answer(api.fetchSummary, perPeriod('summary', nothing.summary));
  answer(api.fetchProjects, whole('projects', nothing.list));
  answer(api.fetchProjectsEnriched, whole('projectsEnriched', nothing.list));
  answer(api.fetchByProject, perPeriod('byProject', nothing.list));
  answer(api.fetchByService, perPeriod('byService', nothing.list));
  answer(api.fetchDailyTrend, perPeriod('dailyTrend', nothing.list));
  answer(api.fetchMonthlyTrend, (months) => data.monthlyTrend?.[months] ?? nothing.list());
  answer(api.fetchMonthlyTrendByCategory,
    (months) => data.monthlyTrendByCategory?.[months] ?? nothing.trendByCategory());
  answer(api.fetchImportStatus, whole('importStatus', nothing.importStatus));
  answer(api.triggerImport, () => ({ started: true }));
  answer(api.fetchConfig, whole('config', nothing.config));
  answer(api.fetchUser, whole('user', nothing.user));
  answer(api.fetchConsumptionCurrent, whole('consumptionCurrent', nothing.consumptionCurrent));
  answer(api.fetchConsumptionForecast, whole('consumptionForecast', nothing.consumptionForecast));
  answer(api.fetchConsumptionHistory, perPeriod('consumptionHistory', nothing.list));
  answer(api.fetchAccountBalance, whole('accountBalance', nothing.accountBalance));
  answer(api.fetchAccountCredits, whole('accountCredits', nothing.list));
  answer(api.fetchInventoryServers, whole('inventoryServers', nothing.list));
  answer(api.fetchInventoryVps, whole('inventoryVps', nothing.list));
  answer(api.fetchInventoryStorage, whole('inventoryStorage', nothing.list));
  answer(api.fetchInventorySummary, whole('inventorySummary', nothing.inventorySummary));
  answer(api.fetchExpiringServices, whole('expiringServices', nothing.list));
  answer(api.fetchByResourceType, perPeriod('byResourceType', nothing.list));
  answer(api.fetchResourceTypeDetails,
    (type, from, to) => data.resourceTypeDetails?.[type]?.[periodKey(from, to)] ?? nothing.list());
  answer(api.fetchProjectConsumption, perProject('projectConsumption', nothing.list));
  answer(api.fetchProjectInstances, perProject('projectInstances', nothing.list));
  answer(api.fetchProjectVolumes, perProject('projectVolumes', nothing.list));
  answer(api.fetchProjectSnapshots, perProject('projectSnapshots', nothing.list));
  answer(api.fetchProjectSavingsPlans, perProject('projectSavingsPlans', nothing.list));
  answer(api.fetchWebCloudSummary, perPeriod('webCloudSummary', nothing.webCloudSummary));
  answer(api.fetchWebCloudItems, perPeriod('webCloudItems', nothing.list));
  answer(api.fetchProjectQuotas, (projectId) => data.projectQuotas?.[projectId] ?? nothing.list());
  answer(api.fetchProjectBuckets, perProject('projectBuckets', nothing.list));
  answer(api.fetchProjectInstanceTotal, perProject('projectInstanceTotal', nothing.instanceTotal));
  answer(api.fetchGpuSummary, perPeriod('gpuSummary', nothing.gpuSummary));
  answer(api.fetchPublicCloudStats, perPeriod('publicCloudStats', nothing.publicCloudStats));
  answer(api.fetchBackupStats, perPeriod('backupStats', nothing.backupStats));
}
