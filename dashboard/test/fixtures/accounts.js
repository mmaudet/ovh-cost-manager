import { account, septemberInProgress } from './account.js';
import { months } from './calendar.js';
import { infrastructureOfSeveralAccounts } from './infrastructure.js';
import {
  aiEndpoints, aiEndpointsFigures, aiEndpointsOfMonth, publicCloudFigures,
} from './public-cloud.js';
import { trendsOf } from './trends.js';
import { webCloudOfSeveralAccounts } from './web-cloud.js';

// Several OVHcloud accounts in one instance (#110): the synthetic account of account.js, as
// the accounts that billed it. Their costs add up to its figures, which the page gets for all
// accounts. Every name, NIC handle and amount is made up.
//
// The accounts route lists them as it does since #114: with their id, the value of the
// account parameter, whether config.json still lists them, and which one is the Unknown
// account, since #124, when the last import of each that succeeded ended, and since #117, the
// budget of its own that its last import recorded, null for none. What the page asks for with
// an account, such as its months list, its summaries, its current consumption (#116), the
// figures of the months that the Compare tab compares (#119), its Public Cloud (#121), its
// Web Cloud services (#122) and its inventory (#123), is under `ofAccount`, by the id of the
// account (see support/api.js). web-cloud.js and infrastructure.js give the Web Cloud
// services and the inventory for all accounts too.

const [september, august, july] = months;
// The Public Cloud projects of account.js
const [production, staging, sandbox] = account.projectsEnriched;

// A configured account, named in config.json, the only one with a budget of its own
export const lyonAccount = {
  id: 'xx1111-ovh',
  nic: 'xx1111-ovh',
  name: 'Lyon subsidiary',
  budget: 1000,
  currency: 'EUR',
  lastImport: { at: '2026-09-14 04:02:30', status: 'success', error: null },
  lastSuccessAt: '2026-09-14 04:02:30',
  configured: true,
  unknown: false,
};

// A configured account without a name, which the route names by its NIC handle. Imported
// since August.
export const unnamedAccount = {
  id: 'yy2222-ovh',
  nic: 'yy2222-ovh',
  name: 'yy2222-ovh',
  budget: null,
  currency: 'EUR',
  lastImport: { at: '2026-09-14 04:02:10', status: 'success', error: null },
  lastSuccessAt: '2026-09-14 04:02:10',
  configured: true,
  unknown: false,
};

// An account removed from config.json after August: it keeps its data, no longer imported
export const removedAccount = {
  id: 'zz3333-ovh',
  nic: 'zz3333-ovh',
  name: 'zz3333-ovh',
  budget: null,
  currency: 'EUR',
  lastImport: { at: '2026-08-31 04:01:00', status: 'success', error: null },
  lastSuccessAt: '2026-08-31 04:01:00',
  configured: false,
  unknown: false,
};

// The Unknown account: bills imported before OCM told accounts apart, which no configured
// account claimed since
export const unknownAccount = {
  id: 'unknown',
  nic: null,
  name: null,
  budget: null,
  currency: null,
  lastImport: null,
  lastSuccessAt: null,
  configured: false,
  unknown: true,
};

// A month's summary, as /api/summary answers it
const summaryOf = ({ from, to }, figures) => ({ period: { from, to }, ...figures });

// The Public Cloud projects, each with the NIC handle of its account: Production is the Lyon
// subsidiary's, Staging the unnamed account's, and Sandbox, which no configured account
// claimed, the Unknown account's
const lyonProduction = { ...production, account: lyonAccount.nic };
const unnamedStaging = { ...staging, account: unnamedAccount.nic };
const unknownSandbox = { ...sandbox, account: null };

