// Veeam backups of the synthetic account per month, as
// /api/analysis/backup-stats answers. Nothing was backed up in July.
export const backup = {
  backupStats: {
    '2026-09': { vms: { count: 3, total: 90 }, enterprise: { count: 1, total: 25 } },
    '2026-08': { vms: { count: 2, total: 40 }, enterprise: { count: 0, total: 0 } },
  },
};
