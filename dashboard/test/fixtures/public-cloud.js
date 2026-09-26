// The Public Cloud projects of the synthetic account and their resources, as
// /api/projects/enriched, /api/analysis/public-cloud-stats and the
// /api/projects/:id/... routes answer.
//
// Production runs every kind of resource the Public Cloud tab shows. Staging
// ran Kubernetes nodes, deleted since: they are gone from the inventory, not
// from the bills. Sandbox has nothing, and was never billed.

const PRODUCTION = 'project-production';
const STAGING = 'project-staging';
const SANDBOX = 'project-sandbox';

// Most consuming first, as the server sorts them
const projects = [
  { id: PRODUCTION, name: 'Production', description: 'Customer-facing services', status: 'ok',
    instance_count: 5, consumption_total: 350,
    period_start: '2026-09-01', period_end: '2026-09-15' },
  { id: STAGING, name: 'Staging', description: null, status: 'ok',
    instance_count: 0, consumption_total: 52.35,
    period_start: '2026-09-01', period_end: '2026-09-15' },
  { id: SANDBOX, name: 'Sandbox', description: null, status: 'ok',
    instance_count: 0, consumption_total: 0, period_start: null, period_end: null },
];

// What a project consumed from the 1st of the month to the last import, by
// cloud resource kind. The import keeps that of each month from the upgrade on
// (#54): here, September only.
const usage = (fields) => ({
  period_start: '2026-09-01',
  period_end: '2026-09-15',
  unit_price: 0,
  imported_at: '2026-09-14 04:01:30',
  ...fields,
});

const productionUsage = [
  usage({ id: 1, project_id: PRODUCTION, resource_type: 'instance', resource_id: 'instance-gpu-1',
    resource_name: 'l4-90', quantity: 336, unit: 'Hour', total_price: 210.25, region: 'GRA11' }),
  usage({ id: 2, project_id: PRODUCTION, resource_type: 'instance', resource_id: 'instance-web-1',
    resource_name: 'b3-8', quantity: 336, unit: 'Hour', total_price: 12, region: 'GRA11' }),
  usage({ id: 3, project_id: PRODUCTION, resource_type: 'instance', resource_id: 'instance-web-2',
    resource_name: 'b3-8', quantity: 336, unit: 'Hour', total_price: 12, region: 'GRA11' }),
  usage({ id: 4, project_id: PRODUCTION, resource_type: 'instance_monthly',
    resource_id: 'instance-db-1', resource_name: 'r3-32', quantity: 1, unit: 'Month',
    total_price: 64, region: 'SBG5' }),
  usage({ id: 5, project_id: PRODUCTION, resource_type: 'volume', resource_id: 'volume-db-data',
    resource_name: 'high-speed', quantity: 67200, unit: 'GiBh', total_price: 5.25,
    region: 'SBG5' }),
  usage({ id: 6, project_id: PRODUCTION, resource_type: 'volume', resource_id: 'volume-web-shared',
    resource_name: 'classic', quantity: 33600, unit: 'GiBh', total_price: 2.25, region: 'GRA11' }),
  usage({ id: 7, project_id: PRODUCTION, resource_type: 'snapshot', resource_id: '',
    resource_name: 'SBG5', quantity: 16800, unit: 'GiBh', total_price: 3.25, region: 'SBG5' }),
  usage({ id: 8, project_id: PRODUCTION, resource_type: 'objectStorage', resource_id: '',
    resource_name: 'GRA', quantity: 1920000, unit: 'GiBh', total_price: 41, region: 'GRA' }),
];

const stagingUsage = [
  usage({ id: 9, project_id: STAGING, resource_type: 'instance', resource_id: 'instance-node-1',
    resource_name: 'b3-16', quantity: 150, unit: 'Hour', total_price: 52.35, region: 'GRA11' }),
];

// The instances of Production, sorted by name as the server does
const instance = (fields) => ({
  project_id: PRODUCTION,
  plan_code: null,
  monthly_billing: 0,
  imported_at: '2026-09-14 04:01:25',
  ...fields,
});

const batch1 = instance({ id: 'instance-batch-1', name: 'batch-1', flavor: 'd2-4',
  region: 'GRA11', status: 'SHUTOFF', created_at: '2026-05-04T08:00:00Z' });
const db1 = instance({ id: 'instance-db-1', name: 'db-1', flavor: 'r3-32',
  plan_code: 'r3-32.monthly.postpaid', region: 'SBG5', status: 'ACTIVE',
  created_at: '2025-11-20T09:00:00Z', monthly_billing: 1 });
