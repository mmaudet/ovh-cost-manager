import { Fragment } from 'react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import Modal from '../components/Modal.jsx';
import TableActions from '../components/TableActions.jsx';
import { BucketsTable, bucketCsvColumns, sortBucketsByName } from '../components/BucketsTable.jsx';
import { SavingsPlansTable, savingsPlanCsvColumns } from '../components/SavingsPlansTable.jsx';
import { VolumesTable, volumeCsvColumns, volumeCsvRows } from '../components/VolumesTable.jsx';
import { SnapshotsTable, snapshotCsvColumns } from '../components/SnapshotsTable.jsx';
import {
  InstancesTable, instanceCsvColumns, instanceCsvRows
} from '../components/InstancesTable.jsx';
import { downloadCSV } from '../utils/csv.js';

// The Public Cloud tab, which the shell renders while it is active: what usePublicCloudTab()
// returns, with the shell's language, translations (t), amount format (fmt) and locale, the
// selected month, the selected project and its setter, and two of its queries that load at
// page start: the month's costs by resource type and its GPU costs.
const PublicCloudTab = ({
  projectsEnriched, publicCloudStats, projectConsumption, projectInstances, instanceCount,
  projectInstanceTotal, projectBuckets, projectVolumes, projectSnapshots, projectSavingsPlans,
  projectQuotas, setShowAllInstances, setShowAllBuckets, setShowAllVolumes,
  setShowAllSnapshots, setShowAllSavingsPlans,
  language, t, fmt, locale, selectedMonth, selectedProject, setSelectedProject,
  byResourceType, gpuSummary,
}) => (
  <div className="space-y-6">
    {/* Cloud Summary Cards */}
    <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
      <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
        <span className="text-gray-500 text-sm">{t('cloudProjects')}</span>
        <div className="text-3xl font-bold text-blue-600 mt-2">{byResourceType.find(r => r.resource_type === 'cloud_project')?.serviceCount || 0}</div>
      </div>
      <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
        <span className="text-gray-500 text-sm">{t('instances')}</span>
        <div className="text-3xl font-bold text-indigo-600 mt-2">
          {projectsEnriched.reduce((sum, p) => sum + (p.instance_count || 0), 0)}
        </div>
        {publicCloudStats?.instances?.total > 0 && (
          <p className="text-xs text-gray-400">{fmt(publicCloudStats.instances.total)}€</p>
        )}
      </div>
      <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
        <span className="text-gray-500 text-sm">{language === 'en' ? 'GPU Instances' : 'Instances GPU'}</span>
        <div className="text-3xl font-bold text-purple-600 mt-2">{gpuSummary?.instances?.length || 0}</div>
      </div>
      <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
        <span className="text-gray-500 text-sm">Kubernetes</span>
        <div className="text-3xl font-bold text-cyan-600 mt-2">{publicCloudStats?.kubernetes?.count || 0}</div>
        {publicCloudStats?.kubernetes?.total > 0 && (
          <p className="text-xs text-gray-400">{fmt(publicCloudStats.kubernetes.total)}€</p>
        )}
      </div>
      <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
        <span className="text-gray-500 text-sm">{language === 'en' ? 'Object Storage' : 'Stockage Objet'}</span>
        <div className="text-3xl font-bold text-green-600 mt-2">{publicCloudStats?.objectStorage?.count || 0}</div>
        {publicCloudStats?.objectStorage?.total > 0 && (
          <p className="text-xs text-gray-400">{fmt(publicCloudStats.objectStorage.total)}€</p>
        )}
      </div>
      <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
        <span className="text-gray-500 text-sm">{language === 'en' ? 'Volumes' : 'Volumes'}</span>
        <div className="text-3xl font-bold text-teal-600 mt-2">{publicCloudStats?.volumes?.count || 0}</div>
        {publicCloudStats?.volumes?.total > 0 && (
          <p className="text-xs text-gray-400">{fmt(publicCloudStats.volumes.total)}€</p>
        )}
      </div>
      <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
        <span className="text-gray-500 text-sm">Snapshots</span>
        <div className="text-3xl font-bold text-amber-600 mt-2">{publicCloudStats?.snapshots?.count || 0}</div>
        {publicCloudStats?.snapshots?.total > 0 && (
          <p className="text-xs text-gray-400">{fmt(publicCloudStats.snapshots.total)}€</p>
        )}
      </div>
      <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
        <span className="text-gray-500 text-sm">{language === 'en' ? 'Savings plans' : 'Savings plans'}</span>
        <div className="text-3xl font-bold text-rose-600 mt-2">{publicCloudStats?.savingsPlans?.count || 0}</div>
        {publicCloudStats?.savingsPlans?.total > 0 && (
          <p className="text-xs text-gray-400">{fmt(publicCloudStats.savingsPlans.total)}€</p>
        )}
      </div>
      <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
        <span className="text-gray-500 text-sm">{language === 'en' ? 'Container Registry' : 'Registre'}</span>
        <div className="text-3xl font-bold text-orange-600 mt-2">{publicCloudStats?.registry?.count || 0}</div>
        {publicCloudStats?.registry?.total > 0 && (
          <p className="text-xs text-gray-400">{fmt(publicCloudStats.registry.total)}€</p>
        )}
      </div>
    </div>

    {/* Cloud Projects Table with inline detail */}
    {projectsEnriched.length > 0 && (
      <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
        <h3 className="font-semibold text-gray-900 mb-4">{t('cloudProjects')}</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-gray-50">
                <th className="p-3 text-left font-medium">{language === 'en' ? 'Name' : 'Nom'}</th>
                <th className="p-3 text-left font-medium">{t('state')}</th>
                <th className="p-3 text-right font-medium">{t('instances')}</th>
                <th className="p-3 text-right font-medium">{language === 'en' ? 'Current consumption' : 'Consommation en cours'}</th>
                <th className="p-3 text-center font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {projectsEnriched.map(p => (
                <Fragment key={p.id}>
                  <tr
                    className={`border-b hover:bg-gray-50 cursor-pointer ${selectedProject?.id === p.id ? 'bg-blue-50' : ''}`}
                    onClick={() => setSelectedProject(selectedProject?.id === p.id ? null : p)}
                  >
                    <td className="p-3 font-medium">
                      <span className="text-blue-600">{p.name || p.id}</span>
                      {p.description && <div className="text-xs text-gray-400">{p.description}</div>}
                    </td>
                    <td className="p-3">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${p.status === 'ok' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700'}`}>
                        {p.status}
                      </span>
                    </td>
                    <td className="p-3 text-right">{p.instance_count || 0}</td>
                    <td className="p-3 text-right font-medium">
                      {p.consumption_total > 0 ? `${fmt(p.consumption_total)}€` : '-'}
                    </td>
                    <td className="p-3 text-center">
                      <span className="text-gray-400 text-lg">
                        {selectedProject?.id === p.id ? '▲' : '▼'}
                      </span>
                    </td>
                  </tr>
                  {selectedProject?.id === p.id && (
                    <tr>
                      <td colSpan="5" className="p-0">
                        <div className="bg-blue-50 border-l-4 border-blue-400 p-5">
                          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                            {/* Consumption by resource type */}
                            {(() => {
                              const byType = {};
                              projectConsumption.forEach(c => {
                                const key = c.resource_type || 'other';
                                byType[key] = (byType[key] || 0) + (c.total_price || 0);
                              });
                              const chartData = Object.entries(byType)
                                .map(([name, value]) => ({ name, value: Math.round(value * 100) / 100 }))
                                .sort((a, b) => b.value - a.value);
                              const typeColors = ['#3b82f6', '#ef4444', '#f59e0b', '#10b981', '#8b5cf6', '#ec4899', '#6b7280'];

                              return chartData.length > 0 ? (
                                <div>
                                  <h4 className="font-medium text-gray-700 mb-3">
                                    {language === 'en' ? 'Consumption by resource' : 'Consommation par ressource'}
                                  </h4>
                                  <ResponsiveContainer width="100%" height={220}>
                                    <PieChart>
                                      <Pie
                                        data={chartData}
                                        cx="50%"
                                        cy="50%"
                                        outerRadius={80}
                                        innerRadius={35}
                                        dataKey="value"
                                        nameKey="name"
                                        label={({ name, value }) => `${name}: ${fmt(value)}€`}
                                      >
                                        {chartData.map((_, i) => (
                                          <Cell key={i} fill={typeColors[i % typeColors.length]} />
                                        ))}
                                      </Pie>
                                      <Tooltip formatter={(v) => `${fmt(v)}€`} />
                                    </PieChart>
                                  </ResponsiveContainer>
                                </div>
                              ) : (
                                <div className="flex items-center justify-center h-32 text-gray-400 text-sm">
                                  {language === 'en' ? 'No consumption data' : 'Pas de données de consommation'}
                                </div>
                              );
                            })()}

                            {/* Instances list */}
                            <div>
                              <h4 className="font-medium text-gray-700 mb-3 flex items-center gap-2">
                                <span>
                                  {t('instances')} ({instanceCount})
                                  {projectInstanceTotal?.total > 0 && (
                                    <span className="ml-2 text-sm font-normal text-indigo-600">{fmt(projectInstanceTotal.total)}€</span>
                                  )}
                                </span>
                                {projectInstances.length > 0 && (
                                  <TableActions
                                    language={language}
                                    onShowAll={() => setShowAllInstances(true)}
                                    onExport={() => downloadCSV(
                                      instanceCsvRows(projectInstances, language),
                                      instanceCsvColumns(language),
                                      `ovh-instances-${selectedProject?.name || 'export'}`
                                    )}
                                  />
                                )}
                              </h4>
                              {projectInstances.length > 0 ? (
                                <div className="overflow-y-auto max-h-52 bg-white rounded-lg">
                                  <InstancesTable instances={projectInstances} language={language} t={t} fmt={fmt} />
                                </div>
                              ) : (
                                <div className="flex items-center justify-center h-16 text-gray-400 text-sm">
                                  {language === 'en' ? 'No instances' : 'Aucune instance'}
                                </div>
                              )}
                            </div>

                            {/* Buckets list */}
                            {projectBuckets.length > 0 && (
                              <div className="lg:col-span-2">
                                <h4 className="font-medium text-gray-700 mb-3 flex items-center gap-2">
                                  <span>
                                    Buckets ({projectBuckets.length})
                                    <span className="ml-2 text-sm font-normal text-green-600">
                                      {fmt(projectBuckets.reduce((sum, b) => sum + (b.total || 0), 0))}€
                                    </span>
                                  </span>
                                  <TableActions
                                    language={language}
                                    onShowAll={() => setShowAllBuckets(true)}
                                    onExport={() => downloadCSV(
                                      sortBucketsByName(projectBuckets),
                                      bucketCsvColumns(language),
                                      `ovh-buckets-${selectedMonth?.value || 'export'}`
                                    )}
                                  />
                                </h4>
                                {/* ~11 rows before scrolling */}
                                <div className="overflow-y-auto max-h-[400px] bg-white rounded-lg">
                                  <BucketsTable
                                    buckets={projectBuckets} language={language} t={t} fmt={fmt}
                                  />
                                </div>
                              </div>
                            )}

                            {/* Volumes */}
                            {projectVolumes.length > 0 && (
                              <div>
                                <h4 className="font-medium text-gray-700 mb-3 flex items-center gap-2">
                                  <span>
                                    Volumes ({projectVolumes.length})
                                    <span className="ml-2 text-sm font-normal text-teal-600">
                                      {fmt(projectVolumes.reduce((sum, v) => sum + (v.total || 0), 0))}€
                                    </span>
                                  </span>
                                  <TableActions
                                    language={language}
                                    onShowAll={() => setShowAllVolumes(true)}
                                    onExport={() => downloadCSV(
                                      volumeCsvRows(projectVolumes),
                                      volumeCsvColumns(language),
                                      `ovh-volumes-${selectedMonth?.value || 'export'}`
                                    )}
                                  />
                                </h4>
                                <div className="overflow-y-auto max-h-[400px] bg-white rounded-lg">
                                  <VolumesTable volumes={projectVolumes} language={language} t={t} fmt={fmt} />
                                </div>
                              </div>
                            )}

                            {/* Snapshots */}
                            {projectSnapshots.length > 0 && (
                              <div>
                                <h4 className="font-medium text-gray-700 mb-3 flex items-center gap-2">
                                  <span>
                                    Snapshots ({projectSnapshots.length})
                                    <span className="ml-2 text-sm font-normal text-amber-600">
                                      {fmt(projectSnapshots.reduce((sum, sn) => sum + (sn.total || 0), 0))}€
                                    </span>
                                  </span>
                                  <TableActions
                                    language={language}
                                    onShowAll={() => setShowAllSnapshots(true)}
                                    onExport={() => downloadCSV(
                                      projectSnapshots,
                                      snapshotCsvColumns(language),
                                      `ovh-snapshots-${selectedMonth?.value || 'export'}`
                                    )}
                                  />
                                </h4>
                                <div className="overflow-y-auto max-h-[400px] bg-white rounded-lg">
                                  <SnapshotsTable snapshots={projectSnapshots} language={language} t={t} fmt={fmt} locale={locale} />
                                </div>
                              </div>
                            )}

                            {/* Savings plans */}
                            {projectSavingsPlans.length > 0 && (
                              <div className="lg:col-span-2">
                                <h4 className="font-medium text-gray-700 mb-3 flex items-center gap-2">
                                  <span>
                                    Savings plans ({projectSavingsPlans.length})
                                    <span className="ml-2 text-sm font-normal text-rose-600">
                                      {fmt(projectSavingsPlans.reduce((sum, p) => sum + (p.total || 0), 0))}€
                                    </span>
                                  </span>
                                  <TableActions
                                    language={language}
                                    onShowAll={() => setShowAllSavingsPlans(true)}
                                    onExport={() => downloadCSV(
                                      projectSavingsPlans,
                                      savingsPlanCsvColumns(language),
                                      `ovh-savings-plans-${selectedMonth?.value || 'export'}`
                                    )}
                                  />
                                </h4>
                                <div className="overflow-y-auto max-h-[400px] bg-white rounded-lg">
                                  <SavingsPlansTable plans={projectSavingsPlans} language={language} fmt={fmt} />
                                </div>
                              </div>
                            )}
                          </div>

                          {/* Quotas — only regions with capacity */}
                          {(() => {
                            const activeQuotas = projectQuotas.filter(q => q.used_cores > 0 || q.used_instances > 0);
                            return activeQuotas.length > 0 ? (
                              <div className="mt-4">
                                <h4 className="font-medium text-gray-700 mb-3">
                                  {language === 'en' ? 'Quotas by region' : 'Quotas par région'}
                                </h4>
                                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                                  {activeQuotas.map(q => {
                                    const coreUsage = q.max_cores > 0 ? Math.round((q.used_cores / q.max_cores) * 100) : 0;
                                    return (
                                      <div key={`${q.project_id}-${q.region}`} className="bg-white rounded-lg p-3">
                                        <div className="font-medium text-xs text-gray-700 mb-2">{q.region}</div>
                                        <div className="text-xs text-gray-500">
                                          vCPU: {q.used_cores}/{q.max_cores}
                                        </div>
                                        <div className="w-full bg-gray-200 rounded-full h-1.5 mt-1">
                                          <div
                                            className={`h-1.5 rounded-full transition-all ${coreUsage > 80 ? 'bg-red-500' : coreUsage > 50 ? 'bg-amber-500' : 'bg-blue-500'}`}
                                            style={{ width: `${Math.min(coreUsage, 100)}%` }}
                                          />
                                        </div>
                                        <div className="text-xs text-gray-500 mt-1">
                                          {t('instances')}: {q.used_instances}/{q.max_instances}
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            ) : null;
                          })()}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    )}

  </div>
);

// The "show all" modals of the resources of the selected project, which the shell renders
// after the page column, whatever the active tab, so that their backdrop covers the whole
// page: see docs/adr/0001-tab-state-lives-in-the-dashboard-shell.md
const PublicCloudTabModals = ({
  showAllBuckets, setShowAllBuckets, showAllInstances, setShowAllInstances,
  showAllVolumes, setShowAllVolumes, showAllSnapshots, setShowAllSnapshots,
  showAllSavingsPlans, setShowAllSavingsPlans,
  projectBuckets, projectInstances, instanceCount, projectInstanceTotal, projectVolumes,
  projectSnapshots, projectSavingsPlans,
  language, t, fmt, locale, selectedMonth, selectedProject,
}) => (
  <>
    <Modal
      open={showAllBuckets}
      onClose={() => setShowAllBuckets(false)}
      maxWidth="max-w-5xl"
      title={
        <>
          Buckets ({projectBuckets.length})
          <span className="ml-2 text-sm font-normal text-green-600">
            {fmt(projectBuckets.reduce((sum, b) => sum + (b.total || 0), 0))}€
          </span>
          {selectedMonth?.label && (
            <span className="ml-2 text-sm font-normal text-gray-400">{selectedMonth.label}</span>
          )}
        </>
      }
      actions={
        <button
          onClick={() => downloadCSV(
            sortBucketsByName(projectBuckets),
            bucketCsvColumns(language),
            `ovh-buckets-${selectedMonth?.value || 'export'}`
          )}
          className="px-2 py-0.5 text-xs border border-gray-200 rounded hover:bg-gray-100"
        >
          CSV
        </button>
      }
    >
      <BucketsTable buckets={projectBuckets} language={language} t={t} fmt={fmt} />
    </Modal>

    <Modal
      open={showAllInstances}
      onClose={() => setShowAllInstances(false)}
      maxWidth="max-w-4xl"
      title={
        <>
          {t('instances')} ({instanceCount})
          {projectInstanceTotal?.total > 0 && (
            <span className="ml-2 text-sm font-normal text-indigo-600">{fmt(projectInstanceTotal.total)}€</span>
          )}
          {selectedProject?.name && (
            <span className="ml-2 text-sm font-normal text-gray-400">{selectedProject.name}</span>
          )}
        </>
      }
      actions={
        <TableActions
          language={language}
          onExport={() => downloadCSV(
            instanceCsvRows(projectInstances, language),
            instanceCsvColumns(language),
            `ovh-instances-${selectedProject?.name || 'export'}`
          )}
        />
      }
    >
      <InstancesTable instances={projectInstances} language={language} t={t} fmt={fmt} />
    </Modal>

    <Modal
      open={showAllVolumes}
      onClose={() => setShowAllVolumes(false)}
      maxWidth="max-w-5xl"
      title={
        <>
          Volumes ({projectVolumes.length})
          <span className="ml-2 text-sm font-normal text-teal-600">
            {fmt(projectVolumes.reduce((sum, v) => sum + (v.total || 0), 0))}€
          </span>
        </>
      }
      actions={
        <TableActions
          language={language}
          onExport={() => downloadCSV(
            volumeCsvRows(projectVolumes),
            volumeCsvColumns(language),
            `ovh-volumes-${selectedMonth?.value || 'export'}`
          )}
        />
      }
    >
      <VolumesTable volumes={projectVolumes} language={language} t={t} fmt={fmt} />
    </Modal>

    <Modal
      open={showAllSnapshots}
      onClose={() => setShowAllSnapshots(false)}
      maxWidth="max-w-5xl"
      title={
        <>
          Snapshots ({projectSnapshots.length})
          <span className="ml-2 text-sm font-normal text-amber-600">
            {fmt(projectSnapshots.reduce((sum, sn) => sum + (sn.total || 0), 0))}€
          </span>
        </>
      }
      actions={
        <TableActions
          language={language}
          onExport={() => downloadCSV(
            projectSnapshots,
            snapshotCsvColumns(language),
            `ovh-snapshots-${selectedMonth?.value || 'export'}`
          )}
        />
      }
    >
      <SnapshotsTable snapshots={projectSnapshots} language={language} t={t} fmt={fmt} locale={locale} />
    </Modal>

    <Modal
      open={showAllSavingsPlans}
      onClose={() => setShowAllSavingsPlans(false)}
      maxWidth="max-w-4xl"
      title={
        <>
          Savings plans ({projectSavingsPlans.length})
          <span className="ml-2 text-sm font-normal text-rose-600">
            {fmt(projectSavingsPlans.reduce((sum, p) => sum + (p.total || 0), 0))}€
          </span>
        </>
      }
      actions={
        <TableActions
          language={language}
          onExport={() => downloadCSV(
            projectSavingsPlans,
            savingsPlanCsvColumns(language),
            `ovh-savings-plans-${selectedMonth?.value || 'export'}`
          )}
        />
      }
    >
      <SavingsPlansTable plans={projectSavingsPlans} language={language} fmt={fmt} />
    </Modal>
  </>
);

export { PublicCloudTab, PublicCloudTabModals };
