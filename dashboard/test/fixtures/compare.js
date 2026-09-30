import { account, septemberInProgress } from './account.js';
import { severalAccounts, unnamedAccount } from './accounts.js';
import { enterpriseLicence } from './backup.js';
import { months } from './calendar.js';
import { infrastructure } from './infrastructure.js';
import { billedProducts, hourlyUse, publicCloudFigures } from './public-cloud.js';

// The figures of the Compare tab while September, the month of today, is in progress (#216):
// the bill that charges the dedicated server of account.js and the Veeam backups of two of its
// VMs each month has not come yet in September. What September billed so far lacks them, and
// what the routes answer with the projection of the month in progress (#218) counts them at their
// bill lines of August, their projected lines: 270 € for the server, 25 € and 15 € for the VMs,
// which each row gives as its projected part. Its projects, its domains, its licence and the
// backup of its new VM were billed. Every name, identifier and amount is made up.

// The services that the late bill charges, as the Infrastructure tab lists them for August
const [serverRental] = infrastructure.resourceTypeDetails.dedicated_server['2026-08'];
const [appBackup, dbBackup] = infrastructure.resourceTypeDetails.backup['2026-08'];
// The backup of the VM added in September, which its own bill of September charged
const filesBackup = infrastructure.resourceTypeDetails.backup['2026-09']
  .find(({ domain }) => domain.startsWith('vm-files-1'));

// A row of an answer with the projection, with its projected part: none by default
const withPart = (row, projected = 0) => ({ ...row, projected });

// The Public Cloud projects of account.js
const PRODUCTION = 'project-production';
const STAGING = 'project-staging';

/**
 * A project's products as the route answers them with the projection of the month in progress
 * (#219), from what the bills charged it: each product and charge with its projected part, and
 * the credit with its own, their whole cost for a project that projected lines alone make, none
 * for one that the month billed.
 * @param {object} products - What the route answers without the projection
 * @param {{ projected: boolean }} options - Whether projected lines make them
 * @returns {object}
 */
const productsWithParts = (products, { projected }) => {
  const partOf = (total) => (projected ? total : 0);
  return {
    total: products.total,
    projected: partOf(products.total),
    products: products.products.map((product) => ({
      ...withPart(product, partOf(product.total)),
      charges: product.charges.map((charge) => withPart(charge, partOf(charge.total))),
    })),
    credits: products.credits,
    projectedCredits: partOf(products.credits),
  };
};

const service = (name, value, color, detailsCount) => ({ name, value, color, detailsCount });
const COMPUTE = '#3b82f6';
const STORAGE = '#10b981';
const OTHER = '#6b7280';

const resourceType = (name, type, color, value, detailsCount, serviceCount) => ({
  name, resource_type: type, color, value, detailsCount, serviceCount,
});
const publicCloud = resourceType('Public Cloud', 'cloud_project', '#3b82f6', 830.4, 41, 2);
const domains = resourceType('Domains', 'domain', '#8b5cf6', 35, 4, 2);
const licenses = resourceType('Licenses', 'license', '#0891b2', 25, 1, 1);
const backups = (value, detailsCount) =>
  resourceType('Backup', 'backup', '#059669', value, detailsCount, detailsCount);

// September as billed so far: without the server, 270 €, nor the backups of the two VMs, 40 €
// and 30 €
const billedSummary = {
  ...account.summary['2026-09'],
  total: 910.4,
  nonCloudTotal: 80,
  dailyAverage: 30.35,
  billsCount: 2,
};