// The projects of account.js, and the account whose bills billed them
const accountOfProject = {
  'project-production': lyonAccount.nic,
  'project-staging': unnamedAccount.nic,
};
// The entries of a key of a dataset, keyed by period, each changed by a function
const mapPeriods = (entries, change) => Object.fromEntries(
  Object.entries(entries).map(([period, entry]) => [period, change(entry)]),
);
// The costs by project of account.js that an account billed
const projectsOf = ({ nic }) => mapPeriods(account.byProject, (projects) => projects.filter(
  (project) => accountOfProject[project.projectId] === nic,
));
// Projects with the account of each, as the routes list them by account (#118)
const withAccounts = (projects, idOf) => projects.map(
  (project) => ({ ...project, account: accountOfProject[idOf(project)] }),
);

// The costs by service type and by resource type of the accounts billed in a month, which add
// up to those of account.js: September's, and those of August and July that the Compare tab
// compares (#119)
const service = (name, value, color, detailsCount) => ({ name, value, color, detailsCount });
const resourceType = (name, type, color, value, detailsCount, serviceCount) => ({
  name, resource_type: type, color, value, detailsCount, serviceCount,
});
const publicCloud = (value, detailsCount) =>
  resourceType('Public Cloud', 'cloud_project', '#3b82f6', value, detailsCount, 1);
const domains = (value) => resourceType('Domains', 'domain', '#8b5cf6', value, 2, 1);
const dedicatedServers = (value) =>
  resourceType('Dedicated Servers', 'dedicated_server', '#ef4444', value, 1, 1);

// The current month's consumption and month-end forecast of an account that one Public Cloud
// project consumed in, as the consumption routes answer (#116): up to the 15th of September,
// as account.js, whose own add up those of its accounts, which cover the same 14 days
const consumptionOf = ({ current, forecast, progress }) => ({
  consumptionCurrent: {
    ...account.consumptionCurrent, current_total: current, project_count: 1,
  },
  consumptionForecast: {
    ...account.consumptionForecast, forecast_total: forecast, current_total: current, progress,
  },
});

