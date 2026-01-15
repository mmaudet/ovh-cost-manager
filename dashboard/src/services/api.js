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

export default api;
