import axios from 'axios';

const API_BASE = '/api';

const api = axios.create({
  baseURL: API_BASE,
  timeout: 30000
});

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

export default api;
