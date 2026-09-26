import { formatPercent } from '../utils/format.js';

// The Veeam VMs of the month, for the VMs row of the backup resources and their Total: from
// the backup statistics or, while they are missing (loading, or an error), from the costs
// by resource type, which sum the same bill lines (#64)
const veeamVms = (backupStats, byResourceType) => {
  const backup = byResourceType.find(r => r.resource_type === 'backup');
  return {
    count: backupStats?.vms?.count || backup?.serviceCount || 0,
    total: backupStats?.vms?.total || backup?.value || 0,
  };
};

// The Backup tab, which the shell renders while it is active: what useBackupTab() returns,
// with the shell's language, amount format (fmt) and selected month, and two of its
// queries that load at page start: the month's summary and its costs by resource type.
const BackupTab = ({
  backupStats,
  language, fmt, selectedMonth, summary, byResourceType,
}) => (
  <div className="space-y-6">
    {/* Backup Summary Cards */}
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
        <span className="text-gray-500 text-sm">{language === 'en' ? 'Total Backup Cost' : 'Coût total backup'}</span>
        <div className="text-3xl font-bold text-emerald-600 mt-2">
          {fmt((backupStats?.vms?.total || 0) + (backupStats?.enterprise?.total || 0))}€
        </div>
      </div>
      <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
        <span className="text-gray-500 text-sm">{language === 'en' ? 'Veeam VMs' : 'VMs Veeam'}</span>
        <div className="text-3xl font-bold text-green-600 mt-2">{backupStats?.vms?.count || 0}</div>
        {backupStats?.vms?.total > 0 && (
          <p className="text-xs text-gray-400">{fmt(backupStats.vms.total)}€</p>
        )}
      </div>
      <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
        <span className="text-gray-500 text-sm">{language === 'en' ? 'Veeam Enterprise Licenses' : 'Licences Veeam Enterprise'}</span>
        <div className="text-3xl font-bold text-teal-600 mt-2">{backupStats?.enterprise?.count || 0}</div>
        {backupStats?.enterprise?.total > 0 && (
          <p className="text-xs text-gray-400">{fmt(backupStats.enterprise.total)}€</p>
        )}
      </div>
      <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
        <span className="text-gray-500 text-sm">{language === 'en' ? '% of Total Cost' : '% du coût total'}</span>
        <div className="text-3xl font-bold text-gray-600 mt-2">
          {/* In the number format of the language, and 0,0 % of a month without cost (#64) */}
          {formatPercent(
            (summary?.total || 0) > 0
              ? ((backupStats?.vms?.total || 0) + (backupStats?.enterprise?.total || 0))
                / summary.total
              : 0,
            language,
          )}
        </div>
      </div>
    </div>

    {/* Backup Details */}
    <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
      <h3 className="font-semibold text-gray-900 mb-4">
        {language === 'en' ? 'Backup Resources' : 'Ressources Backup'}
        {selectedMonth && <span className="text-sm font-normal text-gray-400 ml-2">({selectedMonth.label})</span>}
      </h3>
      {(byResourceType.find(r => r.resource_type === 'backup') || backupStats?.vms?.count > 0) ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-gray-50">
                <th className="p-3 text-left font-medium">{language === 'en' ? 'Category' : 'Catégorie'}</th>
                <th className="p-3 text-right font-medium">{language === 'en' ? 'Count' : 'Nombre'}</th>
                <th className="p-3 text-right font-medium">{language === 'en' ? 'Cost' : 'Coût'}</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b hover:bg-gray-50">
                <td className="p-3 font-medium">{language === 'en' ? 'Veeam Backup VMs' : 'VMs Veeam Backup'}</td>
                <td className="p-3 text-right">{veeamVms(backupStats, byResourceType).count}</td>
                <td className="p-3 text-right font-medium">
                  {fmt(veeamVms(backupStats, byResourceType).total)}€
                </td>
              </tr>
              {backupStats?.enterprise?.count > 0 && (
                <tr className="border-b hover:bg-gray-50">
                  <td className="p-3 font-medium">{language === 'en' ? 'Veeam Enterprise License' : 'Licence Veeam Enterprise'}</td>
                  <td className="p-3 text-right">{backupStats.enterprise.count}</td>
                  <td className="p-3 text-right font-medium">{fmt(backupStats.enterprise.total)}€</td>
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr className="bg-gray-50 font-semibold">
                <td className="p-3">Total</td>
                <td className="p-3 text-right">
                  {veeamVms(backupStats, byResourceType).count
                    + (backupStats?.enterprise?.count || 0)}
                </td>
                <td className="p-3 text-right">
                  {fmt(veeamVms(backupStats, byResourceType).total
                    + (backupStats?.enterprise?.total || 0))}€
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      ) : (
        <div className="text-center text-gray-400 py-8">
          {language === 'en' ? 'No backup services found for this period' : 'Aucun service de backup trouvé pour cette période'}
        </div>
      )}
    </div>
  </div>
);

export { BackupTab };
