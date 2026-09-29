import { infrastructure } from './infrastructure.js';

// The VMs backed up, as the bill lines of the backups give them by service
const vms = infrastructure.resourceTypeDetails.backup;
// The Veeam Enterprise licence of September
const enterpriseLicence = {
  domain: '6f1d2c3b-4a5e-4f60-8b7c-9d0e1f2a3b4c',
  description: 'Veeam Enterprise Plus licence',
  total: 25,
  line_count: 1,
};

// Veeam backups of the synthetic account per month, as
// /api/analysis/backup-stats answers. Nothing was backed up in July. Their
// services, as /api/analysis/backup-services answers (#197), are as many as
// they count, and add up to their cost.
export const backup = {
  backupStats: {
    '2026-09': { vms: { count: 3, total: 90 }, enterprise: { count: 1, total: 25 } },
    '2026-08': { vms: { count: 2, total: 40 }, enterprise: { count: 0, total: 0 } },
  },
  backupServices: {
    '2026-09': { vms: vms['2026-09'], enterprise: [enterpriseLicence] },
    '2026-08': { vms: vms['2026-08'], enterprise: [] },
  },
};
