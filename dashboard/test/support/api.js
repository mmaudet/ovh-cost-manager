import { vi } from 'vitest';
import { shiftMonths } from '../../src/utils/monthWindow.js';

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
  config: () => ({ budget: 50000, currency: 'EUR', importEnabled: true }),
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
    other: { total: 0, products: [] },
    credits: { total: 0 },
    aiml: { count: 0, total: 0 },
    loadBalancers: { count: 0, total: 0 },
  }),
  backupStats: () => ({ vms: { count: 0, total: 0 }, enterprise: { count: 0, total: 0 } }),
  // No service of the Veeam backups over the period (#197)
  backupServices: () => ({ vms: [], enterprise: [] }),
  // No AI Endpoints model over the period (#193), nor any month of them (#196)
  aiEndpoints: () => ({ total: 0, models: [], monthlyTrend: [] }),
  // No Logs Data Platform charge that costs anything over the period (#247)
  logsDataPlatform: () => ({ total: 0, charges: [] }),
  // Nothing billed to the project over the period (#181)
  projectProducts: () => ({ total: 0, products: [], credits: 0 }),
  // No carbon footprint for any of the 12 months that end on a month (#154)
  carbonTrend: (end) => Array.from({ length: 12 }, (_, index) => ({
    month: shiftMonths(end, index - 11).slice(0, 7), footprint: null, coveredShare: null,
  })),
  // No line of the month's carbon footprint (#155)
  carbonByServer: (month) => ({ month, lines: [], coveredCost: 0, coveredShare: null }),
  // No carbon footprint for the month (#147), nor for any other (#152), and for all accounts,
  // none to name without one (#153)
  carbonFootprint: (month, account) => ({
    month, footprint: null, latestMonth: null,
    accountsWithoutFootprint: account === null ? [] : null,
  }),
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

// The value of the account parameter that selects the Unknown account, which
// the server accepts whether the accounts route lists it or not
const UNKNOWN_ACCOUNT = 'unknown';

// What the server answers to an account it does not know, as axios rejects it
// (see server/account-parameter.js)
const accountRefusal = () => Object.assign(new Error('Request failed with status code 400'), {
  response: {
    status: 400,
    data: {
      error: "Invalid 'account' parameter: expected the NIC handle of an account, or unknown",
    },
  },
});

// The dataset that answers a request (#115): the dataset itself when the
// request names no account, for all accounts, or else what it holds for that
// account under `ofAccount`, by its id, nothing when it holds nothing (see
// fixtures/accounts.js). As the server, it refuses an account that the
// accounts route does not list, but the Unknown account.
const ofAccount = (data, account = null) => {
  if (account === null) return data;
  const listed = (data.accounts ?? []).some((entry) => entry.nic === account);
  if (account !== UNKNOWN_ACCOUNT && !listed) throw accountRefusal();
  return data.ofAccount?.[account] ?? {};
};

// Answers that read the entry of a key for the period of the request, in the
// dataset that answers for the account it names, the last argument
const entryForPeriodOfAccount = (key, empty) => (data, from, to, account) =>
  entryForPeriod(key, empty)(ofAccount(data, account), from, to);

// The key of the entry that answers a request that may ask for the projected
// cost of the month in progress, with { projected: true } after its other
// arguments (#217, #218, #219): the entry of its own key while it does, such
// as projectedSummary for summary
const keyAnswering = (key, projectedKey, { projected = false } = {}) => (
  projected ? projectedKey : key
);

// Answers that read the entry of such a request for its period: of all
// accounts, as the lists by account ask for them, or of the account that it
// names, the last argument before { projected }
const projectableEntryForPeriod = (key, projectedKey, empty) => (data, from, to, options) =>
  entryForPeriod(keyAnswering(key, projectedKey, options), empty)(data, from, to);
const projectableEntryForPeriodOfAccount = (key, projectedKey, empty) => (
  data, from, to, account, options,
) => projectableEntryForPeriod(key, projectedKey, empty)(
  ofAccount(data, account), from, to, options,
);

