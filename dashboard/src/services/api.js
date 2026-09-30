import axios from 'axios';
import { accountParams } from '../utils/accounts.js';

const API_BASE = '/api';

const api = axios.create({
  baseURL: API_BASE,
  timeout: 30000
});

// Handle 401 responses - redirect to login if OIDC is enabled
api.interceptors.response.use(
  response => response,
  error => {
    if (error.response?.status === 401) {
      const loginUrl = error.response.data?.loginUrl;
      if (loginUrl) {
        // Redirect to OIDC login with return URL
        window.location.href = `${loginUrl}?returnTo=${encodeURIComponent(window.location.pathname)}`;
        return new Promise(() => {}); // Never resolve
      }
    }
    return Promise.reject(error);
  }
);

// The accounts of the instance (#112), as the account selector offers them (#115)
export const fetchAccounts = async () => {
  const { data } = await api.get('/accounts');
  return data;
};

// The functions whose last argument is an account ask for its answer: the id of an account,
// the NIC handle of an account or `unknown` for the Unknown account, or null, by default, for
// all accounts (#115)

// The months billed to the account
export const fetchMonths = async (account = null) => {
  const { data } = await api.get('/months', { params: accountParams(account) });
  return data;
};

export const fetchSummary = async (from, to, account = null) => {
  const { data } = await api.get('/summary', { params: { from, to, ...accountParams(account) } });
  return data;
};

// The Public Cloud projects of the account, each with its account (#121)
export const fetchProjectsEnriched = async (account = null) => {
  const { data } = await api.get('/projects/enriched', { params: accountParams(account) });
  return data;
};

// The costs of each project billed to the account, once each
export const fetchByProject = async (from, to, account = null) => {
  const { data } = await api.get('/analysis/by-project', {
    params: { from, to, ...accountParams(account) },
  });
  return data;
};

// The lists of projects that name the account of each, for all accounts: each project once
// for each account whose bills billed it, with that account, rather than once. The costs by
// project, which the Overview's breakdown by project (#118) and the Compare tab's comparison
// by project (#119) show, and the GPU costs by project, which the Overview shows. The tabs
// ask for them through tabs/projectsByAccountQueries.js.
export const fetchProjectsByAccount = async (from, to) => {
  const { data } = await api.get('/analysis/by-project', {
    params: { from, to, byAccount: true },
  });
  return data;
};

export const fetchGpuProjectsByAccount = async (from, to) => {
  const { data } = await api.get('/gpu/summary', { params: { from, to, byAccount: true } });
  return data.byProject;
};

export const fetchByService = async (from, to, account = null) => {
  const { data } = await api.get('/analysis/by-service', {
    params: { from, to, ...accountParams(account) },
  });
  return data;
};

// The parameter that asks a route for the projected cost of the month in progress (#217): none
// unless asked, so that a request without it names nothing
const projectionParams = (projected) => (projected ? { projected: true } : {});

// Trends over `months` months that end on the `end` month, 'YYYY-MM', of the account. With
// `projected`, the month in progress at its projected cost, and each month's projected part
// (#217).
export const fetchMonthlyTrend = async (
  months, end, account = null, { projected = false } = {},
) => {
  const { data } = await api.get('/analysis/monthly-trend', {
    params: { months, end, ...accountParams(account), ...projectionParams(projected) },
  });
  return data;
};

export const fetchMonthlyTrendByCategory = async (
  months, end, account = null, { projected = false } = {},
) => {
  const { data } = await api.get('/analysis/monthly-trend-by-category', {
    params: { months, end, ...accountParams(account), ...projectionParams(projected) },
  });
  return data;
};

export const fetchImportStatus = async () => {
  const { data } = await api.get('/import/status');
  return data;
};

// Trigger a manual resync (differential import). Server caps this at once per hour.
export const triggerImport = async () => {
  const { data } = await api.post('/import/run');
  return data;
};

export const fetchConfig = async () => {
  const { data } = await api.get('/config');
  return data;
};

export const fetchUser = async () => {
  const { data } = await api.get('/user');
  return data;
};

// Phase 1: Consumption. The current month's consumption so far and its month-end forecast of
// the account, the sum of the accounts' for all accounts (#116)
export const fetchConsumptionCurrent = async (account = null) => {
  const { data } = await api.get('/consumption/current', { params: accountParams(account) });
  return data;
};

export const fetchConsumptionForecast = async (account = null) => {
  const { data } = await api.get('/consumption/forecast', { params: accountParams(account) });
  return data;
};

// Phase 3: Inventory. The services of the account, each with its account (#123).
export const fetchInventoryServers = async (account = null) => {
  const { data } = await api.get('/inventory/servers', { params: accountParams(account) });
  return data;
};

