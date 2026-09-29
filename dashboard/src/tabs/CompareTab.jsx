import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import Accordion from '../components/Accordion.jsx';
import { SortableHeader, sortRows } from '../components/SortableHeader.jsx';
import ProjectProductComparison from '../components/ProjectProductComparison.jsx';
import { ResourceTypeServices } from '../components/ResourceTypeServices.jsx';
import { UnfoldingRow } from '../components/UnfoldingRow.jsx';
import { Variation } from '../components/Variation.jsx';
import { formatMonthLabel } from '../utils/format.js';
import { firstRowOfEachProject, projectComparisonRows } from '../utils/projectComparison.js';
import { variationPercent } from '../utils/variation.js';

// The cost of a resource type in a month, from its costs by resource type (#32)
const costOfType = (byResourceType, type) => (
  byResourceType.find(r => r.resource_type === type)?.value || 0
);

// The Veeam VMs or Enterprise licences of a month, from its backups (#32): their number and
// their cost
const backupsOf = (backupStats, kind) => ({
  count: backupStats?.[kind]?.count || 0,
  total: backupStats?.[kind]?.total || 0,
});

// The value of a resource type of the infrastructure comparison in each column that sorts it
// (#146), from the costs by resource type of months A and B: its label, its cost in each month,
// and the variation from one to the other, none from 0 € or less
const resourceTypeValues = (byResourceTypeA, byResourceTypeB) => ({
  type: ({ label }) => label,
  totalA: ({ key }) => costOfType(byResourceTypeA, key),
  totalB: ({ key }) => costOfType(byResourceTypeB, key),
  variation: ({ key }) => variationPercent(
    costOfType(byResourceTypeA, key), costOfType(byResourceTypeB, key),
  ),
});

// The value of a service in the same columns, which sort the services of each row of the
// infrastructure comparison as they sort the rows (#192): its identifier, its cost in each
// month, and the variation from one to the other, none from 0 € or less. The comparisons that
// do not sort, of the Private Cloud and of the backups (#197), order their services by their
// costs in months A and B alone.
const SERVICE_VALUES = {
  type: (service) => service.identifier,
  totalA: (service) => service.valA,
  totalB: (service) => service.valB,
  variation: (service) => variationPercent(service.valA, service.valB),
};

// The columns of the infrastructure, Private Cloud and backup comparisons: the row, the cost in
// months A and B, and the variation
const COMPARISON_COLUMNS = 4;

// The value of a row of the comparison by project in each column that sorts it (#146): its
// account, none without the Account column
const projectComparisonValues = (accountColumn) => ({
  name: (row) => row.projectName,
  account: (row) => accountColumn?.nameOf(row.account),
  totalA: (row) => row.totalA,
  totalB: (row) => row.totalB,
  variation: (row) => row.variation,
});

