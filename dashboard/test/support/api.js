import { vi } from 'vitest';

// Stand-in for src/services/api.js, the only module of the page the tests
// replace. setup.js installs it for every test file, and renderDashboard()
// makes it answer from a dataset (see fixtures/account.js).

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
const emptyAnswers = {
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

// Answers that read the entry of a key in the dataset: all of it, the part
// for the period of the request, or the part for its project and period.
// Without one, the empty answer.
const entry = (key, empty) => (data) => data[key] ?? empty();
const entryForPeriod = (key, empty) => (data, from, to) =>
  data[key]?.[periodKey(from, to)] ?? empty(from, to);
const entryForProject = (key, empty) => (data, projectId, from, to) =>
  data[key]?.[projectId]?.[periodKey(from, to)] ?? empty();

// Every function of src/services/api.js, with how it answers:
// (dataset, ...arguments of the call) => answer
const answers = {
  fetchMonths: entry('months', emptyAnswers.list),
  fetchSummary: entryForPeriod('summary', emptyAnswers.summary),
  fetchProjectsEnriched: entry('projectsEnriched', emptyAnswers.list),
  fetchByProject: entryForPeriod('byProject', emptyAnswers.list),
  fetchByService: entryForPeriod('byService', emptyAnswers.list),
  // Trends: by the month they end on, then by their number of months
  fetchMonthlyTrend: (data, months, end) =>
    data.monthlyTrend?.[end]?.[months] ?? emptyAnswers.list(),
  fetchMonthlyTrendByCategory: (data, months, end) =>
    data.monthlyTrendByCategory?.[end]?.[months] ?? emptyAnswers.trendByCategory(),
  fetchImportStatus: entry('importStatus', emptyAnswers.importStatus),
  triggerImport: () => ({ started: true }),
  fetchConfig: entry('config', emptyAnswers.config),
  fetchUser: entry('user', emptyAnswers.user),
  fetchConsumptionCurrent: entry('consumptionCurrent', emptyAnswers.consumptionCurrent),
  fetchConsumptionForecast: entry('consumptionForecast', emptyAnswers.consumptionForecast),
  fetchInventoryServers: entry('inventoryServers', emptyAnswers.list),
  fetchInventoryVps: entry('inventoryVps', emptyAnswers.list),
  fetchInventoryStorage: entry('inventoryStorage', emptyAnswers.list),
  fetchExpiringServices: entry('expiringServices', emptyAnswers.list),
  fetchByResourceType: entryForPeriod('byResourceType', emptyAnswers.list),
  fetchResourceTypeDetails: (data, type, from, to) =>
    data.resourceTypeDetails?.[type]?.[periodKey(from, to)] ?? emptyAnswers.list(),
  fetchProjectConsumption: entryForProject('projectConsumption', emptyAnswers.list),
  fetchProjectInstances: entryForProject('projectInstances', emptyAnswers.list),
  fetchProjectVolumes: entryForProject('projectVolumes', emptyAnswers.list),
  fetchProjectSnapshots: entryForProject('projectSnapshots', emptyAnswers.list),
  fetchProjectSavingsPlans: entryForProject('projectSavingsPlans', emptyAnswers.list),
  fetchWebCloudSummary: entryForPeriod('webCloudSummary', emptyAnswers.webCloudSummary),
  fetchWebCloudItems: entryForPeriod('webCloudItems', emptyAnswers.list),
  fetchProjectQuotas: (data, projectId) => data.projectQuotas?.[projectId] ?? emptyAnswers.list(),
  fetchProjectBuckets: entryForProject('projectBuckets', emptyAnswers.list),
  fetchProjectInstanceTotal: entryForProject('projectInstanceTotal', emptyAnswers.instanceTotal),
  fetchGpuSummary: entryForPeriod('gpuSummary', emptyAnswers.gpuSummary),
  fetchPublicCloudStats: entryForPeriod('publicCloudStats', emptyAnswers.publicCloudStats),
  fetchBackupStats: entryForPeriod('backupStats', emptyAnswers.backupStats),
};

// One mock per function: what setup.js hands over to the page
export const api = Object.fromEntries(Object.keys(answers).map((name) => [name, vi.fn()]));

// Makes every function answer from the dataset. Called again, it changes what
// the server says from then on.
export function serve(data) {
  for (const [name, answer] of Object.entries(answers)) {
    api[name].mockImplementation(async (...args) => answer(data, ...args));
  }
}