export const fetchInventoryVps = async (account = null) => {
  const { data } = await api.get('/inventory/vps', { params: accountParams(account) });
  return data;
};

export const fetchInventoryStorage = async (account = null) => {
  const { data } = await api.get('/inventory/storage', { params: accountParams(account) });
  return data;
};

// The services of the account that expire within `days` days, or already have (#123)
export const fetchExpiringServices = async (days = 30, account = null) => {
  const { data } = await api.get('/inventory/expiring', {
    params: { days, ...accountParams(account) },
  });
  return data;
};

export const fetchByResourceType = async (from, to, account = null) => {
  const { data } = await api.get('/analysis/by-resource-type', {
    params: { from, to, ...accountParams(account) },
  });
  return data;
};

// The bill lines of a resource type billed to the account, by service (#123), which the
// Infrastructure tab lists under its open resource type and the Compare tab under a row it
// unfolds (#192). The tabs ask for them through tabs/resourceTypeServicesQueries.js.
export const fetchResourceTypeDetails = async (type, from, to, account = null) => {
  const { data } = await api.get('/analysis/resource-type-details', {
    params: { type, from, to, ...accountParams(account) },
  });
  return data;
};

// The same for all accounts, for the list that names the account of each service (#123):
// each service once for each account whose bills billed it, with that account, rather than
// once. The tabs ask for them through tabs/resourceTypeServicesQueries.js too.
export const fetchResourceTypeDetailsByAccount = async (type, from, to) => {
  const { data } = await api.get('/analysis/resource-type-details', {
    params: { type, from, to, byAccount: true },
  });
  return data;
};

// Phase 4: Cloud project details
export const fetchProjectConsumption = async (projectId, from, to) => {
  const { data } = await api.get(`/projects/${projectId}/consumption`, { params: { from, to } });
  return data;
};

export const fetchProjectInstances = async (projectId, from, to) => {
  const { data } = await api.get(`/projects/${projectId}/instances`, { params: { from, to } });
  return data;
};

export const fetchProjectVolumes = async (projectId, from, to) => {
  const { data } = await api.get(`/projects/${projectId}/volumes`, { params: { from, to } });
  return data;
};

export const fetchProjectSnapshots = async (projectId, from, to) => {
  const { data } = await api.get(`/projects/${projectId}/snapshots`, { params: { from, to } });
  return data;
};

export const fetchProjectSavingsPlans = async (projectId, from, to) => {
  const { data } = await api.get(`/projects/${projectId}/savings-plans`, { params: { from, to } });
  return data;
};

// The Web Cloud services billed to the account (#122), and their count and cost by family
export const fetchWebCloudSummary = async (from, to, account = null) => {
  const { data } = await api.get('/web-cloud/summary', {
    params: { from, to, ...accountParams(account) },
  });
  return data;
};

export const fetchWebCloudItems = async (from, to, account = null) => {
  const { data } = await api.get('/web-cloud/items', {
    params: { from, to, ...accountParams(account) },
  });
  return data;
};

export const fetchProjectQuotas = async (projectId) => {
  const { data } = await api.get(`/projects/${projectId}/quotas`);
  return data;
};

export const fetchProjectBuckets = async (projectId, from, to) => {
  const { data } = await api.get(`/projects/${projectId}/buckets`, { params: { from, to } });
  return data;
};

// The products of a project over a period that its detail lists no section of its own for,
// its registry among them, and the credit that its bills used (#145)
export const fetchProjectOtherServices = async (projectId, from, to) => {
  const { data } = await api.get(`/projects/${projectId}/other-services`, { params: { from, to } });
  return data;
};

// Every product of a project over a period, from the bills of the account, and the credit
// that they used (#181): what the Compare tab compares for a project, month by month
export const fetchProjectProducts = async (projectId, from, to, account = null) => {
  const { data } = await api.get(`/projects/${projectId}/products`, {
    params: { from, to, ...accountParams(account) },
  });
  return data;
};

export const fetchProjectInstanceTotal = async (projectId, from, to) => {
  const { data } = await api.get(`/projects/${projectId}/instance-total`, { params: { from, to } });
  return data;
};

// GPU costs, of the account
export const fetchGpuSummary = async (from, to, account = null) => {
  const { data } = await api.get('/gpu/summary', {
    params: { from, to, ...accountParams(account) },
  });
  return data;
};

// Public Cloud stats (Kubernetes, S3, Registry, etc.) of the account (#121)
export const fetchPublicCloudStats = async (from, to, account = null) => {
  const { data } = await api.get('/analysis/public-cloud-stats', {
    params: { from, to, ...accountParams(account) },
  });
  return data;
};

