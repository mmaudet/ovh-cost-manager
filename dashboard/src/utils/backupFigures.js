// The figures of the Backup tab, which its cards and its table read alike (#64): the Veeam
// VMs, from the backup statistics or, once these failed, from the month's costs by resource
// type, which sum the same bill lines; the Veeam Enterprise licenses, from the statistics
// only, the costs by resource type counting them among all licenses; and their total.
const backupFigures = (backupStats, byResourceType) => {
  const backup = byResourceType.find(r => r.resource_type === 'backup');
  const vms = {
    count: backupStats?.vms?.count || backup?.serviceCount || 0,
    cost: backupStats?.vms?.total || backup?.value || 0,
  };
  const enterprise = {
    count: backupStats?.enterprise?.count || 0,
    cost: backupStats?.enterprise?.total || 0,
  };
  return {
    vms,
    enterprise,
    total: { count: vms.count + enterprise.count, cost: vms.cost + enterprise.cost },
  };
};

export { backupFigures };
