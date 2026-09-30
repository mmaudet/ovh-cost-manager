import { Fragment } from 'react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import { FIGURE_CARD, TAB_FIGURE } from '../components/figureCards.js';
import Modal from '../components/Modal.jsx';
import { pieLabel, pieLabelLine } from '../components/pieLabels.jsx';
import TableActions from '../components/TableActions.jsx';
import { SortableHeader, sortRows } from '../components/SortableHeader.jsx';
import { AiEndpointsByModel } from '../components/AiEndpointsByModel.jsx';
import { BucketsTable, bucketCsvColumns, sortBucketsByName } from '../components/BucketsTable.jsx';
import { SavingsPlansTable, savingsPlanCsvColumns } from '../components/SavingsPlansTable.jsx';
import { VolumesTable, volumeCsvColumns, volumeCsvRows } from '../components/VolumesTable.jsx';
import { SnapshotsTable, snapshotCsvColumns } from '../components/SnapshotsTable.jsx';
import {
  InstancesTable, instanceCsvColumns, instanceCsvRows
} from '../components/InstancesTable.jsx';
import { downloadCSV } from '../utils/csv.js';
import { formatMonthLabel, formatMonthName } from '../utils/format.js';
import { cloudKindLabel } from '../utils/cloudKinds.js';
import { projectListRows } from '../utils/projectList.js';
import { publicCloudProductLabel } from '../utils/publicCloudProducts.js';

// The Account column of the CSV files of the open project's resources (#121): when the lists
// show the column, its label and the name of the project's account, as the list gives it; a
// project's resources belong to its account. Null otherwise, and while no project is open.
const openProjectAccountOf = (accountColumn, projectsEnriched, openProject) => {
  const project = projectsEnriched.find(({ id }) => id === openProject?.id);
  if (!accountColumn || !project) return null;
  return { label: accountColumn.label, name: accountColumn.nameOf(project.account) };
};

// The value of a project in each column that sorts the list (#146): its account, none without
// the Account column, no consumption for a project that consumed nothing, and no amount billed
// for a project that no bill line of the month names (#180), which the list shows as "-". A
// project billed that the inventory of the account lacks has no state, instance count or
// consumption there.
const projectValues = (accountColumn) => ({
  name: (p) => p.name || p.id,
  account: (p) => accountColumn?.nameOf(p.account),
  state: (p) => p.status,
  instances: (p) => (p.inInventory ? p.instance_count || 0 : null),
  consumption: (p) => (p.consumption_total > 0 ? p.consumption_total : null),
  billed: (p) => p.billed,
});

// The row of a project billed in the month that the list lacks, as the inventory of the account
// whose bills charged it lacks it (#180): its name, marked as a bucket billed but gone from the
// inventory is, and its id, as the server may not name it; that account in the Account column,
// and what the month billed it. The list has none of its resources: it has no detail to open.
const ProjectNotInInventoryRow = ({ project, accountColumn, t, fmt }) => (
  <tr className="border-b opacity-60">
    <td className="p-3 font-medium">
      <span>{project.name}</span>
      <span className="ml-1 text-gray-400" title={t('projectNotInInventory')}>†</span>
      <div className="text-xs text-gray-400">{project.id}</div>
    </td>
    {accountColumn && (
      <td className="p-3 text-gray-600">{accountColumn.nameOf(project.account)}</td>
    )}
    <td className="p-3">-</td>
    <td className="p-3 text-right">-</td>
    <td className="p-3 text-right font-medium">-</td>
    <td className="p-3 text-right font-medium">{fmt(project.billed)}€</td>
    <td className="p-3"></td>
  </tr>
);

// Downloads resources of the open project as a CSV file, with the Account column of the open
// project after the name of each resource, when there is one: the file leaves the project's
// row, which shows its account, behind.
const downloadResources = (openProjectAccount, rows, columns, filename) => {
  if (!openProjectAccount) {
    downloadCSV(rows, columns, filename);
    return;
  }
  const [name, ...others] = columns;
  downloadCSV(
    rows.map((row) => ({ ...row, account: openProjectAccount.name })),
    [name, { key: 'account', label: openProjectAccount.label }, ...others],
    filename,
  );
};