/**
 * The AI Endpoints models that the bills of a period name (#193), the projects together, which
 * the Public Cloud tab lists for the month it shows, and their cost month by month, which the
 * Trends tab charts over its period (#196)
 * @param {string} from - The first day of the period, 'YYYY-MM-DD'
 * @param {string} to - Its last day
 * @param {?string} [account] - The account whose bills to read, as the functions above take
 *   it: null for all accounts
 * @returns {Promise<{ total: number, models: object[], monthlyTrend: object[] }>} What the
 *   models cost in all; each model's name, as the bills give it, its inputTokens and
 *   outputTokens, null when none of its lines counts them, and its cost, total, the most
 *   expensive first; and each month of the bills that name a model, the earliest first, with
 *   the costs of every model in it, 0 for one that it did not bill
 */
export const fetchAiEndpoints = async (from, to, account = null) => {
  const { data } = await api.get('/analysis/ai-endpoints', {
    params: { from, to, ...accountParams(account) },
  });
  return data;
};

/**
 * Backup stats (Veeam) of a month, for the Compare and Backup tabs (#119)
 * @param {string} from - The first day of the month, 'YYYY-MM-DD'
 * @param {string} to - Its last day
 * @param {?string} [account] - The account whose backups to ask for, as the functions above
 *   take it: null for all accounts
 * @returns {Promise<{ vms: object, enterprise: object }>} The number and cost of the Veeam
 *   VMs and of the Enterprise licences
 */
export const fetchBackupStats = async (from, to, account = null) => {
  const { data } = await api.get('/analysis/backup-stats', {
    params: { from, to, ...accountParams(account) },
  });
  return data;
};

/**
 * The services of the Veeam backups of a period, billed to the account (#197): the VMs backed
 * up and the Enterprise licences, which the Compare tab's backup comparison unfolds its rows
 * into, as the bill lines of a resource type by service give them
 * @param {string} from
 * @param {string} to
 * @param {?string} [account] - The account, null for all accounts
 * @returns {Promise<{ vms: object[], enterprise: object[] }>}
 */
export const fetchBackupServices = async (from, to, account = null) => {
  const { data } = await api.get('/analysis/backup-services', {
    params: { from, to, ...accountParams(account) },
  });
  return data;
};

// The same for all accounts, for the lists that name the account of each service: each
// service once for each account whose bills billed it, with that account, rather than once
export const fetchBackupServicesByAccount = async (from, to) => {
  const { data } = await api.get('/analysis/backup-services', {
    params: { from, to, byAccount: true },
  });
  return data;
};

/**
 * The carbon footprint of a month (#147): what OVHcloud's carbon calculator attributes to the
 * services, location-based, by emission source and in total, in kg CO2eq
 * @param {string} month - The month, 'YYYY-MM'
 * @param {?string} [account] - The account whose footprint to ask for, as the functions above
 *   take it: null for all accounts
 * @returns {Promise<{ month: string, footprint: ?object, latestMonth: ?string }>} The
 *   footprint's manufacturing, electricity, operations and total, and its market-based total
 *   (#152), null when the month has none; and the latest month that has one, null when none
 *   has
 */
export const fetchCarbonFootprint = async (month, account = null) => {
  const { data } = await api.get('/carbon/footprint', {
    params: { month, ...accountParams(account) },
  });
  return data;
};

/**
 * The carbon footprint of the 12 months that end on a month (#154), location-based
 * @param {string} end - The last month, 'YYYY-MM'
 * @param {?string} [account] - The account whose footprint to ask for, as the functions above
 *   take it: null for all accounts
 * @returns {Promise<{ month: string, footprint: ?object }[]>} Each month, the earliest first,
 *   with its manufacturing, electricity, operations and total, null for a month without one
 */
export const fetchCarbonTrend = async (end, account = null) => {
  const { data } = await api.get('/carbon/trend', {
    params: { end, ...accountParams(account) },
  });
  return data;
};

/**
 * The lines of a month's carbon footprint (#155): each dedicated server, instance flavor and
 * volume type that OVHcloud's file names, per datacenter, and the servers that it does not
 * name in one line, with what their bill lines cost in the month of use and their intensity
 * @param {string} month - The month, 'YYYY-MM'
 * @param {?string} [account] - The account whose lines to ask for, as the functions above take
 *   it: null for all accounts
 * @returns {Promise<{ month: string, lines: object[] }>} Each line's type, name, range,
 *   datacenter, serverDomain, unnamedServers, account, footprint, cost and intensity, the
 *   largest footprint first
 */
export const fetchCarbonByServer = async (month, account = null) => {
  const { data } = await api.get('/carbon/by-server', {
    params: { month, ...accountParams(account) },
  });
  return data;
};
