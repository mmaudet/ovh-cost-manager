import { months } from './calendar.js';

// Cost trends of the synthetic account, as /api/analysis/monthly-trend and
// /api/analysis/monthly-trend-by-category answer, keyed by the number of
// months asked for.

const lastThreeMonths = [
  { month: 'Jul', yearMonth: '2026-07', cost: 980 },
  { month: 'Aoû', yearMonth: '2026-08', cost: 1042 },
  { month: 'Sep', yearMonth: '2026-09', cost: 1250.4 },
];

// Categories are resource types, labelled by the server in English only and
// ordered by what they cost over the period.
const costByResourceType = {
  categories: [
    { key: 'cloud_project', label: 'Public Cloud', color: '#3b82f6' },
    { key: 'dedicated_server', label: 'Dedicated Servers', color: '#ef4444' },
    { key: 'backup', label: 'Backup', color: '#059669' },
    { key: 'domain', label: 'Domains', color: '#8b5cf6' },
    { key: 'license', label: 'Licenses', color: '#0891b2' },
  ],
  data: [
    { yearMonth: '2026-07',
      cloud_project: 680, dedicated_server: 270, backup: 0, domain: 30, license: 0 },
    { yearMonth: '2026-08',
      cloud_project: 702, dedicated_server: 270, backup: 40, domain: 30, license: 0 },
    { yearMonth: '2026-09',
      cloud_project: 830.4, dedicated_server: 270, backup: 90, domain: 35, license: 25 },
  ],
};

// GPU instances of the Production project, billed in August and September.
// The Trends tab asks /api/gpu/summary for no period: all months.
const gpuOverAllMonths = {
  total: 730.5,
  project_count: 1,
  byModel: [{ gpu_model: 'NVIDIA L4', total: 730.5, count: 1, color: '#22c55e' }],
  byProject: [
    { project_name: 'Production', project_id: 'project-production',
      total: 730.5, gpu_flavors: 'l4-90' },
  ],
  monthlyTrend: [
    { month: '2026-08', total: 310 },
    { month: '2026-09', total: 420.5 },
  ],
  instances: [
    {
      id: 'instance-gpu-1',
      name: 'inference-1',
      project_name: 'Production',
      project_id: 'project-production',
      plan_code: 'l4-90.consumption',
      flavor: 'l4-90',
      region: 'GRA11',
      status: 'ACTIVE',
      monthly_billing: 0,
    },
  ],
};

export const trends = {
  // The page asks for 6 months, then for 3: the longest period that three
  // billed months allow. Both periods cover the same bills.
  monthlyTrend: { 3: lastThreeMonths, 6: lastThreeMonths },
  monthlyTrendByCategory: { 3: costByResourceType, 6: costByResourceType },
  gpuSummary: { all: gpuOverAllMonths },
};

// A variant of the account, first billed in July 2025: 15 months of history.
export const sinceJuly2025 = {
  months: [
    ...months,
    { value: '2025-07', label: 'Juillet 2025', from: '2025-07-01', to: '2025-07-31' },
  ],
  monthlyTrend: {
    6: lastThreeMonths,
    12: lastThreeMonths,
    24: [{ month: 'Jul', yearMonth: '2025-07', cost: 450 }, ...lastThreeMonths],
  },
  monthlyTrendByCategory: {
    6: costByResourceType,
    12: costByResourceType,
    24: {
      categories: costByResourceType.categories,
      data: [
        { yearMonth: '2025-07',
          cloud_project: 450, dedicated_server: 0, backup: 0, domain: 0, license: 0 },
        ...costByResourceType.data,
      ],
    },
  },
};
