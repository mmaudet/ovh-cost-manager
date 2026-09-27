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

// The costs of each project billed to the account, each with the account of its bills (#118)
export const fetchByProject = async (from, to, account = null) => {
  const { data } = await api.get('/analysis/by-project', {
    params: { from, to, ...accountParams(account) },
  });
  return data;
};

export const fetchByService = async (from, to, account = null) => {
  const { data } = await api.get('/analysis/by-service', {
    params: { from, to, ...accountParams(account) },
  });
  return data;
};

// Trends over `months` months that end on the `end` month, 'YYYY-MM', of the account
export const fetchMonthlyTrend = async (months, end, account = null) => {
  const { data } = await api.get('/analysis/monthly-trend', {
    params: { months, end, ...accountParams(account) },
  });
  return data;
};

export const fetchMonthlyTrendByCategory = async (months, end, account = null) => {
  const { data } = await api.get('/analysis/monthly-trend-by-category', {
    params: { months, end, ...accountParams(account) },
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

// Phase 1: Consumption
export const fetchConsumptionCurrent = async () => {
  const { data } = await api.get('/consumption/current');
  return data;
};

export const fetchConsumptionForecast = async () => {
  const { data } = await api.get('/consumption/forecast');
  return data;
};

// Phase 3: Inventory
export const fetchInventoryServers = async () => {
  const { data } = await api.get('/inventory/servers');
  return data;
};

export const fetchInventoryVps = async () => {
  const { data } = await api.get('/inventory/vps');
  return data;
};

export const fetchInventoryStorage = async () => {
  const { data } = await api.get('/inventory/storage');
  return data;
};

export const fetchExpiringServices = async (days = 30) => {
  const { data } = await api.get('/inventory/expiring', { params: { days } });
  return data;
};

export const fetchByResourceType = async (from, to, account = null) => {
  const { data } = await api.get('/analysis/by-resource-type', {
    params: { from, to, ...accountParams(account) },
  });
  return data;
};

export const fetchResourceTypeDetails = async (type, from, to) => {
  const { data } = await api.get('/analysis/resource-type-details', { params: { type, from, to } });
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

// Backup stats (Veeam)
export const fetchBackupStats = async (from, to) => {
  const { data } = await api.get('/analysis/backup-stats', { params: { from, to } });
  return data;
};
