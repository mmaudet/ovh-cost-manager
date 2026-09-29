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

// The NIC handle of the synthetic account (see account.js)
const ACCOUNT = 'xx1111-ovh';

// Most consuming first, as the server sorts them, each with the NIC handle of
// its account (#121)
const projects = [
  { id: PRODUCTION, name: 'Production', description: 'Customer-facing services', status: 'ok',
    account: ACCOUNT, instance_count: 5, consumption_total: 350,
    period_start: '2026-09-01', period_end: '2026-09-15' },
  { id: STAGING, name: 'Staging', description: null, status: 'ok', account: ACCOUNT,
    instance_count: 0, consumption_total: 52.35,
    period_start: '2026-09-01', period_end: '2026-09-15' },
  { id: SANDBOX, name: 'Sandbox', description: null, status: 'ok', account: ACCOUNT,
    instance_count: 0, consumption_total: 0, period_start: null, period_end: null },
];

// What a project consumed from the 1st of the month to the last import, by
// cloud resource kind: that of September, the month of the last import.
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
  usage({ id: 8, project_id: PRODUCTION, resource_type: 'storage', resource_id: '',
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
  // Created this month, still empty: without an object, it has no class (#145)
  { name: 'logs-empty', type: null, region: 'GRA', status: null,
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

// The products of a project's bills over a period, as /api/projects/:id/products
// answers them (#181): what they cost in all, each product as [product, cost,
// charges], the most expensive first, and the credit that the bills used. The
// charges of a product (#195), each as [charge, cost], the most expensive
// first: none when the test gives none.
export const billedProducts = (total, products, credits = 0) => ({
  total,
  products: products.map(([product, cost, charges = []]) => ({
    product,
    total: cost,
    charges: charges.map(([charge, chargeCost]) => ({ charge, total: chargeCost })),
  })),
  credits,
});

// What the bill lines of the projects pay for, as OVHcloud words them: the
// charges of their products (#195), which the tests find the rows of the
// Compare tab by. The hourly use of a flavor in a region, and the monthly plan
// of db-1.
export const hourlyUse = (flavor) => `Consommation à l'heure pour les instances ${flavor} gra11`;
export const DB_1_PLAN = 'Forfait mensuel pour une instance r3-32 '
  + '(id instance-db-1, region sbg5) - 01 mois';
// The savings plans, as their lines name them
const WEB_PLAN = 'Savings plan (id : savings-plan-b3-8-web) '
  + 'pour 2 instance(s) b3-8 - Durée : 1M';
const LEGACY_PLAN = 'Savings plan (id : savings-plan-c3-4-legacy) '
  + 'pour 1 instance(s) c3-4 - Durée : 1M';
// The storage of a bucket in a region, and the Cold Archive, billed as a whole
export const bucketStorage = (bucket, region) => (
  `Stockage Standard - Bucket ${bucket} sur la région ${region}`
);
export const COLD_ARCHIVE = 'Stockage Cold Archive';
// The additional disks of a type in a region, and the snapshots of a region
const disks = (region, type) => `Disques supplémentaires à ${region} de type ${type}`;
const snapshotsIn = (region) => `Snapshots Public Cloud - ${region}`;
// The products that Production's bills of August and September charged alike
const PRODUCTION_SAVINGS_PLANS = ['savingsPlans', 28, [[WEB_PLAN, 20], [LEGACY_PLAN, 8]]];
const PRODUCTION_VOLUMES = ['volumes', 12.5, [
  [disks('sbg5', 'high-speed'), 6.5], [disks('gra11', 'classic'), 4.5],
  [disks('bhs5', 'classic'), 1.5],
]];
const PRODUCTION_SNAPSHOTS = ['snapshots', 6, [
  [snapshotsIn('sbg5'), 4], [snapshotsIn('gra11'), 2],
]];

// The AI Endpoints models that the bills of a period name, as
// /api/analysis/ai-endpoints answers them (#193): what they cost in all, and
// each model as [model, input tokens, output tokens, cost], the most expensive
// first, a token figure null when none of the model's lines counts those
// tokens. And each month of the bills that name a model, the earliest first,
// as [month, costs], with the cost of each model in it, in the order of the
// models: every model in every month (#196).
export const aiEndpointsFigures = (total, models, months) => ({
  total,
  models: models.map(([model, inputTokens, outputTokens, cost]) => ({
    model, inputTokens, outputTokens, total: cost,
  })),
  monthlyTrend: months.map(([month, costs]) => ({
    month,
    costs: Object.fromEntries(models.map(([model], index) => [model, costs[index]])),
  })),
});

// The AI Endpoints models of a single month, which its trend holds alone, with
// the cost of each model
export const aiEndpointsOfMonth = (month, total, models) => aiEndpointsFigures(
  total, models, [[month, models.map(([, , , cost]) => cost)]],
);

// The AI Endpoints models that the projects of the synthetic account called,
// which its figures above leave out, so that they stay as they are: the tests
// of the table of the models and of their trend give them to the page. In
// September, language models billed in input and output tokens, one of them
// little used, an embedding model, which counts its input tokens alone, a
// speech-to-text model, billed by the second of audio, and an image model,
// whose calls are free; in August, two of them; none before.
const september = aiEndpointsOfMonth('2026-09', 20.82, [
  ['gpt-oss-120b', 48260000, 12480000, 17.46],
  ['gpt-oss-20b', 15500000, 4800000, 2.68],
  ['whisper-large-v3', null, null, 0.37],
  ['bge-m3', 30000000, null, 0.3],
  ['Mistral-7B-Instruct-v0.3', 45000, 12300, 0.01],
  ['stable-diffusion-xl-base-v10', null, null, 0],
]);
const august = aiEndpointsOfMonth('2026-08', 1.47, [
  ['gpt-oss-20b', 9000000, 2100000, 1.35],
  ['bge-m3', 12000000, null, 0.12],
]);
// August's and September's together, as a period that holds both gives them
const augustAndSeptember = aiEndpointsFigures(22.29, [
  ['gpt-oss-120b', 48260000, 12480000, 17.46],
  ['gpt-oss-20b', 24500000, 6900000, 4.03],
  ['bge-m3', 42000000, null, 0.42],
  ['whisper-large-v3', null, null, 0.37],
  ['Mistral-7B-Instruct-v0.3', 45000, 12300, 0.01],
  ['stable-diffusion-xl-base-v10', null, null, 0],
], [
  ['2026-08', [0, 1.35, 0.12, 0, 0, 0]],
  ['2026-09', [17.46, 2.68, 0.3, 0.37, 0.01, 0]],
]);

// By the period asked for: a month, as the Public Cloud tab asks for it, or the
// months of the Trends tab's period (#196), up to the month selected
export const aiEndpoints = {
  '2026-09': september,
  '2026-08': august,
  // The 3 months up to September, and the longer periods that a longer
  // history offers (see trends.js): August's and September's models
  '2026-07/2026-09': augustAndSeptember,
  '2026-04/2026-09': augustAndSeptember,
  '2025-10/2026-09': augustAndSeptember,
  '2024-10/2026-09': augustAndSeptember,
  // Up to August: August's alone, a single month of models
  '2026-06/2026-08': august,
};

// The figures of the Public Cloud cards, as /api/analysis/public-cloud-stats
// answers them: those given, and nothing billed or counted for the others
export const publicCloudFigures = (fields) => ({
  kubernetes: { count: 0, total: 0 },
  instances: { total: 0 },
  volumes: { count: 0, total: 0 },
  snapshots: { count: 0, total: 0 },
  savingsPlans: { count: 0, total: 0 },
  objectStorage: { count: 0, total: 0 },
  registry: { count: 0, total: 0 },
  // What no card of its own counts (#145)
  other: { total: 0, products: [] },
  // The credit that the bills used, which pays for no product (#145)
  credits: { total: 0 },
  aiml: { count: 0, total: 0 },
  loadBalancers: { count: 0, total: 0 },
  ...fields,
});

export const publicCloud = {
  projectsEnriched: projects,

  // Read from the bills of the month; the counts of buckets, volumes and
  // snapshots from the inventory, of what existed by the end of the month
  publicCloudStats: {
    '2026-09': publicCloudFigures({
      instances: { total: 718.9 },
      volumes: { count: 3, total: 12.5 },
      snapshots: { count: 2, total: 6 },
      savingsPlans: { count: 2, total: 28 },
      objectStorage: { count: 3, total: 25 },
      registry: { count: 1, total: 40 },
    }),
    '2026-08': publicCloudFigures({
      instances: { total: 590.6 },
      volumes: { count: 3, total: 12.5 },
      snapshots: { count: 2, total: 6 },
      savingsPlans: { count: 2, total: 28 },
      objectStorage: { count: 2, total: 24.9 },
      registry: { count: 1, total: 40 },
    }),
  },

  // Without a period, that of the latest month imported
  projectConsumption: {
    [PRODUCTION]: { all: productionUsage },
    [STAGING]: { all: stagingUsage },
  },

  // What the bills of each month charged a project, product by product, which
  // the Compare tab compares (#181): with the credit, they add up to its cost
  // in the comparison by project (account.js). In August and September, the
  // two projects' add up to the cards above; Production used a credit in July.
  // Each product with its charges, which add up to its cost (#195): in
  // Production's instances, the GPU instance's hourly use grew in September,
  // the web instances' fell, down to the cost of db-1's monthly plan, that of
  // batch-1 went, and a b3-16 appeared.
  projectProducts: {
    [PRODUCTION]: {
      '2026-09': billedProducts(610.4, [
        ['instances', 538.9, [
          [hourlyUse('l4-90'), 420.5], [DB_1_PLAN, 64], [hourlyUse('b3-8'), 48],
          [hourlyUse('b3-16'), 6.4],
        ]],
        PRODUCTION_SAVINGS_PLANS,
        ['objectStorage', 25, [
          [bucketStorage('assets-example-com', 'gra'), 14], [COLD_ARCHIVE, 9],
          [bucketStorage('old-exports', 'sbg'), 2],
        ]],
        PRODUCTION_VOLUMES,
        PRODUCTION_SNAPSHOTS,
      ]),
      '2026-08': billedProducts(512, [
        ['instances', 440.6, [
          [hourlyUse('l4-90'), 304.6], [hourlyUse('b3-8'), 64], [DB_1_PLAN, 64],
          [hourlyUse('d2-4'), 8],
        ]],
        PRODUCTION_SAVINGS_PLANS,
        ['objectStorage', 24.9, [
          [bucketStorage('assets-example-com', 'gra'), 13.9], [COLD_ARCHIVE, 9],
          [bucketStorage('old-exports', 'sbg'), 2],
        ]],
        PRODUCTION_VOLUMES,
        PRODUCTION_SNAPSHOTS,
      ]),
      '2026-07': billedProducts(715, [
        ['instances', 650, [
          [hourlyUse('t2-45'), 522], [hourlyUse('b3-8'), 64], [DB_1_PLAN, 64],
        ]],
        ['databases', 45, [['Public Cloud Databases PostgreSQL business DB1-7 à gra', 45]]],
        ['objectStorage', 20, [
          [bucketStorage('assets-example-com', 'gra'), 11], [COLD_ARCHIVE, 9],
        ]],
      ], -35),
    },
    [STAGING]: {
      '2026-09': billedProducts(220, [
        ['instances', 180, [[hourlyUse('b3-16'), 180]]],
        ['registry', 40, [['Managed Private Registry - plan M', 40]]],
      ]),
      '2026-08': billedProducts(190, [
        ['instances', 150, [[hourlyUse('b3-16'), 150]]],
        ['registry', 40, [['Managed Private Registry - plan M', 40]]],
      ]),
    },
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
  // What its detail lists no section of its own for: its registry, which the registry card of
  // September counts (#145)
  projectOtherServices: {
    [PRODUCTION]: {
      '2026-09': { total: 40, products: [{ product: 'registry', total: 40 }], credits: 0 },
    },
  },
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
