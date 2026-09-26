import { describe, it, expect } from 'vitest';
import { backupFigures } from '../../src/utils/backupFigures.js';

// The figures of the Backup tab, which its cards and its table read alike (#64)

// The costs by resource type of a month, as /api/analysis/by-resource-type answers them:
// the backup bill lines of 3 Veeam VMs, and an Enterprise license among the licenses
const byResourceType = [
  { name: 'Public Cloud', resource_type: 'cloud_project', value: 830.4, serviceCount: 2 },
  { name: 'Backup', resource_type: 'backup', value: 90, serviceCount: 3 },
  { name: 'Licenses', resource_type: 'license', value: 25, serviceCount: 1 },
];
const nothing = {
  vms: { count: 0, cost: 0 },
  enterprise: { count: 0, cost: 0 },
  total: { count: 0, cost: 0 },
};

describe('backupFigures', () => {
  it('reads the VMs and the Enterprise licenses from the backup statistics (#64)', () => {
    const stats = { vms: { count: 3, total: 90 }, enterprise: { count: 1, total: 25 } };

    expect(backupFigures(stats, byResourceType)).toEqual({
      vms: { count: 3, cost: 90 },
      enterprise: { count: 1, cost: 25 },
      total: { count: 4, cost: 115 },
    });
  });

  it('reads the VMs from the costs by resource type without the statistics (#64)', () => {
    // The licenses are not told apart there: none is counted
    expect(backupFigures(undefined, byResourceType)).toEqual({
      vms: { count: 3, cost: 90 },
      enterprise: { count: 0, cost: 0 },
      total: { count: 3, cost: 90 },
    });
  });

  it('counts nothing in a month without backups (#64)', () => {
    const withoutBackups = byResourceType.filter((type) => type.resource_type !== 'backup');
    const stats = { vms: { count: 0, total: 0 }, enterprise: { count: 0, total: 0 } };

    expect(backupFigures(stats, withoutBackups)).toEqual(nothing);
    expect(backupFigures(undefined, withoutBackups)).toEqual(nothing);
  });
});
