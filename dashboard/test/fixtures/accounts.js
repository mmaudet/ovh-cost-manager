import { account } from './account.js';
import { months } from './calendar.js';

// Several OVHcloud accounts in one instance (#110): the synthetic account of account.js, as
// the accounts that billed it. Their costs add up to its figures, which the page gets for all
// accounts. Every name, NIC handle and amount is made up.
//
// The accounts route lists them as it does since #114: with their id, the value of the
// account parameter, whether config.json still lists them, and which one is the Unknown
// account. What the page asks for with an account, its months list and its summaries, is
// under `ofAccount`, by the id of the account (see support/api.js).

const [september, august, july] = months;

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

export const severalAccounts = {
  ...account,
  accounts: [lyonAccount, unnamedAccount, removedAccount, unknownAccount],
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
    },
    [unknownAccount.id]: {
      months: [july],
      summary: {
        '2026-07': summaryOf(july, {
          total: 120, cloudTotal: 0, nonCloudTotal: 120, dailyAverage: 3.87,
          billsCount: 1, projectsCount: 0, topProjects: [],
        }),
      },
    },
  },
};