export const severalAccounts = {
  ...account,
  ...webCloudOfSeveralAccounts.all,
  ...infrastructureOfSeveralAccounts.all,
  accounts: [lyonAccount, unnamedAccount, removedAccount, unknownAccount],
  projectsEnriched: [lyonProduction, unnamedStaging, unknownSandbox],
  // The carbon footprint of all accounts (#147): that of account.js, which the route gives with
  // the accounts that have none (#153). In August, Lyon, configured, and the removed account,
  // billed that month; in September, the configured accounts, as none has one. The Unknown
  // account never has one, and is never named.
  carbonFootprint: {
    '2026-09': {
      ...account.carbonFootprint['2026-09'],
      accountsWithoutFootprint: [lyonAccount.nic, unnamedAccount.nic],
    },
    '2026-08': {
      ...account.carbonFootprint['2026-08'],
      accountsWithoutFootprint: [lyonAccount.nic, removedAccount.nic],
    },
  },
  // August's lines of all accounts (#155): those of account.js, all of the unnamed account,
  // the only one with a footprint that month
  carbonByServer: {
    '2026-08': {
      ...account.carbonByServer['2026-08'],
      lines: account.carbonByServer['2026-08'].lines
        .map((line) => ({ ...line, account: unnamedAccount.nic })),
    },
  },
  // The projects of the breakdown by project and of the GPU costs, for all accounts, once for
  // each account that billed them, with that account: as the Overview asks for them when its
  // lists name the account of each project (#118)
  projectsByAccount: mapPeriods(account.byProject,
    (projects) => withAccounts(projects, (project) => project.projectId)),
  gpuProjectsByAccount: mapPeriods(account.gpuSummary,
    (gpu) => withAccounts(gpu.byProject, (project) => project.project_id)),
  // The services of the Veeam backups by account, for the lists that name the account of each
  // service (#197): every one of them the unnamed account's
  backupServicesByAccount: mapPeriods(account.backupServices, ({ vms, enterprise }) => {
    const billedToUnnamed = (service) => ({ ...service, account: unnamedAccount.nic });
    return { vms: vms.map(billedToUnnamed), enterprise: enterprise.map(billedToUnnamed) };
  }),
  ofAccount: {
    [lyonAccount.id]: {
      byService: {
        '2026-09': [
          service('Compute', 580.4, '#3b82f6', 15),
          service('Other', 160, '#6b7280', 8),
          service('Storage', 150, '#10b981', 6),
        ],
        '2026-08': [
          service('Compute', 450, '#3b82f6', 14),
          service('Storage', 102, '#10b981', 5),
          service('Other', 60, '#6b7280', 4),
        ],
      },
      byProject: projectsOf(lyonAccount),
      byResourceType: {
        '2026-09': [publicCloud(610.4, 30), dedicatedServers(270), domains(10)],
        '2026-08': [publicCloud(512, 26), dedicatedServers(70), domains(30)],
        '2026-07': [publicCloud(680, 23)],
      },
      // No Veeam backup
      // Its Production project has all the GPU costs of every account: those of the months
      // of the Overview, and of the Trends tab's 3 months up to September (#120)
      gpuSummary: {
        '2026-09': account.gpuSummary['2026-09'],
        '2026-08': account.gpuSummary['2026-08'],
        '2026-07/2026-09': account.gpuSummary['2026-07/2026-09'],
      },
      months: [september, august, july],
      summary: {
        '2026-09': summaryOf(september, {
          total: 890.4, cloudTotal: 610.4, nonCloudTotal: 280, dailyAverage: 29.68,
          billsCount: 2, projectsCount: 1, topProjects: [{ name: 'Production', value: 610.4 }],
        }),
        '2026-08': summaryOf(august, {
          total: 612, cloudTotal: 512, nonCloudTotal: 100, dailyAverage: 19.74,
          billsCount: 1, projectsCount: 1, topProjects: [{ name: 'Production', value: 512 }],
        }),
        '2026-07': summaryOf(july, {
          total: 680, cloudTotal: 680, nonCloudTotal: 0, dailyAverage: 21.94,
          billsCount: 1, projectsCount: 1, topProjects: [{ name: 'Production', value: 680 }],
        }),
      },
      // The Trends tab's, over the 3 months up to September that its months allow (#120)
      ...trendsOf('2026-07', '2026-09', {
        '2026-07': { cloud_project: 680 },
        '2026-08': { cloud_project: 512, dedicated_server: 70, domain: 30 },
        '2026-09': { cloud_project: 610.4, dedicated_server: 270, license: 10 },
      }),
      projectsEnriched: [lyonProduction],
      // What its bills charged its Production project, product by product (#181)
      projectProducts: { [production.id]: account.projectProducts[production.id] },
      // What its Production project consumed: 350 € over 14 days, 750 € over 30
      ...consumptionOf({ current: 350, forecast: 750, progress: 47 }),
      // Its Cloud total of September: every figure of all accounts but those of Staging
      publicCloudStats: {
        '2026-09': publicCloudFigures({
          instances: { total: 538.9 },
          volumes: { count: 3, total: 12.5 },
          snapshots: { count: 2, total: 6 },
          savingsPlans: { count: 2, total: 28 },
          objectStorage: { count: 3, total: 25 },
        }),
      },
      ...webCloudOfSeveralAccounts.ofAccount[lyonAccount.id],
      ...infrastructureOfSeveralAccounts.ofAccount[lyonAccount.id],
    },
    [unnamedAccount.id]: {
      byService: {
        '2026-09': [
          service('Compute', 220, '#3b82f6', 6),
          service('Storage', 100, '#10b981', 3),
          service('Other', 40, '#6b7280', 3),
        ],
        '2026-08': [
          service('Compute', 140, '#3b82f6', 4),
          service('Storage', 60, '#10b981', 2),
          service('Other', 30, '#6b7280', 3),
        ],
      },
      byProject: projectsOf(unnamedAccount),
      byResourceType: {
        '2026-09': [
          publicCloud(220, 11),
          resourceType('Backup', 'backup', '#059669', 90, 3, 3),
          domains(25),
          resourceType('Licenses', 'license', '#0891b2', 25, 1, 1),
        ],
        '2026-08': [publicCloud(190, 9), resourceType('Backup', 'backup', '#059669', 40, 2, 2)],
      },
      // Every Veeam backup of account.js, and their services (#197)
      backupStats: account.backupStats,
      backupServices: account.backupServices,
      // Its carbon footprint (#147): none yet in September, and August's, its latest, part of
      // account.js's (#152)
      carbonFootprint: {
        '2026-09': {
          month: '2026-09', footprint: null, latestMonth: '2026-08', accountsWithoutFootprint: null,
        },
        '2026-08': {
          month: '2026-08',
          footprint: {
            manufacturing: 800, electricity: 1500, operations: 300, total: 2600,
            marketBasedTotal: 2000,
          },
          latestMonth: '2026-08',
          accountsWithoutFootprint: null,
        },
      },
      // Its lines of August (#155): the server of account.js's
      carbonByServer: {
        '2026-08': {
          month: '2026-08',
          lines: [{
            type: 'BAREMETAL', name: 'advance-2', range: 'advance gen4', datacenter: 'GRA',
            serverDomain: 'ns1234567.ip-10-0-0.eu', unnamedServers: null, account: 'yy2222-ovh',
            footprint: 1500, cost: 3000, intensity: 0.5,
          }],
          // Of the 4,000 € of the month of use
          coveredCost: 3000,
          coveredShare: 0.75,
        },
      },
      // Imported since August, its 12 months up to August (#154)
      carbonTrend: {
        '2026-08': account.carbonTrend['2026-08'].map(({ month }) => ({
          month,
          footprint: month === '2026-08'
            ? { manufacturing: 800, electricity: 1500, operations: 300, total: 2600 }
            : null,
          coveredShare: month === '2026-08' ? 0.75 : null,
        })),
      },
      // No GPU
      months: [september, august],
      summary: {
        '2026-09': summaryOf(september, {
          total: 360, cloudTotal: 220, nonCloudTotal: 140, dailyAverage: 12,
          billsCount: 1, projectsCount: 1, topProjects: [{ name: 'Staging', value: 220 }],
        }),
        '2026-08': summaryOf(august, {
          total: 230, cloudTotal: 190, nonCloudTotal: 40, dailyAverage: 7.42,
          billsCount: 1, projectsCount: 1, topProjects: [{ name: 'Staging', value: 190 }],
        }),
      },
      // Over the 3 months up to September: July, before its first bill, at 0 €. No GPU.
      ...trendsOf('2026-07', '2026-09', {
        '2026-08': { cloud_project: 190, backup: 40 },
        '2026-09': { cloud_project: 220, backup: 90, domain: 35, license: 15 },
      }),
      projectsEnriched: [unnamedStaging],
      // What its bills charged its Staging project, product by product (#181)
      projectProducts: { [staging.id]: account.projectProducts[staging.id] },
      // What its Staging project consumed
      ...consumptionOf({ current: 52.35, forecast: 112.18, progress: 47 }),
      // Its Cloud total of September: the instances of Staging, and the registry
      publicCloudStats: {
        '2026-09': publicCloudFigures({
          instances: { total: 180 },
          registry: { count: 1, total: 40 },
        }),
      },
      ...webCloudOfSeveralAccounts.ofAccount[unnamedAccount.id],
      ...infrastructureOfSeveralAccounts.ofAccount[unnamedAccount.id],
    },
    [removedAccount.id]: {
      // Dedicated servers only
      byResourceType: {
        '2026-08': [dedicatedServers(200)],
        '2026-07': [dedicatedServers(180)],
      },
      months: [august, july],
      summary: {
        '2026-08': summaryOf(august, {
          total: 200, cloudTotal: 0, nonCloudTotal: 200, dailyAverage: 6.45,
          billsCount: 1, projectsCount: 0, topProjects: [],
        }),
        '2026-07': summaryOf(july, {
          total: 180, cloudTotal: 0, nonCloudTotal: 180, dailyAverage: 5.81,
          billsCount: 1, projectsCount: 0, topProjects: [],
        }),
      },
      // Over the 3 months up to August, its latest month
      ...trendsOf('2026-06', '2026-08', {
        '2026-07': { dedicated_server: 180 },
        '2026-08': { dedicated_server: 200 },
      }),
      ...webCloudOfSeveralAccounts.ofAccount[removedAccount.id],
      ...infrastructureOfSeveralAccounts.ofAccount[removedAccount.id],
    },
    [unknownAccount.id]: {
      byResourceType: { '2026-07': [dedicatedServers(90), domains(30)] },
      months: [july],
      summary: {
        '2026-07': summaryOf(july, {
          total: 120, cloudTotal: 0, nonCloudTotal: 120, dailyAverage: 3.87,
          billsCount: 1, projectsCount: 0, topProjects: [],
        }),
      },
      // Over the 3 months up to July, its only month
      ...trendsOf('2026-05', '2026-07', {
        '2026-07': { dedicated_server: 90, domain: 30 },
      }),
      // Never billed
      projectsEnriched: [unknownSandbox],
      ...webCloudOfSeveralAccounts.ofAccount[unknownAccount.id],
      ...infrastructureOfSeveralAccounts.ofAccount[unknownAccount.id],
    },
  },
};