export const serverAndBackupsBilledLate = {
  summary: { ...account.summary, '2026-09': billedSummary },
  // With the server and the backups at their cost of August: 310 € projected
  projectedSummary: {
    '2026-09': {
      ...billedSummary,
      total: 1220.4,
      projected: 310,
      nonCloudTotal: 390,
      dailyAverage: 40.68,
      topProjects: billedSummary.topProjects.map((project) => withPart(project)),
    },
  },

  // The server under Compute, the backups under Storage
  byService: {
    ...account.byService,
    '2026-09': [
      service('Compute', 530.4, COMPUTE, 20),
      service('Other', 200, OTHER, 11),
      service('Storage', 180, STORAGE, 7),
    ],
  },
  projectedByService: {
    '2026-09': [
      withPart(service('Compute', 800.4, COMPUTE, 21), 270),
      withPart(service('Storage', 220, STORAGE, 9), 40),
      withPart(service('Other', 200, OTHER, 11)),
    ],
  },

  // No dedicated server billed yet, which only its projected line makes
  byResourceType: {
    ...account.byResourceType,
    '2026-09': [publicCloud, domains, licenses, backups(20, 1)],
  },
  projectedByResourceType: {
    '2026-09': [
      withPart(publicCloud),
      withPart(resourceType('Dedicated Servers', 'dedicated_server', '#ef4444', 270, 1, 1), 270),
      withPart(backups(60, 3), 40),
      withPart(domains),
      withPart(licenses),
    ],
  },

  resourceTypeDetails: {
    ...account.resourceTypeDetails,
    dedicated_server: { ...account.resourceTypeDetails.dedicated_server, '2026-09': [] },
    backup: { ...account.resourceTypeDetails.backup, '2026-09': [filesBackup] },
  },
  projectedResourceTypeDetails: {
    dedicated_server: { '2026-09': [withPart(serverRental, 270)] },
    backup: {
      '2026-09': [withPart(appBackup, 25), withPart(filesBackup), withPart(dbBackup, 15)],
    },
  },

  // The VMs backed up: the new one only, and the two others at their cost of August
  backupStats: {
    ...account.backupStats,
    '2026-09': { vms: { count: 1, total: 20 }, enterprise: { count: 1, total: 25 } },
  },
  projectedBackupStats: {
    '2026-09': {
      vms: { count: 3, total: 60, projected: 40 },
      enterprise: { count: 1, total: 25, projected: 0 },
    },
  },
  backupServices: {
    ...account.backupServices,
    '2026-09': { vms: [filesBackup], enterprise: [enterpriseLicence] },
  },
  projectedBackupServices: {
    '2026-09': {
      vms: [withPart(appBackup, 25), withPart(filesBackup), withPart(dbBackup, 15)],
      enterprise: [withPart(enterpriseLicence)],
    },
  },

  // Its projects, which September billed, and their products, without a projected part (#219)
  projectedByProject: {
    '2026-09': account.byProject['2026-09'].map((project) => withPart(project)),
  },
  projectedProjectProducts: Object.fromEntries([PRODUCTION, STAGING].map((project) => [
    project,
    {
      '2026-09': productsWithParts(account.projectProducts[project]['2026-09'], {
        projected: false,
      }),
    },
  ])),
};

// The figures of the Compare tab while September is in progress for its Staging project (#219):
// the bill that charges the project each month comes late in the month, and has not come yet in
// September. What September billed so far lacks its 220 €, and what the routes answer with the
// projection of the month in progress counts it at its bill lines of August, its projected
// lines: its instances, 170 €, its registry, 40 €, and the Public Cloud credit that they used,
// -20 €, which make its 190 € of August. The project, each of its products and charges, and the
// credit give their projected parts, their whole cost; Production, billed, gives none. Every other
// service of September was billed, as in account.js. Every name, identifier and amount is made
// up.

// What August's bill charged Staging, product by product, and the credit that it used
const stagingInAugust = billedProducts(210, [
  ['instances', 170, [[hourlyUse('b3-16'), 170]]],
  ['registry', 40, [['Managed Private Registry - plan M', 40]]],
], -20);

// The projects of September: Production, billed, and Staging, at its cost of August, which its 9
// lines of August make, its credit's included
const [production, staging] = account.byProject['2026-09'];
const stagingAtItsCostOfAugust = { ...staging, total: 190, detailsCount: 9 };

// September as billed so far: without Staging, 220 €
const septemberWithoutStaging = {
  ...account.summary['2026-09'],
  total: 1030.4,
  cloudTotal: 610.4,
  dailyAverage: 34.35,
  billsCount: 2,
  projectsCount: 1,
  topProjects: [{ name: 'Production', value: 610.4 }],
};
const [, ...otherResourceTypes] = account.byResourceType['2026-09'];