// The Compare tab, which the shell renders while it is active: what useCompareTab() returns,
// the sort order of its tables, the query of a project's products, the rows unfolded into their
// services and the queries of those services included (#146, #181, #192, #197), with the
// shell's language, translations (t), amount format (fmt) and months list. The months and their
// figures are those of the account selected in the header (#119). The comparison by project
// names the account of each project in the Account column of the shell (accountColumn), when it
// shows one: it then compares the projects by account that the hook requests, a project billed
// to several accounts once for each.
const CompareTab = ({
  compareMonthA, setCompareMonthA, compareMonthB, setCompareMonthB, sortingOf, unfoldingOf,
  compareDataA, compareDataB, byServiceA, byServiceB, byProjectA, byProjectB,
  byResourceTypeA, byResourceTypeB, backupStatsA, backupStatsB, projectProductsQuery,
  resourceTypeServicesQuery, backupServicesQuery, language, t, fmt, months, accountColumn,
}) => {
  // Months A and B as the page names them, in its language (#33)
  const monthALabel = formatMonthLabel(compareMonthA?.value, language);
  const monthBLabel = formatMonthLabel(compareMonthB?.value, language);

  // The projects of months A and B, paired by id (#55), and by account in the Account column
  // (#119), in the order the user sorts them, by month A until then (#146)
  const projectSorting = sortingOf('projects');
  const compareProjects = sortRows(
    projectComparisonRows(byProjectA, byProjectB), projectSorting.sort,
    projectComparisonValues(accountColumn), language,
  );
  // The projects whose products the tab compares (#181), once each, in the order of their
  // first rows: in the Account column, a project billed to several accounts has a row for each
  // (#119)
  const detailedProjects = firstRowOfEachProject(compareProjects);

  // Comparison chart data
  const comparisonChartData = byServiceA.map((s) => {
    const matchB = byServiceB.find(b => b.name === s.name);
    return {
      name: s.name,
      moisA: s.value,
      moisB: matchB?.value || 0
    };
  });

  // The rows of the Private Cloud comparison, which the infrastructure comparison ends with
  const privateCloudTypes = [
    {
      key: 'private_cloud_host',
      label: language === 'en' ? 'Private Cloud Hosts' : 'Hôtes Private Cloud',
    },
    {
      key: 'private_cloud_datastore',
      label: language === 'en' ? 'Private Cloud Datastores' : 'Datastores Private Cloud',
    },
  ];

  // The rows of the infrastructure comparison, which ends with those of the Private Cloud
  // comparison, in the order the user sorts them, in this order until then (#146)
  const infrastructureSorting = sortingOf('infrastructure');
  const infrastructureTypes = sortRows([
    { key: 'dedicated_server', label: t('dedicatedServers') },
    { key: 'vps', label: 'VPS' },
    { key: 'storage', label: language === 'en' ? 'Storage' : 'Stockage' },
    { key: 'load_balancer', label: language === 'en' ? 'Load Balancer' : 'Load Balancer' },
    { key: 'ip_service', label: language === 'en' ? 'IP Addresses' : 'Adresses IP' },
    { key: 'domain', label: language === 'en' ? 'Domains' : 'Noms de domaine' },
    ...privateCloudTypes,
  ], infrastructureSorting.sort, resourceTypeValues(byResourceTypeA, byResourceTypeB), language);

  // Draws a row of the infrastructure or Private Cloud comparison, by the comparison's name: the
  // cost of a resource type in months A and B (#32). It unfolds into its services when either
  // month billed it more than 0 €, as each service that it lists, and they follow the
  // comparison's sort; each comparison's rows unfold on their own (#192).
  const drawResourceTypeRow = (comparison, { key, label }) => {
    const valA = costOfType(byResourceTypeA, key);
    const valB = costOfType(byResourceTypeB, key);
    return (
      <UnfoldingRow
        key={key}
        unfolding={valA > 0 || valB > 0 ? unfoldingOf(comparison, key) : null}
        chevronLabel={`${t('servicesOf')} ${label}`}
        label={label}
        detail={(
          <ResourceTypeServices
            servicesQuery={(month) => resourceTypeServicesQuery(key, month)}
            monthA={compareMonthA} monthB={compareMonthB} sort={sortingOf(comparison).sort}
            values={SERVICE_VALUES} columnCount={COMPARISON_COLUMNS}
            accountColumn={accountColumn} fmt={fmt} language={language} t={t}
          />
        )}
      >
        <td className="p-3 text-right font-medium">{fmt(valA)}€</td>
        <td className="p-3 text-right text-gray-500">{fmt(valB)}€</td>
        <td className="p-3 text-right">
          <Variation from={valA} to={valB} language={language} t={t} />
        </td>
      </UnfoldingRow>
    );
  };

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
        <div className="flex items-center justify-center gap-4 md:gap-6 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="font-medium text-gray-700 text-sm">{t('monthA')} :</span>
            <select
              value={compareMonthA?.value || ''}
              onChange={(e) => {
                const month = months.find(m => m.value === e.target.value);
                setCompareMonthA(month);
              }}
              className="px-3 py-2 bg-blue-50 border border-blue-200 rounded-lg text-sm font-medium text-blue-700"
            >
              {months.map(m => (
                <option key={m.value} value={m.value}>
                  {formatMonthLabel(m.value, language)}
                </option>
              ))}
            </select>
          </div>
          <span className="text-2xl font-bold text-gray-300">{t('vs')}</span>
          <div className="flex items-center gap-2">
            <span className="font-medium text-gray-700 text-sm">{t('monthB')} :</span>
            <select
              value={compareMonthB?.value || ''}
              onChange={(e) => {
                const month = months.find(m => m.value === e.target.value);
                setCompareMonthB(month);
              }}
              className="px-3 py-2 bg-gray-100 border border-gray-200 rounded-lg text-sm"
            >
              {months.map(m => (
                <option key={m.value} value={m.value}>
                  {formatMonthLabel(m.value, language)}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex items-center justify-center gap-6 md:gap-8 mt-8">
          <div className="text-center">
            <div className="text-3xl md:text-4xl font-bold text-blue-600">
              {fmt(compareDataA?.total || 0)}€
            </div>
            <div className="text-gray-500 mt-1 text-sm">{monthALabel}</div>
          </div>
          <div className="flex flex-col items-center">
            {/* From the total of month A to that of month B, once both are in */}
            {compareDataA && compareDataB && (
              <Variation
                from={compareDataA.total} to={compareDataB.total} language={language} t={t}
                size="headline"
              />
            )}
          </div>
          <div className="text-center">
            <div className="text-3xl md:text-4xl font-bold text-gray-400">
              {fmt(compareDataB?.total || 0)}€
            </div>
            <div className="text-gray-500 mt-1 text-sm">{monthBLabel}</div>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
        <h3 className="font-semibold text-gray-900 mb-4">{t('serviceComparison')}</h3>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={comparisonChartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" tick={{ fontSize: 10 }} />
              <YAxis tickFormatter={(v) => `${v}€`} />
              <Tooltip formatter={(v) => `${fmt(v)}€`} />
              <Legend />
              <Bar dataKey="moisA" fill="#3b82f6" name={monthALabel} />
              <Bar dataKey="moisB" fill="#94a3b8" name={monthBLabel} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <Accordion title={t('projectComparison')} defaultOpen>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left bg-gray-50">
              <SortableHeader
                column="name" kind="text" sorting={projectSorting} t={t}
                className="p-3 font-medium rounded-tl-lg"
              >
                {t('project')}
              </SortableHeader>
              {accountColumn && (
                <SortableHeader
                  column="account" kind="text" sorting={projectSorting} t={t}
                  className="p-3 font-medium"
                >
                  {accountColumn.label}
                </SortableHeader>
              )}
              <SortableHeader
                column="totalA" kind="number" sorting={projectSorting} t={t}
                className="p-3 font-medium text-right"
              >
                {monthALabel}
              </SortableHeader>
              <SortableHeader
                column="totalB" kind="number" sorting={projectSorting} t={t}
                className="p-3 font-medium text-right"
              >
                {monthBLabel}
              </SortableHeader>
              <SortableHeader
                column="variation" kind="number" sorting={projectSorting} t={t}
                className="p-3 font-medium text-right rounded-tr-lg"
              >
                {t('variation')}
              </SortableHeader>
            </tr>
          </thead>
          <tbody>
            {compareProjects.map((p) => (
              <tr
                // A project billed to several accounts has a row for each (#119)
                key={accountColumn ? `${p.projectId} ${p.account}` : p.projectId}
                className="border-b hover:bg-gray-50 transition-colors"
              >
                <td className="p-3 font-medium">{p.projectName}</td>
                {accountColumn && (
                  <td className="p-3 text-gray-600">{accountColumn.nameOf(p.account)}</td>
                )}
                <td className="p-3 text-right font-medium">{fmt(p.totalA)}€</td>
                <td className="p-3 text-right text-gray-500">{fmt(p.totalB)}€</td>
                <td className="p-3 text-right">
                  <Variation from={p.totalA} to={p.totalB} language={language} t={t} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Accordion>

      {/* Accordion for the infrastructure (dedicated servers, VPS, storage, etc.) */}
      <Accordion title={language === 'en' ? 'Infrastructure Comparison' : 'Comparaison Infrastructure'}>
        {/* Infrastructure comparison table */}
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left bg-gray-50">
              <SortableHeader
                column="type" kind="text" sorting={infrastructureSorting} t={t}
                className="p-3 font-medium rounded-tl-lg"
              >
                {language === 'en' ? 'Type' : 'Type'}
              </SortableHeader>
              <SortableHeader
                column="totalA" kind="number" sorting={infrastructureSorting} t={t}
                className="p-3 font-medium text-right"
              >
                {monthALabel}
              </SortableHeader>
              <SortableHeader
                column="totalB" kind="number" sorting={infrastructureSorting} t={t}
                className="p-3 font-medium text-right"
              >
                {monthBLabel}
              </SortableHeader>
              <SortableHeader
                column="variation" kind="number" sorting={infrastructureSorting} t={t}
                className="p-3 font-medium text-right rounded-tr-lg"
              >
                {t('variation')}
              </SortableHeader>
            </tr>
          </thead>
          <tbody>
            {infrastructureTypes.map((type) => drawResourceTypeRow('infrastructure', type))}
          </tbody>
        </table>
      </Accordion>

      {/* Accordion for the backup */}
      <Accordion title={language === 'en' ? 'Backup Comparison' : 'Comparaison Backup'}>
        {/* Backup comparison table, of two fixed rows: nothing to sort (#146) */}
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left bg-gray-50">
              <th className="p-3 font-medium rounded-tl-lg">{language === 'en' ? 'Category' : 'Catégorie'}</th>
              <th className="p-3 font-medium text-right">{monthALabel}</th>
              <th className="p-3 font-medium text-right">{monthBLabel}</th>
              <th className="p-3 font-medium text-right rounded-tr-lg">{t('variation')}</th>
            </tr>
          </thead>
          <tbody>
            {/* The number and the cost of the Veeam VMs and Enterprise licences of months A
                and B, as the Backup tab shows them for the selected month (#32). A row that
                either month billed unfolds into its services (#197). */}
            {[
              {
                key: 'backup_vms',
                kind: 'vms',
                label: language === 'en' ? 'Veeam Backup VMs' : 'VMs Veeam Backup',
              },
              {
                key: 'backup_enterprise',
                kind: 'enterprise',
                label: language === 'en' ? 'Veeam Enterprise License' : 'Licence Veeam Enterprise',
              },
            ].map(row => {
              const a = backupsOf(backupStatsA, row.kind);
              const b = backupsOf(backupStatsB, row.kind);
              return (
                <UnfoldingRow
                  key={row.key}
                  unfolding={a.total > 0 || b.total > 0 ? unfoldingOf('backup', row.key) : null}
                  chevronLabel={`${t('servicesOf')} ${row.label}`}
                  label={row.label}
                  detail={(
                    <ResourceTypeServices
                      servicesQuery={(month) => backupServicesQuery(row.kind, month)}
                      monthA={compareMonthA} monthB={compareMonthB} sort={null}
                      values={SERVICE_VALUES} columnCount={COMPARISON_COLUMNS}
                      accountColumn={accountColumn} fmt={fmt} language={language} t={t}
                    />
                  )}
                >
                  <td className="p-3 text-right font-medium">{a.count} / {fmt(a.total)}€</td>
                  <td className="p-3 text-right text-gray-500">{b.count} / {fmt(b.total)}€</td>
                  <td className="p-3 text-right">
                    <Variation from={a.total} to={b.total} language={language} t={t} />
                  </td>
                </UnfoldingRow>
              );
            })}
          </tbody>
        </table>
      </Accordion>

      {/* Accordion for the Private Cloud */}
      <Accordion title={language === 'en' ? 'Private Cloud Comparison' : 'Comparaison Private Cloud'}>
        {/* Private Cloud comparison table, of two fixed rows: nothing to sort (#146) */}
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left bg-gray-50">
              <th className="p-3 font-medium rounded-tl-lg">{language === 'en' ? 'Type' : 'Type'}</th>
              <th className="p-3 font-medium text-right">{monthALabel}</th>
              <th className="p-3 font-medium text-right">{monthBLabel}</th>
              <th className="p-3 font-medium text-right rounded-tr-lg">{t('variation')}</th>
            </tr>
          </thead>
          <tbody>
            {/* Its sort stays null, as it has no header that sorts it */}
            {privateCloudTypes.map((type) => drawResourceTypeRow('privateCloud', type))}
          </tbody>
        </table>
      </Accordion>
      {/* One accordion per Public Cloud project: the comparison of its products (#181) */}
      {detailedProjects.map((proj) => (
        <Accordion key={proj.projectId} title={`${proj.projectName} (${t('project')})`}>
          <ProjectProductComparison
            productsQueryOf={(month) => projectProductsQuery(proj.projectId, month)}
            monthA={compareMonthA} monthB={compareMonthB}
            sorting={sortingOf(`products ${proj.projectId}`)}
            fmt={fmt} language={language} t={t}
          />
        </Accordion>
      ))}
    </div>
  );
};

export { CompareTab };
