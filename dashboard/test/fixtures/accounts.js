import { account } from './account.js';
import { months } from './calendar.js';
import { publicCloudFigures } from './public-cloud.js';
import { trendsOf } from './trends.js';
import { webCloudOfSeveralAccounts } from './web-cloud.js';

// Several OVHcloud accounts in one instance (#110): the synthetic account of account.js, as
// the accounts that billed it. Their costs add up to its figures, which the page gets for all
// accounts. Every name, NIC handle and amount is made up.
//
// The accounts route lists them as it does since #114: with their id, the value of the
// account parameter, whether config.json still lists them, and which one is the Unknown
// account. What the page asks for with an account, such as its months list, its summaries,
// its Public Cloud (#121) and its Web Cloud services (#122), is under `ofAccount`, by the id
// of the account (see support/api.js). web-cloud.js gives the Web Cloud services for all
// accounts too.

const [september, august, july] = months;
// The Public Cloud projects of account.js
const [production, staging, sandbox] = account.projectsEnriched;

// A configured account, named in config.json
export const lyonAccount = {
  id: 'xx1111-ovh',
  nic: 'xx1111-ovh',
  name: 'Lyon subsidiary',
  currency: 'EUR',
  lastImport: { at: '2026-09-14 04:02:30', status: 'success', error: null },
  configured: true,
  unknown: false,
};

// A configured account without a name, which the route names by its NIC handle. Imported
// since August.
export const unnamedAccount = {
  id: 'yy2222-ovh',
  nic: 'yy2222-ovh',
  name: 'yy2222-ovh',
  currency: 'EUR',
  lastImport: { at: '2026-09-14 04:02:10', status: 'success', error: null },
  configured: true,
  unknown: false,
};

// An account removed from config.json after August: it keeps its data, no longer imported
export const removedAccount = {
  id: 'zz3333-ovh',
  nic: 'zz3333-ovh',
  name: 'zz3333-ovh',
  currency: 'EUR',
  lastImport: { at: '2026-08-31 04:01:00', status: 'success', error: null },
  configured: false,
  unknown: false,
};

// The Unknown account: bills imported before OCM told accounts apart, which no configured
// account claimed since
export const unknownAccount = {
  id: 'unknown',
  nic: null,
  name: null,
  currency: null,
  lastImport: null,
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

export const severalAccounts = {
  ...account,
  ...webCloudOfSeveralAccounts.all,
  accounts: [lyonAccount, unnamedAccount, removedAccount, unknownAccount],
  projectsEnriched: [lyonProduction, unnamedStaging, unknownSandbox],
  ofAccount: {
    [lyonAccount.id]: {
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
      // Its Production project has all the GPU costs of every account
      gpuSummary: { '2026-07/2026-09': account.gpuSummary['2026-07/2026-09'] },
      projectsEnriched: [lyonProduction],
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
    },
    [unnamedAccount.id]: {
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
      // Its Cloud total of September: the instances of Staging, and the registry
      publicCloudStats: {
        '2026-09': publicCloudFigures({
          instances: { total: 180 },
          registry: { count: 1, total: 40 },
        }),
      },
      ...webCloudOfSeveralAccounts.ofAccount[unnamedAccount.id],
    },
    [removedAccount.id]: {
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
    },
    [unknownAccount.id]: {
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
    },
  },
};