// Every function of src/services/api.js, with how it answers:
// (dataset, ...arguments of the call) => answer
const answers = {
  fetchAccounts: entry('accounts', emptyAnswers.list),
  // The months list and the summaries follow the account the page selects
  fetchMonths: (data, account) => entry('months', emptyAnswers.list)(ofAccount(data, account)),
  // Asked with the projection of the month in progress, the summaries, the costs by service type
  // and by resource type, the services of a resource type and the Veeam backups and their
  // services answer from their own entries (#218), keyed as the others
  fetchSummary: projectableEntryForPeriodOfAccount(
    'summary', 'projectedSummary', emptyAnswers.summary,
  ),
  // So do the Public Cloud projects and figures (#121), not the resources of a project
  fetchProjectsEnriched: (data, account) =>
    entry('projectsEnriched', emptyAnswers.list)(ofAccount(data, account)),
  // The Overview's figures follow it too (#118). Asked with the projection of the month in
  // progress, the costs by project answer from their own entries too (#219).
  fetchByProject: projectableEntryForPeriodOfAccount(
    'byProject', 'projectedByProject', emptyAnswers.list,
  ),
  fetchByService: projectableEntryForPeriodOfAccount(
    'byService', 'projectedByService', emptyAnswers.list,
  ),
  // And its lists by account, for all accounts only (#118), the costs by project from their own
  // entry with the projection (#219)
  fetchProjectsByAccount: projectableEntryForPeriod(
    'projectsByAccount', 'projectedProjectsByAccount', emptyAnswers.list,
  ),
  fetchGpuProjectsByAccount: entryForPeriod('gpuProjectsByAccount', emptyAnswers.list),
  // Trends: by the month they end on, then by their number of months, and those of the
  // account the page selects (#120). Asked with the projection of the month in progress, those of
  // its own entries (#217): projectedMonthlyTrend and projectedMonthlyTrendByResourceType.
  fetchMonthlyTrend: (data, months, end, account, options) =>
    ofAccount(data, account)[keyAnswering('monthlyTrend', 'projectedMonthlyTrend', options)]
      ?.[end]?.[months] ?? emptyAnswers.list(),
  fetchMonthlyTrendByCategory: (data, months, end, account, options) =>
    ofAccount(data, account)[keyAnswering(
      'monthlyTrendByCategory', 'projectedMonthlyTrendByResourceType', options,
    )]?.[end]?.[months] ?? emptyAnswers.trendByCategory(),
  fetchImportStatus: entry('importStatus', emptyAnswers.importStatus),
  triggerImport: () => ({ started: true }),
  fetchConfig: entry('config', emptyAnswers.config),
  fetchUser: entry('user', emptyAnswers.user),
  // The current month's consumption and forecast of the account the page selects (#116)
  fetchConsumptionCurrent: (data, account) =>
    entry('consumptionCurrent', emptyAnswers.consumptionCurrent)(ofAccount(data, account)),
  fetchConsumptionForecast: (data, account) =>
    entry('consumptionForecast', emptyAnswers.consumptionForecast)(ofAccount(data, account)),
  // The inventory follows the account the page selects (#123)
  fetchInventoryServers: (data, account) =>
    entry('inventoryServers', emptyAnswers.list)(ofAccount(data, account)),
  fetchInventoryVps: (data, account) =>
    entry('inventoryVps', emptyAnswers.list)(ofAccount(data, account)),
  fetchInventoryStorage: (data, account) =>
    entry('inventoryStorage', emptyAnswers.list)(ofAccount(data, account)),
  // And so do the services about to expire, over the days of the request
  fetchExpiringServices: (data, days, account) =>
    entry('expiringServices', emptyAnswers.list)(ofAccount(data, account)),
  fetchByResourceType: projectableEntryForPeriodOfAccount(
    'byResourceType', 'projectedByResourceType', emptyAnswers.list,
  ),
  // So do the bill lines of a resource type, by type and period (#123)
  fetchResourceTypeDetails: (data, type, from, to, account, options) =>
    ofAccount(data, account)[keyAnswering(
      'resourceTypeDetails', 'projectedResourceTypeDetails', options,
    )]?.[type]?.[periodKey(from, to)] ?? emptyAnswers.list(),
  // And those by account, for all accounts only (#123)
  fetchResourceTypeDetailsByAccount: (data, type, from, to, options) =>
    data[keyAnswering(
      'resourceTypeDetailsByAccount', 'projectedResourceTypeDetailsByAccount', options,
    )]?.[type]?.[periodKey(from, to)] ?? emptyAnswers.list(),
  fetchProjectConsumption: entryForProject('projectConsumption', emptyAnswers.list),
  fetchProjectInstances: entryForProject('projectInstances', emptyAnswers.list),
  fetchProjectVolumes: entryForProject('projectVolumes', emptyAnswers.list),
  fetchProjectSnapshots: entryForProject('projectSnapshots', emptyAnswers.list),
  fetchProjectSavingsPlans: entryForProject('projectSavingsPlans', emptyAnswers.list),
  // The Web Cloud services follow the account the page selects (#122)
  fetchWebCloudSummary: entryForPeriodOfAccount('webCloudSummary', emptyAnswers.webCloudSummary),
  fetchWebCloudItems: entryForPeriodOfAccount('webCloudItems', emptyAnswers.list),
  fetchProjectQuotas: (data, projectId) => data.projectQuotas?.[projectId] ?? emptyAnswers.list(),
  fetchProjectBuckets: entryForProject('projectBuckets', emptyAnswers.list),
  fetchProjectOtherServices: entryForProject('projectOtherServices',
    () => ({ total: 0, products: [], credits: 0 })),
  // The products of a project from the bills of a period, of the account the page selects,
  // as the costs by project (#181); with the projection of the month in progress, from their own
  // entry, projectedProjectProducts (#219)
  fetchProjectProducts: (data, projectId, from, to, account, options) => entryForProject(
    keyAnswering('projectProducts', 'projectedProjectProducts', options),
    emptyAnswers.projectProducts,
  )(ofAccount(data, account), projectId, from, to),
  fetchProjectInstanceTotal: entryForProject('projectInstanceTotal', emptyAnswers.instanceTotal),
  // The GPU costs of a period, of the account the page selects (#120)
  fetchGpuSummary: entryForPeriodOfAccount('gpuSummary', emptyAnswers.gpuSummary),
  fetchPublicCloudStats: entryForPeriodOfAccount('publicCloudStats', emptyAnswers.publicCloudStats),
  // And its AI Endpoints models (#193)
  fetchAiEndpoints: entryForPeriodOfAccount('aiEndpoints', emptyAnswers.aiEndpoints),
  // The Logs Data Platform charges of a period, of the account the page selects (#247); with the
  // projection of the month in progress, from their own entry, projectedLogsDataPlatform (#248)
  fetchLogsDataPlatform: projectableEntryForPeriodOfAccount(
    'logsDataPlatform', 'projectedLogsDataPlatform', emptyAnswers.logsDataPlatform,
  ),
  // And the Veeam backups of a month, which the Compare and Backup tabs show (#119)
  fetchBackupStats: projectableEntryForPeriodOfAccount(
    'backupStats', 'projectedBackupStats', emptyAnswers.backupStats,
  ),
  // And their services, which the Compare tab's backup comparison unfolds into (#197), and
  // those by account, for all accounts only
  fetchBackupServices: projectableEntryForPeriodOfAccount(
    'backupServices', 'projectedBackupServices', emptyAnswers.backupServices,
  ),
  fetchBackupServicesByAccount: projectableEntryForPeriod(
    'backupServicesByAccount', 'projectedBackupServicesByAccount', emptyAnswers.backupServices,
  ),
  // The carbon footprint of a month, by that month, of the account the page selects (#147)
  fetchCarbonFootprint: (data, month, account) =>
    ofAccount(data, account).carbonFootprint?.[month]
      ?? emptyAnswers.carbonFootprint(month, account),
  // And that of the 12 months that end on a month, by that month (#154)
  fetchCarbonTrend: (data, end, account) =>
    ofAccount(data, account).carbonTrend?.[end] ?? emptyAnswers.carbonTrend(end),
  // And the lines of a month, by that month (#155)
  fetchCarbonByServer: (data, month, account) =>
    ofAccount(data, account).carbonByServer?.[month] ?? emptyAnswers.carbonByServer(month),
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

// Makes a function fail, or only its calls that picks() picks by their arguments,
// as a server that answers with an error would: the request rejects as axios
// rejects it. The other calls answer as before.
export function failFor(fn, picks = () => true) {
  const answer = fn.getMockImplementation();
  fn.mockImplementation(async (...args) => {
    if (picks(...args)) throw new Error('Request failed with status code 500');
    return answer(...args);
  });
}

// Holds back the answers of a function, or only those to the calls that picks()
// picks by their arguments, as a slow server would, until release() is called.
// Returns release.
export function holdBack(fn, picks = () => true) {
  const answer = fn.getMockImplementation();
  let release;
  const released = new Promise((resolve) => {
    release = resolve;
  });
  fn.mockImplementation(async (...args) => {
    if (picks(...args)) await released;
    return answer(...args);
  });
  return release;
}