const inference1 = instance({ id: 'instance-gpu-1', name: 'inference-1', flavor: 'l4-90',
  plan_code: 'l4-90.consumption', region: 'GRA11', status: 'ACTIVE',
  created_at: '2026-08-01T07:30:00Z' });
const web1 = instance({ id: 'instance-web-1', name: 'web-1', flavor: 'b3-8',
  plan_code: 'b3-8.consumption', region: 'GRA11', status: 'ACTIVE',
  created_at: '2026-02-10T08:00:00Z' });
const web2 = instance({ id: 'instance-web-2', name: 'web-2', flavor: 'b3-8',
  plan_code: 'b3-8.consumption', region: 'GRA11', status: 'ACTIVE',
  created_at: '2026-02-10T08:05:00Z' });

// The cost of an instance over a month: exact when billed under its id, like
// a monthly instance; estimated when it is an even share of the hourly line
// of its flavor and region; none without any line.
const exactCost = (total) => ({ total, cost_estimated: false });
const estimatedCost = (total) => ({ total, cost_estimated: true });
const notBilled = { total: null, cost_estimated: false };
// The lines of the instances gone from the inventory, on a row of their own
const unallocated = (total) => ({
  id: null, name: null, total, cost_estimated: false, unallocated: true,
});

// Most expensive first, then by name, as the server sorts them. The page sorts
// them by name.
const buckets = [
  { name: 'assets-example-com', type: 'Standard', region: 'GRA', status: null,
    objectsCount: 1520, objectsSize: 4200000000, createdAt: '2025-11-03T08:00:00Z',
    inInventory: true, allocated: false, total: 14 },
  // Its share of the aggregated Cold Archive line, pro rata of what it stores
  { name: 'archives-2025', type: 'Cold Archive', region: 'GRA', status: 'archived',
    objectsCount: 12, objectsSize: 1500000000000, createdAt: '2025-06-30T08:00:00Z',
    inInventory: true, allocated: true, total: 9 },
  // Billed, then deleted: gone from the inventory, with it its class and size
  { name: 'old-exports', type: null, region: 'SBG', status: null,
    objectsCount: null, objectsSize: null, createdAt: null,
    inInventory: false, allocated: false, total: 2 },
  // Created this month, still empty
  { name: 'logs-empty', type: 'Standard', region: 'GRA', status: null,
    objectsCount: 0, objectsSize: 0, createdAt: '2026-09-10T08:00:00Z',
    inInventory: true, allocated: false, total: 0 },
];

// Extra disks are billed per region and type, never per volume: each line is
// spread over the volumes of its region and type, pro rata of their size. A
// line with no volume left behind it gets a row of its own, attachment
// unknown. Most expensive first, then by name, as the server sorts them.
const volumes = [
  { id: 'volume-db-data', name: 'db-data', region: 'SBG5', type: 'high-speed', sizeGb: 200,
    status: 'in-use', bootable: false, attachedTo: ['instance-db-1'],
    createdAt: '2025-11-20T09:05:00Z', allocated: true, total: 6.5 },
  { id: 'volume-web-shared', name: 'web-shared', region: 'GRA11', type: 'classic',
    sizeGb: 100, status: 'in-use', bootable: false, attachedTo: ['instance-web-1'],
    createdAt: '2026-02-10T08:10:00Z', allocated: true, total: 3 },
  { id: null, name: 'Disques supplémentaires à bhs5 de type classic', region: 'bhs5',
    type: 'classic', sizeGb: null, status: null, bootable: false, attachedTo: null,
    createdAt: null, allocated: true, total: 1.5 },
  // Attached to no instance
  { id: 'volume-old-backup', name: 'old-backup', region: 'GRA11', type: 'classic', sizeGb: 50,
    status: 'available', bootable: false, attachedTo: [],
    createdAt: '2025-12-01T10:00:00Z', allocated: true, total: 1.5 },
];

// Billed per region only, and spread in the same way
const snapshots = [
  { id: 'snapshot-db-1-before-upgrade', name: 'db-1-before-upgrade', region: 'SBG5',
    sizeGb: 40, status: 'active', visibility: 'private', osType: 'linux',
    createdAt: '2026-08-28T10:00:00Z', allocated: true, total: 4 },
  { id: 'snapshot-web-1-golden', name: 'web-1-golden', region: 'GRA11', sizeGb: 10,
    status: 'active', visibility: 'private', osType: 'linux',
    createdAt: '2026-02-14T10:30:00Z', allocated: true, total: 2 },
];

