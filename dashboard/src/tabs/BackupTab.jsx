import { backupFigures } from '../utils/backupFigures.js';
import { formatPercent } from '../utils/format.js';

// The Backup tab, which the shell renders while it is active: what useBackupTab() returns,
// with the shell's language, amount format (fmt) and selected month, and two of its
// queries that load at page start: the month's summary and its costs by resource type.
const BackupTab = ({
  backupStats, loadingBackup, failedBackup,
  language, fmt, selectedMonth, summary, byResourceType,
}) => {
  // Until the statistics arrive, the tab says it is loading, in the words of the page's
  // loading screen, as the Web Cloud tab does (#64)
  if (loadingBackup) {
    return (
      <div className="text-center text-gray-500 py-8">
        {language === 'en' ? 'Loading data...' : 'Chargement des données...'}
      </div>
    );
  }

  // What the cards and the table show, read once so that they read alike (#64)
  const figures = backupFigures(backupStats, byResourceType);
  // Whether the month has backup resources to list
  const hasBackups = byResourceType.some(r => r.resource_type === 'backup')
    || backupStats?.vms?.count > 0;

  return (
    <div className="space-y-6">
      {/* Once they failed, it says so, above what the costs by resource type still tell (#64) */}
      {failedBackup && (
        <div className="text-center text-red-600 py-8">
          {language === 'en'
            ? 'Could not load the Backup data.'
            : 'Impossible de charger les données Backup.'}
        </div>
      )}

      {/* Backup Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
          <span className="text-gray-500 text-sm">
            {language === 'en' ? 'Total Backup Cost' : 'Coût total backup'}
          </span>
          <div className="text-3xl font-bold text-emerald-600 mt-2">
            {fmt(figures.total.cost)}€
          </div>
        </div>
        <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
          <span className="text-gray-500 text-sm">
            {language === 'en' ? 'Veeam VMs' : 'VMs Veeam'}
          </span>
          <div className="text-3xl font-bold text-green-600 mt-2">
            {figures.vms.count}
          </div>
          {figures.vms.cost > 0 && (
            <p className="text-xs text-gray-400">{fmt(figures.vms.cost)}€</p>
          )}
        </div>
        <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
          <span className="text-gray-500 text-sm">
            {language === 'en' ? 'Veeam Enterprise Licenses' : 'Licences Veeam Enterprise'}
          </span>
          <div className="text-3xl font-bold text-teal-600 mt-2">
            {figures.enterprise.count}
          </div>
          {figures.enterprise.cost > 0 && (
            <p className="text-xs text-gray-400">{fmt(figures.enterprise.cost)}€</p>
          )}
        </div>
        <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
          <span className="text-gray-500 text-sm">
            {language === 'en' ? '% of Total Cost' : '% du coût total'}
          </span>
          <div className="text-3xl font-bold text-gray-600 mt-2">
            {/* In the number format of the language, and 0,0 % of a month without cost (#64) */}
            {formatPercent(
              (summary?.total || 0) > 0 ? figures.total.cost / summary.total : 0,
              language,
            )}
          </div>
        </div>
      </div>

      {/* Backup Details */}
      <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
        <h3 className="font-semibold text-gray-900 mb-4">
          {language === 'en' ? 'Backup Resources' : 'Ressources Backup'}
          {selectedMonth && (
            <span className="text-sm font-normal text-gray-400 ml-2">
              ({selectedMonth.label})
            </span>
          )}
        </h3>
        {hasBackups ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-gray-50">
                  <th className="p-3 text-left font-medium">
                    {language === 'en' ? 'Category' : 'Catégorie'}
                  </th>
                  <th className="p-3 text-right font-medium">
                    {language === 'en' ? 'Count' : 'Nombre'}
                  </th>
                  <th className="p-3 text-right font-medium">
                    {language === 'en' ? 'Cost' : 'Coût'}
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b hover:bg-gray-50">
                  <td className="p-3 font-medium">
                    {language === 'en' ? 'Veeam Backup VMs' : 'VMs Veeam Backup'}
                  </td>
                  <td className="p-3 text-right">{figures.vms.count}</td>
                  <td className="p-3 text-right font-medium">{fmt(figures.vms.cost)}€</td>
                </tr>
                {figures.enterprise.count > 0 && (
                  <tr className="border-b hover:bg-gray-50">
                    <td className="p-3 font-medium">
                      {language === 'en'
                        ? 'Veeam Enterprise License'
                        : 'Licence Veeam Enterprise'}
                    </td>
                    <td className="p-3 text-right">{figures.enterprise.count}</td>
                    <td className="p-3 text-right font-medium">
                      {fmt(figures.enterprise.cost)}€
                    </td>
                  </tr>
                )}
              </tbody>
              <tfoot>
                <tr className="bg-gray-50 font-semibold">
                  <td className="p-3">Total</td>
                  <td className="p-3 text-right">{figures.total.count}</td>
                  <td className="p-3 text-right">{fmt(figures.total.cost)}€</td>
                </tr>
              </tfoot>
            </table>
          </div>
        ) : (
          <div className="text-center text-gray-400 py-8">
            {language === 'en'
              ? 'No backup services found for this period'
              : 'Aucun service de backup trouvé pour cette période'}
          </div>
        )}
      </div>
    </div>
  );
};

export { BackupTab };
