import { months } from './calendar.js';

// Cost trends of the synthetic account, as /api/analysis/monthly-trend and
// /api/analysis/monthly-trend-by-category answer, keyed by the month they end
// on, then by the number of months asked for, and its GPU costs, as
// /api/gpu/summary answers. A cost trend gives every month of its period, at
// 0 € for a month without any bill, or none when none of them has a bill (#65).

// The names the trend routes give the months, in French only
const MONTH_NAMES = [
  'Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Jun', 'Jul', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc',
];

// The months from one to another, both included: monthsFrom('2025-11', '2026-01')
// gives 2025-11, 2025-12 and 2026-01
const monthsFrom = (first, last) => {
  const monthIndex = (yearMonth) => {
    const [year, month] = yearMonth.split('-').map(Number);
    return year * 12 + month - 1;
  };
  const start = monthIndex(first);
  return Array.from({ length: monthIndex(last) - start + 1 }, (_, offset) => {
    const index = start + offset;
    return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
  });
};

// A cost trend from one month to another, as its route answers: the billed
// months given, and every other month at 0 €
const costTrend = (first, last, billed) => monthsFrom(first, last).map((yearMonth) =>
  billed.find((entry) => entry.yearMonth === yearMonth)
  ?? { month: MONTH_NAMES[Number(yearMonth.slice(5)) - 1], yearMonth, cost: 0 });

// A cost trend by resource type from one month to another, as its route
// answers: the rows of the billed months given, and every other month with
// every resource type at 0 €
const costTrendByResourceType = (first, last, { categories, data }) => ({
  categories,
  data: monthsFrom(first, last).map((yearMonth) =>
    data.find((row) => row.yearMonth === yearMonth)
    ?? { yearMonth, ...Object.fromEntries(categories.map(({ key }) => [key, 0])) }),
});

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
// Up to August: no licence was billed yet, and the domains cost more than the
// backups
const costByResourceTypeUpToAugust = {
  categories: [
    { key: 'cloud_project', label: 'Public Cloud', color: '#3b82f6' },
    { key: 'dedicated_server', label: 'Dedicated Servers', color: '#ef4444' },
    { key: 'domain', label: 'Domains', color: '#8b5cf6' },
    { key: 'backup', label: 'Backup', color: '#059669' },
  ],
  data: [
    { yearMonth: '2026-07', cloud_project: 680, dedicated_server: 270, domain: 30, backup: 0 },
    { yearMonth: '2026-08', cloud_project: 702, dedicated_server: 270, domain: 30, backup: 40 },
  ],
};

// GPU instances of the Production project, billed in August and September.
// The Trends tab asks /api/gpu/summary for the months of its period: July to
// September.
const gpuFromJulyToSeptember = {
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

// The Overview and the Public Cloud tab ask for the selected month. The
// instances are those of the inventory, whatever the month.
const gpuInMonth = (month, total) => ({
  total,
  project_count: 1,
  byModel: [{ gpu_model: 'NVIDIA L4', total, count: 1, color: '#22c55e' }],
  byProject: [
    { project_name: 'Production', project_id: 'project-production',
      total, gpu_flavors: 'l4-90' },
  ],
  monthlyTrend: [{ month, total }],
  instances: gpuFromJulyToSeptember.instances,
});

export const trends = {
  // The page asks for 3 months, the longest period that three billed months
  // allow, rather than the 6 of the default. With August selected, the 3
  // months run from June, which was not billed: at 0 €.
  monthlyTrend: {
    '2026-09': { 3: lastThreeMonths },
    '2026-08': { 3: costTrend('2026-06', '2026-08', lastThreeMonths) },
  },
  monthlyTrendByCategory: {
    '2026-09': { 3: costByResourceType },
    '2026-08': {
      3: costTrendByResourceType('2026-06', '2026-08', costByResourceTypeUpToAugust),
    },
  },
  gpuSummary: {
    '2026-07/2026-09': gpuFromJulyToSeptember,
    '2026-06/2026-08': gpuInMonth('2026-08', 310),
    '2026-08': gpuInMonth('2026-08', 310),
    '2026-09': gpuInMonth('2026-09', 420.5),
  },
};

// The first month billed to the variant below, alone: Public Cloud only
const july2025 = { month: 'Jul', yearMonth: '2025-07', cost: 450 };
const costByResourceTypeInJuly2025 = {
  categories: [costByResourceType.categories[0]],
  data: [{ yearMonth: '2025-07', cloud_project: 450 }],
};

// A variant of the account, first billed in July 2025: 15 months of history,
// without any bill from August 2025 to June 2026.
export const sinceJuly2025 = {
  months: [
    ...months,
    { value: '2025-07', label: 'Juillet 2025', from: '2025-07-01', to: '2025-07-31' },
  ],
  monthlyTrend: {
    '2026-09': {
      6: costTrend('2026-04', '2026-09', lastThreeMonths),
      12: costTrend('2025-10', '2026-09', lastThreeMonths),
      24: costTrend('2024-10', '2026-09', [july2025, ...lastThreeMonths]),
    },
    '2026-08': { 6: costTrend('2026-03', '2026-08', lastThreeMonths) },
    // The first billed month allows 3 months only
    '2025-07': { 3: costTrend('2025-05', '2025-07', [july2025]) },
  },
  monthlyTrendByCategory: {
    '2026-09': {
      6: costTrendByResourceType('2026-04', '2026-09', costByResourceType),
      12: costTrendByResourceType('2025-10', '2026-09', costByResourceType),
      24: costTrendByResourceType('2024-10', '2026-09', {
        categories: costByResourceType.categories,
        data: [
          { yearMonth: '2025-07',
            cloud_project: 450, dedicated_server: 0, backup: 0, domain: 0, license: 0 },
          ...costByResourceType.data,
        ],
      }),
    },
    '2026-08': {
      6: costTrendByResourceType('2026-03', '2026-08', costByResourceTypeUpToAugust),
    },
    '2025-07': {
      3: costTrendByResourceType('2025-05', '2025-07', costByResourceTypeInJuly2025),
    },
  },
};