// The accounts, with the AI Endpoints models that their projects called (#193), which
// severalAccounts leaves out, as account.js does (see public-cloud.js): all accounts', and by
// account, the Lyon subsidiary's projects called the language and embedding models in
// September, and two of them in August, the unnamed account's the speech-to-text and image
// models in September, and the Unknown account's none, in July, its only month. For a month,
// and for the 3 months up to September of the Trends tab (#196).
const lyonModelsInSeptember = [
  ['gpt-oss-120b', 48260000, 12480000, 17.46],
  ['gpt-oss-20b', 15500000, 4800000, 2.68],
  ['bge-m3', 30000000, null, 0.3],
  ['Mistral-7B-Instruct-v0.3', 45000, 12300, 0.01],
];
const unnamedModelsInSeptember = aiEndpointsOfMonth('2026-09', 0.37, [
  ['whisper-large-v3', null, null, 0.37],
  ['stable-diffusion-xl-base-v10', null, null, 0],
]);
export const severalAccountsWithAiEndpoints = {
  ...severalAccounts,
  aiEndpoints,
  ofAccount: {
    ...severalAccounts.ofAccount,
    [lyonAccount.id]: {
      ...severalAccounts.ofAccount[lyonAccount.id],
      aiEndpoints: {
        '2026-09': aiEndpointsOfMonth('2026-09', 20.45, lyonModelsInSeptember),
        '2026-07/2026-09': aiEndpointsFigures(21.92, [
          ['gpt-oss-120b', 48260000, 12480000, 17.46],
          ['gpt-oss-20b', 24500000, 6900000, 4.03],
          ['bge-m3', 42000000, null, 0.42],
          ['Mistral-7B-Instruct-v0.3', 45000, 12300, 0.01],
        ], [
          ['2026-08', [0, 1.35, 0.12, 0]],
          ['2026-09', [17.46, 2.68, 0.3, 0.01]],
        ]),
      },
    },
    [unnamedAccount.id]: {
      ...severalAccounts.ofAccount[unnamedAccount.id],
      aiEndpoints: {
        '2026-09': unnamedModelsInSeptember,
        // Its models of September alone
        '2026-07/2026-09': unnamedModelsInSeptember,
      },
    },
  },
};

// The accounts while Lyon, billed late, has not been billed yet in September for a recurring
// service (#216): September is in progress for Lyon, and so for all accounts, and complete for
// the others, whose bills of the month came in
export const lyonBilledLate = {
  ...severalAccounts,
  ...septemberInProgress,
  ofAccount: {
    ...severalAccounts.ofAccount,
    [lyonAccount.id]: { ...severalAccounts.ofAccount[lyonAccount.id], ...septemberInProgress },
  },
};