export const stagingBilledLate = {
  summary: { ...account.summary, '2026-09': septemberWithoutStaging },
  // With Staging at its cost of August: 190 € projected
  projectedSummary: {
    '2026-09': {
      ...septemberWithoutStaging,
      total: 1220.4,
      projected: 190,
      cloudTotal: 800.4,
      dailyAverage: 40.68,
      projectsCount: 2,
      topProjects: [
        { name: 'Production', value: 610.4, projected: 0 },
        { name: 'Staging', value: 190, projected: 190 },
      ],
    },
  },

  // Staging's instances and registry under Compute, its credit under Other
  byService: {
    ...account.byService,
    '2026-09': [
      service('Compute', 580.4, COMPUTE, 10),
      service('Storage', 250, STORAGE, 9),
      service('Other', 200, OTHER, 11),
    ],
  },
  projectedByService: {
    '2026-09': [
      withPart(service('Compute', 790.4, COMPUTE, 18), 210),
      withPart(service('Storage', 250, STORAGE, 9)),
      withPart(service('Other', 180, OTHER, 12), -20),
    ],
  },

  byResourceType: {
    ...account.byResourceType,
    '2026-09': [
      resourceType('Public Cloud', 'cloud_project', '#3b82f6', 610.4, 30, 1),
      ...otherResourceTypes,
    ],
  },
  projectedByResourceType: {
    '2026-09': [
      withPart(resourceType('Public Cloud', 'cloud_project', '#3b82f6', 800.4, 39, 2), 190),
      ...otherResourceTypes.map((row) => withPart(row)),
    ],
  },
  // The Veeam backups, billed
  projectedBackupStats: {
    '2026-09': {
      vms: withPart(account.backupStats['2026-09'].vms),
      enterprise: withPart(account.backupStats['2026-09'].enterprise),
    },
  },

  byProject: { ...account.byProject, '2026-09': [production] },
  projectedByProject: {
    '2026-09': [withPart(production), withPart(stagingAtItsCostOfAugust, 190)],
  },
  // Staging's products of August, and none of September
  projectProducts: { ...account.projectProducts, [STAGING]: { '2026-08': stagingInAugust } },
  projectedProjectProducts: {
    [PRODUCTION]: {
      '2026-09': productsWithParts(account.projectProducts[PRODUCTION]['2026-09'], {
        projected: false,
      }),
    },
    [STAGING]: { '2026-09': productsWithParts(stagingInAugust, { projected: true }) },
  },
  // The Public Cloud cards of September, without Staging's instances and registry
  publicCloudStats: {
    ...account.publicCloudStats,
    '2026-09': publicCloudFigures({
      instances: { total: 538.9 },
      volumes: { count: 3, total: 12.5 },
      snapshots: { count: 2, total: 6 },
      savingsPlans: { count: 2, total: 28 },
      objectStorage: { count: 3, total: 25 },
    }),
  },
};

// The accounts of accounts.js while the unnamed account, whose bills charge the Staging project,
// has not been billed for it yet in September (#219): September is in progress for that account,
// and so for all accounts, and complete for the Lyon subsidiary, whose bills of the month came in.
// All accounts' figures are those of stagingBilledLate above, and their projects by account
// those of Lyon, and with the projection, Staging of the unnamed account at its cost of August.
// The unnamed account's own are those that the Compare tab shows: its months, its totals, and
// its projects and their products.
const [september, august] = months;
const [lyonProduction, unnamedStaging] = severalAccounts.projectsByAccount['2026-09'];
const unnamedStagingAtItsCostOfAugust = { ...unnamedStaging, total: 190, detailsCount: 9 };
// The unnamed account's September as billed so far: without Staging, 220 €
const unnamedSeptemberWithoutStaging = {
  ...severalAccounts.ofAccount[unnamedAccount.id].summary['2026-09'],
  total: 140,
  cloudTotal: 0,
  dailyAverage: 4.67,
  projectsCount: 0,
  topProjects: [],
};

export const unnamedBilledLate = {
  ...severalAccounts,
  ...septemberInProgress,
  ...stagingBilledLate,
  projectsByAccount: { ...severalAccounts.projectsByAccount, '2026-09': [lyonProduction] },
  projectedProjectsByAccount: {
    '2026-09': [withPart(lyonProduction), withPart(unnamedStagingAtItsCostOfAugust, 190)],
  },
  ofAccount: {
    ...severalAccounts.ofAccount,
    [unnamedAccount.id]: {
      ...severalAccounts.ofAccount[unnamedAccount.id],
      months: [{ ...september, inProgress: true }, august],
      summary: {
        ...severalAccounts.ofAccount[unnamedAccount.id].summary,
        '2026-09': unnamedSeptemberWithoutStaging,
      },
      projectedSummary: {
        '2026-09': {
          ...unnamedSeptemberWithoutStaging,
          total: 330,
          projected: 190,
          cloudTotal: 190,
          dailyAverage: 11,
          projectsCount: 1,
          topProjects: [{ name: 'Staging', value: 190, projected: 190 }],
        },
      },
      byProject: { ...severalAccounts.ofAccount[unnamedAccount.id].byProject, '2026-09': [] },
      projectedByProject: { '2026-09': [withPart(stagingAtItsCostOfAugust, 190)] },
      projectProducts: { [STAGING]: { '2026-08': stagingInAugust } },
      projectedProjectProducts: {
        [STAGING]: { '2026-09': productsWithParts(stagingInAugust, { projected: true }) },
      },
    },
  },
};
