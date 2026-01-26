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

export const fetchProjects = async () => {
  const { data } = await api.get('/projects');
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

export const fetchDailyTrend = async (from, to) => {
  const { data } = await api.get('/analysis/daily-trend', { params: { from, to } });
  return data;
};

export const fetchMonthlyTrend = async (months = 6) => {
  const { data } = await api.get('/analysis/monthly-trend', { params: { months } });
  return data;
};

export const fetchImportStatus = async () => {
  const { data } = await api.get('/import/status');
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

export const fetchConsumptionHistory = async (from, to) => {
  const { data } = await api.get('/consumption/usage-history', { params: { from, to } });
  return data;
};

// Phase 2: Account
export const fetchAccountBalance = async () => {
  const { data } = await api.get('/account/balance');
  return data;
};

export const fetchAccountCredits = async () => {
  const { data } = await api.get('/account/credits');
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

export const fetchInventorySummary = async () => {
  const { data } = await api.get('/inventory/summary');
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

export const fetchProjectInstances = async (projectId) => {
  const { data } = await api.get(`/projects/${projectId}/instances`);
  return data;
};

export const fetchProjectQuotas = async (projectId) => {
  const { data } = await api.get(`/projects/${projectId}/quotas`);
  return data;
};

// GPU costs
export const fetchGpuSummary = async (from, to) => {
  const { data } = await api.get('/gpu/summary', { params: { from, to } });
  return data;
};

export default api;