// Read from the bills. Coverage is per flavor: the instances the plans of a
// flavor pay for, and those of that flavor in the inventory.
const savingsPlans = [
  { id: 'savings-plan-b3-8-web', flavor: 'b3-8', duration: '1M', covered: 2, flavorCovered: 2,
    inventory: 2, months: 1, firstDate: '2026-09-01', lastDate: '2026-09-01', total: 20 },
  // Pays for a c3-4 the project no longer runs
  { id: 'savings-plan-c3-4-legacy', flavor: 'c3-4', duration: '1M', covered: 1,
    flavorCovered: 1, inventory: 0, months: 1, firstDate: '2026-09-01',
    lastDate: '2026-09-01', total: 8 },
];

// The quotas of the last import, by region
const quota = (id, project_id, region, cores, instances) => ({
  id,
  project_id,
  region,
  max_cores: cores.max,
  max_instances: instances.max,
  max_ram_mb: cores.max * 4096,
  used_cores: cores.used,
  used_instances: instances.used,
  used_ram_mb: cores.used * 4096,
  snapshot_date: '2026-09-14 04:01:30',
});

const publicCloudStats = (fields) => ({
  kubernetes: { count: 0, total: 0 },
  aiml: { count: 0, total: 0 },
  loadBalancers: { count: 0, total: 0 },
  ...fields,
});

export const publicCloud = {
  projectsEnriched: projects,

  // Read from the bills of the month; the counts of buckets, volumes and
  // snapshots from the inventory, of what existed by the end of the month
  publicCloudStats: {
    '2026-09': publicCloudStats({
      instances: { total: 718.9 },
      volumes: { count: 3, total: 12.5 },
      snapshots: { count: 2, total: 6 },
      savingsPlans: { count: 2, total: 28 },
      objectStorage: { count: 3, total: 25 },
      registry: { count: 1, total: 40 },
    }),
    '2026-08': publicCloudStats({
      instances: { total: 590.6 },
      volumes: { count: 3, total: 12.5 },
      snapshots: { count: 2, total: 6 },
      savingsPlans: { count: 2, total: 28 },
      objectStorage: { count: 2, total: 24.9 },
      registry: { count: 1, total: 40 },
    }),
  },

  // Without a period, that of the latest month imported; for a month, what falls within it
  projectConsumption: {
    [PRODUCTION]: { all: productionUsage, '2026-09': productionUsage },
    [STAGING]: { all: stagingUsage, '2026-09': stagingUsage },
  },

  // In August, only the instances of Production are detailed
  projectInstances: {
    [PRODUCTION]: {
      '2026-09': [
        { ...batch1, ...notBilled },
        { ...db1, ...exactCost(64) },
        { ...inference1, ...estimatedCost(420.5) },
        { ...web1, ...estimatedCost(24) },
        { ...web2, ...estimatedCost(24) },
        unallocated(6.4),
      ],
      '2026-08': [
        { ...batch1, ...estimatedCost(18.6) },
        { ...db1, ...exactCost(64) },
        { ...inference1, ...estimatedCost(310) },
        { ...web1, ...estimatedCost(24) },
        { ...web2, ...estimatedCost(24) },
      ],
    },
    [STAGING]: { '2026-09': [unallocated(180)] },
  },
  projectInstanceTotal: {
    [PRODUCTION]: { '2026-09': { total: 538.9 }, '2026-08': { total: 440.6 } },
    [STAGING]: { '2026-09': { total: 180 } },
  },
  projectBuckets: { [PRODUCTION]: { '2026-09': buckets } },
  projectVolumes: { [PRODUCTION]: { '2026-09': volumes } },
  projectSnapshots: { [PRODUCTION]: { '2026-09': snapshots } },
  projectSavingsPlans: { [PRODUCTION]: { '2026-09': savingsPlans } },
  // Only the regions where a project runs something show
  projectQuotas: {
    [PRODUCTION]: [
      quota(21, PRODUCTION, 'BHS5', { max: 32, used: 0 }, { max: 10, used: 0 }),
      quota(22, PRODUCTION, 'GRA11', { max: 64, used: 28 }, { max: 20, used: 4 }),
      quota(23, PRODUCTION, 'SBG5', { max: 32, used: 4 }, { max: 10, used: 1 }),
    ],
    [STAGING]: [
      quota(24, STAGING, 'GRA11', { max: 64, used: 0 }, { max: 20, used: 0 }),
    ],
  },
};
