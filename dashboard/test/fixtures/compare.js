import { account } from './account.js';
import { enterpriseLicence } from './backup.js';
import { infrastructure } from './infrastructure.js';

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
};
