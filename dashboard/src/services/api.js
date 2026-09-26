import axios from 'axios';

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

export const fetchMonths = async () => {
  const { data } = await api.get('/months');
  return data;
};

export const fetchSummary = async (from, to) => {
  const { data } = await api.get('/summary', { params: { from, to } });
  return data;
};

export const fetchProjectsEnriched = async () => {
  const { data } = await api.get('/projects/enriched');
  return data;
};

export const fetchByProject = async (from, to) => {
  const { data } = await api.get('/analysis/by-project', { params: { from, to } });
  return data;
};

export const fetchByService = async (from, to) => {
  const { data } = await api.get('/analysis/by-service', { params: { from, to } });
  return data;
};

// Trends over `months` months that end on the `end` month, 'YYYY-MM'
export const fetchMonthlyTrend = async (months, end) => {
  const { data } = await api.get('/analysis/monthly-trend', { params: { months, end } });
  return data;
};

export const fetchMonthlyTrendByCategory = async (months, end) => {
  const { data } = await api.get('/analysis/monthly-trend-by-category', {
    params: { months, end }
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

export const fetchByResourceType = async (from, to) => {
  const { data } = await api.get('/analysis/by-resource-type', { params: { from, to } });
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

export const fetchWebCloudSummary = async (from, to) => {
  const { data } = await api.get('/web-cloud/summary', { params: { from, to } });
  return data;
};

export const fetchWebCloudItems = async (from, to) => {
  const { data } = await api.get('/web-cloud/items', { params: { from, to } });
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

// GPU costs
export const fetchGpuSummary = async (from, to) => {
  const { data } = await api.get('/gpu/summary', { params: { from, to } });
  return data;
};

// Public Cloud stats (Kubernetes, S3, Registry, etc.)
export const fetchPublicCloudStats = async (from, to) => {
  const { data } = await api.get('/analysis/public-cloud-stats', { params: { from, to } });
  return data;
};

// Backup stats (Veeam)
export const fetchBackupStats = async (from, to) => {
  const { data } = await api.get('/analysis/backup-stats', { params: { from, to } });
  return data;
};