// The Public Cloud tab, which the shell renders while it is active: what usePublicCloudTab()
// returns, the open project and the sort order of its tables included (#146), with the shell's
// language, translations (t), amount format (fmt) and locale, the selected month, the setter of
// the selected project, and two of its queries that load at page start: the month's costs by
// resource type and its GPU costs. And what the month billed each project (billedProjects), which
// the list of projects gives next to their current consumption (#180): the costs by project of
// the account shown, or, while the lists name the account of each project, those by account of
// the Overview's breakdown (#118), which the shell picks, undefined until they load, and
// whether they could not (billedProjectsFailed). And the Account column of the lists, null when
// they show none (#121), and the cloud total of the selected month, which the cards and the list
// add up to (#145, #180).
const PublicCloudTab = ({
  projectsEnriched, projectsLoaded, publicCloudStats, projectConsumption, projectInstances,
  instanceCount, projectInstanceTotal, projectBuckets, projectVolumes, projectSnapshots,
  projectSavingsPlans, projectOtherServices, projectQuotas, aiEndpoints, setShowAllInstances,
  setShowAllBuckets, setShowAllVolumes, setShowAllSnapshots, setShowAllSavingsPlans, sortingOf,
  language, t, fmt, locale, selectedMonth, openProject, setSelectedProject,
  byResourceType, gpuSummary, billedProjects, billedProjectsFailed, accountColumn, cloudTotal,
}) => {
  // The Account column of the CSV files of the open project's resources, for all of them
  const openProjectAccount = openProjectAccountOf(accountColumn, projectsEnriched, openProject);
  // Whether what the month billed the projects has loaded: until then, as after a change of
  // month, or when it cannot load, the list gives no amount, rather than show that nothing was
  // billed, nor the total that the amounts add up to, nor the projects billed that it lacks
  const amountsLoaded = billedProjects !== undefined;
  // The projects of the account shown once they have loaded (projectsLoaded), with what the
  // month billed them, and those billed that the list lacks, in the order the user sorts them,
  // in the server's until then (#146)
  const projectSorting = sortingOf('projects');
  const projects = sortRows(
    projectsLoaded ? projectListRows(projectsEnriched, billedProjects ?? []) : [],
    projectSorting.sort, projectValues(accountColumn), language,
  );
  return (
    <div className="space-y-6">
      {/* What the cards add up to, and why it is not the current consumption (#145) */}
      {selectedMonth?.value && cloudTotal !== undefined && (
        <p className="text-sm text-gray-600">
          {language === 'en'
            ? `Public Cloud costs billed in ${formatMonthName(selectedMonth.value, language)}`
              + `: ${fmt(cloudTotal)}€, which the cards below break down. OVHcloud bills `
              + 'hourly usage the month after: the current consumption, at the top of the page '
              + 'and in the list of projects, is not billed yet.'
            : `Coûts Public Cloud facturés en ${formatMonthName(selectedMonth.value, language)}`
              + ` : ${fmt(cloudTotal)}€, que détaillent les cartes ci-dessous. OVHcloud `
              + 'facture la consommation à l\'heure le mois suivant : la consommation en cours, '
              + 'en haut de la page et dans la liste des projets, n\'est pas encore facturée.'}
        </p>
      )}

      {/* Cloud Summary Cards, two a row on a phone (see figureCards.js) */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        <div className={`${FIGURE_CARD} border border-gray-100`}>
          <span className="text-gray-500 text-sm">{t('cloudProjects')}</span>
          <div className={`${TAB_FIGURE} text-blue-600 mt-2`}>
            {byResourceType.find(r => r.resource_type === 'cloud_project')?.serviceCount || 0}
          </div>
        </div>
        <div className={`${FIGURE_CARD} border border-gray-100`}>
          <span className="text-gray-500 text-sm">{t('instances')}</span>
          <div className={`${TAB_FIGURE} text-indigo-600 mt-2`}>
            {projectsEnriched.reduce((sum, p) => sum + (p.instance_count || 0), 0)}
          </div>
          {publicCloudStats?.instances?.total > 0 && (
            <p className="text-xs text-gray-400">{fmt(publicCloudStats.instances.total)}€</p>
          )}
        </div>
        <div className={`${FIGURE_CARD} border border-gray-100`}>
          <span className="text-gray-500 text-sm">{language === 'en' ? 'GPU Instances' : 'Instances GPU'}</span>
          <div className={`${TAB_FIGURE} text-purple-600 mt-2`}>
            {gpuSummary?.instances?.length || 0}
          </div>
        </div>
        <div className={`${FIGURE_CARD} border border-gray-100`}>
          <span className="text-gray-500 text-sm">Kubernetes</span>
          <div className={`${TAB_FIGURE} text-cyan-600 mt-2`}>
            {publicCloudStats?.kubernetes?.count || 0}
          </div>
          {publicCloudStats?.kubernetes?.total > 0 && (
            <p className="text-xs text-gray-400">{fmt(publicCloudStats.kubernetes.total)}€</p>
          )}
        </div>
        <div className={`${FIGURE_CARD} border border-gray-100`}>
          <span className="text-gray-500 text-sm">{language === 'en' ? 'Object Storage' : 'Stockage Objet'}</span>
          <div className={`${TAB_FIGURE} text-green-600 mt-2`}>
            {publicCloudStats?.objectStorage?.count || 0}
          </div>
          {publicCloudStats?.objectStorage?.total > 0 && (
            <p className="text-xs text-gray-400">{fmt(publicCloudStats.objectStorage.total)}€</p>
          )}
        </div>
        <div className={`${FIGURE_CARD} border border-gray-100`}>
          <span className="text-gray-500 text-sm">{language === 'en' ? 'Volumes' : 'Volumes'}</span>
          <div className={`${TAB_FIGURE} text-teal-600 mt-2`}>
            {publicCloudStats?.volumes?.count || 0}
          </div>
          {publicCloudStats?.volumes?.total > 0 && (
            <p className="text-xs text-gray-400">{fmt(publicCloudStats.volumes.total)}€</p>
          )}
        </div>
        <div className={`${FIGURE_CARD} border border-gray-100`}>
          <span className="text-gray-500 text-sm">Snapshots</span>
          <div className={`${TAB_FIGURE} text-amber-600 mt-2`}>
            {publicCloudStats?.snapshots?.count || 0}
          </div>
          {publicCloudStats?.snapshots?.total > 0 && (
            <p className="text-xs text-gray-400">{fmt(publicCloudStats.snapshots.total)}€</p>
          )}
        </div>
        <div className={`${FIGURE_CARD} border border-gray-100`}>
          <span className="text-gray-500 text-sm">{language === 'en' ? 'Savings plans' : 'Savings plans'}</span>
          <div className={`${TAB_FIGURE} text-rose-600 mt-2`}>
            {publicCloudStats?.savingsPlans?.count || 0}
          </div>
          {publicCloudStats?.savingsPlans?.total > 0 && (
            <p className="text-xs text-gray-400">{fmt(publicCloudStats.savingsPlans.total)}€</p>
          )}
        </div>
        <div className={`${FIGURE_CARD} border border-gray-100`}>
          <span className="text-gray-500 text-sm">{language === 'en' ? 'Container Registry' : 'Registre'}</span>
          <div className={`${TAB_FIGURE} text-orange-600 mt-2`}>
            {publicCloudStats?.registry?.count || 0}
          </div>
          {publicCloudStats?.registry?.total > 0 && (
            <p className="text-xs text-gray-400">{fmt(publicCloudStats.registry.total)}€</p>
          )}
        </div>
        {/* What no card of its own counts: its products, and their cost (#145) */}
        <div className={`${FIGURE_CARD} border border-gray-100`}>
          <span className="text-gray-500 text-sm">{t('otherServices')}</span>
          <div className={`${TAB_FIGURE} text-slate-600 mt-2`}>
            {publicCloudStats?.other?.products?.length || 0}
          </div>
          {publicCloudStats?.other?.products?.length > 0 && (
            <p className="text-xs text-gray-400">{fmt(publicCloudStats.other.total)}€</p>
          )}
        </div>
      </div>
      {publicCloudStats?.other?.products?.length > 0 && (
        <p className="text-sm text-gray-600">
          {`${t('otherServices')}${language === 'en' ? ':' : ' :'} `}
          {publicCloudStats.other.products
            .map(({ product, total }) => `${publicCloudProductLabel(product, t)} ${fmt(total)}€`)
            .join(' · ')}
        </p>
      )}
      {/* The credit that the bills used, which pays for no product (#145) */}
      {publicCloudStats?.credits?.total ? (
        <p className="text-sm text-gray-600">
          {`${t('cloudCreditUsed')}${language === 'en' ? ':' : ' :'} `}
          {`${fmt(publicCloudStats.credits.total)}€`}
        </p>
      ) : null}

      {/* The AI Endpoints models of the month, the projects together (#193) */}
      {aiEndpoints?.models.length > 0 && (
        <AiEndpointsByModel
          aiEndpoints={aiEndpoints} sorting={sortingOf('aiEndpoints')}
          language={language} t={t} fmt={fmt}
        />
      )}

      {/* Cloud Projects Table with inline detail: the projects of the inventory, and those
          billed in the month that it lacks (#180) */}
      {projects.length > 0 && (
        <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
          <h3 className="font-semibold text-gray-900 mb-4">{t('cloudProjects')}</h3>
          {/* A query container, which an open project's detail keeps to (#226) */}
          <div className="overflow-x-auto [container-type:inline-size]">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-gray-50">
                  <SortableHeader
                    column="name" kind="text" sorting={projectSorting} t={t}
                    className="p-3 text-left font-medium"
                  >
                    {language === 'en' ? 'Name' : 'Nom'}
                  </SortableHeader>
                  {accountColumn && (
                    <SortableHeader
                      column="account" kind="text" sorting={projectSorting} t={t}
                      className="p-3 text-left font-medium"
                    >
                      {accountColumn.label}
                    </SortableHeader>
                  )}
                  <SortableHeader
                    column="state" kind="text" sorting={projectSorting} t={t}
                    className="p-3 text-left font-medium"
                  >
                    {t('state')}
                  </SortableHeader>
                  <SortableHeader
                    column="instances" kind="number" sorting={projectSorting} t={t}
                    className="p-3 text-right font-medium"
                  >
                    {t('instances')}
                  </SortableHeader>
                  <SortableHeader
                    column="consumption" kind="number" sorting={projectSorting} t={t}
                    className="p-3 text-right font-medium"
                  >
                    {language === 'en' ? 'Current consumption' : 'Consommation en cours'}
                  </SortableHeader>
                  <SortableHeader
                    column="billed" kind="number" sorting={projectSorting} t={t}
                    className="p-3 text-right font-medium"
                  >
                    {`${t('billedIn')} ${formatMonthName(selectedMonth?.value, language)}`}
                  </SortableHeader>
                  <th className="p-3 text-center font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {/* A project's detail shows right under it, whatever the order */}
                {projects.map(p => (!p.inInventory ? (
                  <ProjectNotInInventoryRow
                    key={`not in inventory ${p.id} ${p.account}`} project={p}
                    accountColumn={accountColumn} t={t} fmt={fmt}
                  />
                ) : (
                  <Fragment key={p.id}>
                    <tr
                      className={`border-b hover:bg-gray-50 cursor-pointer ${openProject?.id === p.id ? 'bg-blue-50' : ''}`}
                      onClick={() => setSelectedProject(openProject?.id === p.id ? null : p)}
                    >
                      <td className="p-3 font-medium">
                        <span className="text-blue-600">{p.name || p.id}</span>
                        {p.description && <div className="text-xs text-gray-400">{p.description}</div>}
                      </td>
                      {accountColumn && (
                        <td className="p-3 text-gray-600">{accountColumn.nameOf(p.account)}</td>
                      )}
                      <td className="p-3">
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${p.status === 'ok' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700'}`}>
                          {p.status}
                        </span>
                      </td>
                      <td className="p-3 text-right">{p.instance_count || 0}</td>
                      <td className="p-3 text-right font-medium">
                        {p.consumption_total > 0 ? `${fmt(p.consumption_total)}€` : '-'}
                      </td>
                      <td className="p-3 text-right font-medium">
                        {amountsLoaded && (p.billed === null ? '-' : `${fmt(p.billed)}€`)}
                      </td>
                      <td className="p-3 text-center">
                        <span className="text-gray-400 text-lg">
                          {openProject?.id === p.id ? '▲' : '▼'}
                        </span>
                      </td>
                    </tr>
                    {openProject?.id === p.id && (
                      <tr>
                        <td colSpan={accountColumn ? 7 : 6} className="p-0">
                          {/* Where the list scrolls sideways, as on a phone, the detail keeps
                              to the part of the list in view, as wide as its box (100cqw),
                              and held at its left edge, rather than span the whole table
                              (#226) */}
                          <div
                            className={'bg-blue-50 border-l-4 border-blue-400 p-5 sticky left-0'
                              + ' max-w-[100cqw]'}
                          >
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                              {/* Consumption by resource type */}
                              {(() => {
                                const byType = {};
                                projectConsumption.forEach(c => {
                                  const key = c.resource_type || 'other';
                                  byType[key] = (byType[key] || 0) + (c.total_price || 0);
                                });
                                const chartData = Object.entries(byType)
                                  .map(([kind, value]) => ({
                                    kind,
                                    name: cloudKindLabel(kind, t),
                                    value: Math.round(value * 100) / 100,
                                  }))
                                  .sort((a, b) => b.value - a.value);
                                const typeColors = ['#3b82f6', '#ef4444', '#f59e0b', '#10b981', '#8b5cf6', '#ec4899', '#6b7280'];
                                const colorOf = (i) => typeColors[i % typeColors.length];
                                const heading = language === 'en'
                                  ? 'Consumption by resource'
                                  : 'Consommation par ressource';

                                return chartData.length > 0 ? (
                                  <div>
                                    <h4 className="font-medium text-gray-700 mb-3">{heading}</h4>
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
                                          label={pieLabel(
                                            ({ name, value }) => `${name}: ${fmt(value)}€`,
                                          )}
                                          labelLine={pieLabelLine}
                                        >
                                          {chartData.map((_, i) => (
                                            <Cell key={i} fill={colorOf(i)} />
                                          ))}
                                        </Pie>
                                        <Tooltip formatter={(v) => `${fmt(v)}€`} />
                                      </PieChart>
                                    </ResponsiveContainer>
                                    {/* Its legend, each resource with its amount, as those of
                                        the Overview: the pie leaves out the labels of its
                                        thinnest slices, and all of them on a phone (#226) */}
                                    <ul aria-label={heading} className="space-y-1 mt-2">
                                      {chartData.map((entry, i) => (
                                        <li
                                          key={entry.kind}
                                          className="flex items-center gap-2 text-sm"
                                        >
                                          <span
                                            className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                                            style={{ backgroundColor: colorOf(i) }}
                                          />
                                          <span className="text-gray-600">{entry.name}</span>
                                          <span className="ml-auto font-medium">
                                            {fmt(entry.value)}€
                                          </span>
                                        </li>
                                      ))}
                                    </ul>
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
                                      onExport={() => downloadResources(
                                        openProjectAccount,
                                        instanceCsvRows(projectInstances, language),
                                        instanceCsvColumns(language),
                                        `ovh-instances-${openProject?.name || 'export'}`
                                      )}
                                    />
                                  )}
                                </h4>
                                {projectInstances.length > 0 ? (
                                  <div className="overflow-y-auto max-h-52 bg-white rounded-lg">
                                    <InstancesTable
                                      instances={projectInstances}
                                      sorting={sortingOf('instances')}
                                      language={language} t={t} fmt={fmt}
                                    />
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
                                      onExport={() => downloadResources(
                                        openProjectAccount,
                                        sortBucketsByName(projectBuckets),
                                        bucketCsvColumns(language),
                                        `ovh-buckets-${selectedMonth?.value || 'export'}`
                                      )}
                                    />
                                  </h4>
                                  {/* ~11 rows before scrolling */}
                                  <div className="overflow-y-auto max-h-[400px] bg-white rounded-lg">
                                    <BucketsTable
                                      buckets={projectBuckets} sorting={sortingOf('buckets')}
                                      language={language} t={t} fmt={fmt}
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
                                      onExport={() => downloadResources(
                                        openProjectAccount,
                                        volumeCsvRows(projectVolumes),
                                        volumeCsvColumns(language),
                                        `ovh-volumes-${selectedMonth?.value || 'export'}`
                                      )}
                                    />
                                  </h4>
                                  <div className="overflow-y-auto max-h-[400px] bg-white rounded-lg">
                                    <VolumesTable
                                      volumes={projectVolumes} sorting={sortingOf('volumes')}
                                      language={language} t={t} fmt={fmt}
                                    />
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
                                      onExport={() => downloadResources(
                                        openProjectAccount,
                                        projectSnapshots,
                                        snapshotCsvColumns(language),
                                        `ovh-snapshots-${selectedMonth?.value || 'export'}`
                                      )}
                                    />
                                  </h4>
                                  <div className="overflow-y-auto max-h-[400px] bg-white rounded-lg">
                                    <SnapshotsTable
                                      snapshots={projectSnapshots}
                                      sorting={sortingOf('snapshots')}
                                      language={language} t={t} fmt={fmt} locale={locale}
                                    />
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
                                      onExport={() => downloadResources(
                                        openProjectAccount,
                                        projectSavingsPlans,
                                        savingsPlanCsvColumns(language),
                                        `ovh-savings-plans-${selectedMonth?.value || 'export'}`
                                      )}
                                    />
                                  </h4>
                                  <div className="overflow-y-auto max-h-[400px] bg-white rounded-lg">
                                    <SavingsPlansTable
                                      plans={projectSavingsPlans}
                                      sorting={sortingOf('savingsPlans')}
                                      language={language} t={t} fmt={fmt}
                                    />
                                  </div>
                                </div>
                              )}

                              {/* What no section of its own lists: its registry… (#145) */}
                              {(projectOtherServices.products.length > 0
                                || projectOtherServices.credits !== 0) && (
                                <div className="lg:col-span-2">
                                  <h4 className="font-medium text-gray-700 mb-3 flex items-center gap-2">
                                    <span>
                                      {t('otherServices')} ({projectOtherServices.products.length})
                                      <span className="ml-2 text-sm font-normal text-slate-600">
                                        {fmt(projectOtherServices.total)}€
                                      </span>
                                    </span>
                                  </h4>
                                  <table className="w-full text-sm bg-white rounded-lg">
                                    <tbody>
                                      {projectOtherServices.products.map(({ product, total }) => (
                                        <tr key={product} className="border-b">
                                          <td className="p-2">
                                            {publicCloudProductLabel(product, t)}
                                          </td>
                                          <td className="p-2 text-right">{fmt(total)}€</td>
                                        </tr>
                                      ))}
                                      {projectOtherServices.credits !== 0 && (
                                        <tr className="border-b text-gray-500">
                                          <td className="p-2">{t('cloudCreditUsed')}</td>
                                          <td className="p-2 text-right">
                                            {fmt(projectOtherServices.credits)}€
                                          </td>
                                        </tr>
                                      )}
                                    </tbody>
                                  </table>
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
                )))}
              </tbody>
              {/* What the column of the amounts billed adds up to: the month's Cloud total, as
                  under the Overview's breakdown by project (#180) */}
              {amountsLoaded && cloudTotal !== undefined && (
                <tfoot>
                  <tr className="bg-gray-50 font-semibold">
                    <td className="p-3" colSpan={accountColumn ? 5 : 4}>{t('cloudTotal')}</td>
                    <td className="p-3 text-right">{fmt(cloudTotal)}€</td>
                    <td className="p-3"></td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
          {/* Rather than blank amounts that could as well be loading (#62, #64) */}
          {billedProjectsFailed && (
            <p className="mt-3 text-sm text-red-500">{t('billedAmountsFailed')}</p>
          )}
        </div>
      )}

    </div>
  );
};

// The "show all" modals of the resources of the selected project, which the shell renders
// after the page column, whatever the active tab, so that their backdrop covers the whole
// page: see docs/adr/0001-tab-state-lives-in-the-dashboard-shell.md. Each sorts its table as
// the panel of the tab does (#146).
const PublicCloudTabModals = ({
  sortingOf, showAllBuckets, setShowAllBuckets, showAllInstances, setShowAllInstances,
  showAllVolumes, setShowAllVolumes, showAllSnapshots, setShowAllSnapshots,
  showAllSavingsPlans, setShowAllSavingsPlans,
  projectBuckets, projectInstances, instanceCount, projectInstanceTotal, projectVolumes,
  projectSnapshots, projectSavingsPlans, projectsEnriched,
  language, t, fmt, locale, selectedMonth, openProject, accountColumn,
}) => {
  // The Account column of the CSV files of the open project's resources, for all of them
  const openProjectAccount = openProjectAccountOf(accountColumn, projectsEnriched, openProject);
  return (
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
            {selectedMonth?.value && (
              <span className="ml-2 text-sm font-normal text-gray-400">
                {formatMonthLabel(selectedMonth.value, language)}
              </span>
            )}
          </>
        }
        actions={
          <button
            onClick={() => downloadResources(
              openProjectAccount,
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
        <BucketsTable
          buckets={projectBuckets} sorting={sortingOf('buckets')}
          language={language} t={t} fmt={fmt}
        />
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
            {openProject?.name && (
              <span className="ml-2 text-sm font-normal text-gray-400">{openProject.name}</span>
            )}
          </>
        }
        actions={
          <TableActions
            language={language}
            onExport={() => downloadResources(
              openProjectAccount,
              instanceCsvRows(projectInstances, language),
              instanceCsvColumns(language),
              `ovh-instances-${openProject?.name || 'export'}`
            )}
          />
        }
      >
        <InstancesTable
          instances={projectInstances} sorting={sortingOf('instances')}
          language={language} t={t} fmt={fmt}
        />
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
            onExport={() => downloadResources(
              openProjectAccount,
              volumeCsvRows(projectVolumes),
              volumeCsvColumns(language),
              `ovh-volumes-${selectedMonth?.value || 'export'}`
            )}
          />
        }
      >
        <VolumesTable
          volumes={projectVolumes} sorting={sortingOf('volumes')}
          language={language} t={t} fmt={fmt}
        />
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
            onExport={() => downloadResources(
              openProjectAccount,
              projectSnapshots,
              snapshotCsvColumns(language),
              `ovh-snapshots-${selectedMonth?.value || 'export'}`
            )}
          />
        }
      >
        <SnapshotsTable
          snapshots={projectSnapshots} sorting={sortingOf('snapshots')}
          language={language} t={t} fmt={fmt} locale={locale}
        />
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
            onExport={() => downloadResources(
              openProjectAccount,
              projectSavingsPlans,
              savingsPlanCsvColumns(language),
              `ovh-savings-plans-${selectedMonth?.value || 'export'}`
            )}
          />
        }
      >
        <SavingsPlansTable
          plans={projectSavingsPlans} sorting={sortingOf('savingsPlans')}
          language={language} t={t} fmt={fmt}
        />
      </Modal>
    </>
  );
};

export { PublicCloudTab, PublicCloudTabModals };
