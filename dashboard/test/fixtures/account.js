import { months } from './calendar.js';
import { webCloud } from './web-cloud.js';

// A small synthetic OVHcloud account: two Public Cloud projects, a dedicated
// server, Veeam backups and a few Web Cloud services, billed over three months.
// Every name, identifier and amount is made up.
//
// It is shaped as the API of server/index.js answers. Each key is named after
// an API function of src/services/api.js, without its "fetch" prefix. What
// depends on a month is keyed by that month ('2026-09'), what covers several
// months by the first and the last ('2025-10/2026-09'). A missing key or
// period answers what the server answers when there is nothing to show (see
// support/api.js).

// SQLite timestamps: UTC, without a timezone suffix
const lastImport = {
  id: 3,
  started_at: '2026-09-14 04:00:00',
  completed_at: '2026-09-14 04:02:30',
  type: 'differential',
  from_date: '2026-08-15',
  to_date: '2026-09-14',
  bills_imported: 3,
  details_imported: 41,
  projects_imported: 2,
  status: 'success',
  error_message: null,
};

export const account = {
  config: { budget: 50000, currency: 'EUR' },
  // Authentication disabled
  user: { id: null, name: 'Anonymous', email: null, authEnabled: false },
  months,

  // Imported yesterday, after a failed attempt the day before; the first,
  // full import dates back to July. Most recent first.
  importStatus: {
    latest: lastImport,
    running: false,
    history: [
      lastImport,
      {
        id: 2,
        started_at: '2026-09-13 04:00:00',
        completed_at: '2026-09-13 04:00:12',
        type: 'differential',
        from_date: '2026-08-14',
        to_date: '2026-09-13',
        bills_imported: 0,
        details_imported: 0,
        projects_imported: 0,
        status: 'failed',
        error_message: 'OVH API unreachable',
      },
      {
        id: 1,
        started_at: '2026-07-01 08:00:00',
        completed_at: '2026-07-01 08:05:00',
        type: 'full',
        from_date: null,
        to_date: null,
        bills_imported: 7,
        details_imported: 64,
        projects_imported: 2,
        status: 'success',
        error_message: null,
      },
    ],
  },

  summary: {
    '2026-09': {
      period: { from: '2026-09-01', to: '2026-09-30' },
      total: 1250.4,
      cloudTotal: 830.4,
      nonCloudTotal: 420,
      dailyAverage: 41.68,
      billsCount: 3,
      projectsCount: 2,
      topProjects: [{ name: 'Production', value: 610.4 }, { name: 'Staging', value: 220 }],
    },
    '2026-08': {
      period: { from: '2026-08-01', to: '2026-08-31' },
      total: 1042,
      cloudTotal: 702,
      nonCloudTotal: 340,
      dailyAverage: 33.61,
      billsCount: 2,
      projectsCount: 2,
      topProjects: [{ name: 'Production', value: 512 }, { name: 'Staging', value: 190 }],
    },
    '2026-07': {
      period: { from: '2026-07-01', to: '2026-07-31' },
      total: 980,
      cloudTotal: 680,
      nonCloudTotal: 300,
      dailyAverage: 31.61,
      billsCount: 2,
      projectsCount: 1,
      topProjects: [{ name: 'Production', value: 680 }],
    },
  },

  // Service types, most expensive first
  byService: {
    '2026-09': [
      { name: 'Compute', value: 800.4, color: '#3b82f6', detailsCount: 21 },
      { name: 'Storage', value: 250, color: '#10b981', detailsCount: 9 },
      { name: 'Other', value: 200, color: '#6b7280', detailsCount: 11 },
    ],
    '2026-08': [
      { name: 'Compute', value: 690, color: '#3b82f6', detailsCount: 18 },
      { name: 'Storage', value: 202, color: '#10b981', detailsCount: 8 },
      { name: 'Other', value: 150, color: '#6b7280', detailsCount: 9 },
    ],
    '2026-07': [
      { name: 'Compute', value: 650, color: '#3b82f6', detailsCount: 12 },
      { name: 'Other', value: 200, color: '#6b7280', detailsCount: 6 },
      { name: 'Storage', value: 130, color: '#10b981', detailsCount: 5 },
    ],
  },

  byProject: {
    '2026-09': [
      { projectId: 'project-production', projectName: 'Production', total: 610.4, detailsCount: 30 },
      { projectId: 'project-staging', projectName: 'Staging', total: 220, detailsCount: 11 },
    ],
    '2026-08': [
      { projectId: 'project-production', projectName: 'Production', total: 512, detailsCount: 26 },
      { projectId: 'project-staging', projectName: 'Staging', total: 190, detailsCount: 9 },
    ],
    '2026-07': [
      { projectId: 'project-production', projectName: 'Production', total: 680, detailsCount: 23 },
    ],
  },

  byResourceType: {
    '2026-09': [
      { name: 'Public Cloud', resource_type: 'cloud_project', value: 830.4, color: '#3b82f6', detailsCount: 41, serviceCount: 2 },
      { name: 'Dedicated Servers', resource_type: 'dedicated_server', value: 270, color: '#ef4444', detailsCount: 1, serviceCount: 1 },
      { name: 'Backup', resource_type: 'backup', value: 90, color: '#059669', detailsCount: 3, serviceCount: 3 },
      { name: 'Domains', resource_type: 'domain', value: 35, color: '#8b5cf6', detailsCount: 4, serviceCount: 2 },
      { name: 'Licenses', resource_type: 'license', value: 25, color: '#0891b2', detailsCount: 1, serviceCount: 1 },
    ],
    '2026-08': [
      { name: 'Public Cloud', resource_type: 'cloud_project', value: 702, color: '#3b82f6', detailsCount: 35, serviceCount: 2 },
      { name: 'Dedicated Servers', resource_type: 'dedicated_server', value: 270, color: '#ef4444', detailsCount: 1, serviceCount: 1 },
      { name: 'Backup', resource_type: 'backup', value: 40, color: '#059669', detailsCount: 2, serviceCount: 2 },
      { name: 'Domains', resource_type: 'domain', value: 30, color: '#8b5cf6', detailsCount: 2, serviceCount: 2 },
    ],
    '2026-07': [
      { name: 'Public Cloud', resource_type: 'cloud_project', value: 680, color: '#3b82f6', detailsCount: 23, serviceCount: 1 },
      { name: 'Dedicated Servers', resource_type: 'dedicated_server', value: 270, color: '#ef4444', detailsCount: 1, serviceCount: 1 },
      { name: 'Domains', resource_type: 'domain', value: 30, color: '#8b5cf6', detailsCount: 1, serviceCount: 1 },
    ],
  },

  // The current month so far, read from the Public Cloud projects
  consumptionCurrent: {
    snapshot_date: '2026-09-15T04:00:00.000Z',
    period_start: '2026-09-01',
    period_end: '2026-09-15',
    current_total: 402.35,
    source: 'cloud_projects',
    project_count: 2,
    currency: 'EUR',
  },
  consumptionForecast: {
    snapshot_date: '2026-09-15T04:00:00.000Z',
    period_start: '2026-09-01',
    period_end: '2026-09-15',
    forecast_total: 862.18,
    current_total: 402.35,
    currency: 'EUR',
    progress: 47,
    source: 'cloud_projects',
    days_elapsed: 14,
    days_in_month: 30,
  },

  ...webCloud,
};
