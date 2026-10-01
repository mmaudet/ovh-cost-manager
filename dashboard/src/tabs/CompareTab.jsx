import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import Accordion from '../components/Accordion.jsx';
import { ComparedAmount } from '../components/ProjectedAmount.jsx';
import { ProjectionCheckbox } from '../components/ProjectionCheckbox.jsx';
import { SortableHeader, sortRows } from '../components/SortableHeader.jsx';
import ProjectProductComparison from '../components/ProjectProductComparison.jsx';
import { UnfoldedRowCharges, chargeValues } from '../components/UnfoldedRowCharges.jsx';
import { UnfoldedRowServices } from '../components/UnfoldedRowServices.jsx';
import { UnfoldingRow } from '../components/UnfoldingRow.jsx';
import { Variation } from '../components/Variation.jsx';
import { formatBilledAndProjected, formatMonthLabel } from '../utils/format.js';
import { comparisonValues, valuesAsShown } from '../utils/monthComparison.js';
import { monthLabel } from '../utils/months.js';
import { firstRowOfEachProject, projectComparisonRows } from '../utils/projectComparison.js';
import { serviceTypeBars } from '../utils/serviceTypeChart.js';
import { variationPercent } from '../utils/variation.js';

// The cost of a resource type in a month, from its costs by resource type (#32), and what
// projected lines make of it in the month in progress, while the page projects it (#218): 0 for
// none, as in a complete month
const costsOfType = (byResourceType, type) => {
  const row = byResourceType.find(r => r.resource_type === type);
  return { total: row?.value || 0, projected: row?.projected || 0 };
};

// The Veeam VMs or Enterprise licences of a month, from its backups (#32): their number, their
// cost, and what projected lines make of it (#218), 0 for none
const backupsOf = (backupStats, kind) => ({
  count: backupStats?.[kind]?.count || 0,
  total: backupStats?.[kind]?.total || 0,
  projected: backupStats?.[kind]?.projected || 0,
});

// The look of the « projeté » mark next to a headline total (#218): in the size and weight of
// the months' names under it, rather than in the headline's
const HEADLINE_MARK = 'text-sm font-medium';

// Months A and B in the chart of the service types, by the key of each one's bars in the chart's
// rows: the key of what stacks on them, their projected part (#218), that of what projected lines
// make of the type's cost, which the tooltip gives, and their colours, the projected part
// lighter, and dashed
const CHART_MONTHS = {
  moisA: {
    projectedKey: 'moisAProjected', partKey: 'moisAPart', billed: '#3b82f6', projected: '#bfdbfe',
  },
  moisB: {
    projectedKey: 'moisBProjected', partKey: 'moisBPart', billed: '#94a3b8', projected: '#e2e8f0',
  },
};

// A series of the chart's legend, which Recharts writes in the colour of its bars: the projected
// part of a month, too light to read on white, in the colour of its month (#218)
const legendLabel = (value, { dataKey, color }) => {
  const monthOfPart = Object.values(CHART_MONTHS)
    .find(({ projectedKey }) => projectedKey === dataKey);
  return <span style={{ color: monthOfPart?.billed ?? color }}>{value}</span>;
};

// The cost of a service type in month A or B, in the chart's row (#218): its bar under the
// month's key, what stacks on it under the key of its projected part, 0 for nothing, which add up
// to the type's cost, and what projected lines make of that cost, 0 for none, a part below 0
// included, which draws no stacked part (serviceTypeBars(), #219)
const chartCostsOf = (month, serviceType) => {
  const { bar, stacked, projected } = serviceTypeBars(serviceType);
  const { projectedKey, partKey } = CHART_MONTHS[month];
  return { [month]: bar, [projectedKey]: stacked, [partKey]: projected };
};

// The value of a resource type of the infrastructure comparison in each column that sorts it
// (#146), from the costs by resource type of months A and B: its label, its cost in each month,
// and the variation from one to the other, none from 0 € or less
const resourceTypeValues = (byResourceTypeA, byResourceTypeB) => {
  const totalA = ({ key }) => costsOfType(byResourceTypeA, key).total;
  const totalB = ({ key }) => costsOfType(byResourceTypeB, key).total;
  return {
    type: ({ label }) => label,
    totalA,
    totalB,
    variation: (row) => variationPercent(totalA(row), totalB(row)),
  };
};

// The value of a service in the same columns, which sort the services of each row of the
// infrastructure comparison as they sort the rows (#192): its identifier, its cost in each
// month, and the variation from one to the other. The comparisons that do not sort, of the
// Private Cloud and of the backups (#197), order their services by their costs in months A and
// B alone.
const SERVICE_VALUES = comparisonValues('type', (service) => service.identifier);

// The value of a charge in the same columns, which sort the charges of the Logs Data Platform row
// as they sort the rows (#248): the charge itself, its cost in each month, and the variation
const CHARGE_VALUES = chargeValues('type');

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
// services and the queries of those services, and a project's products unfolded into their
// charges, which come with the products, included (#146, #181, #192, #195, #197), and the query
// of the Logs Data Platform charges, which the row of their resource type unfolds into (#248),
// with the shell's language, translations (t), amount format (fmt) and months list. The months
// and their figures are those of the account selected in the header (#119). The comparison by
// project names the account of each project in the Account column of the shell (accountColumn),
// when it shows one: it then compares the projects by account that the hook requests, a project
// billed to several accounts once for each. The page's setting that projects the month in
// progress, and its setter (useMonthInProgressProjection()), show as a checkbox next to months A
// and B (#218): while it is on, the totals, the service types, and the infrastructure, backup and
// Private Cloud comparisons, their services and the Logs Data Platform charges included, count
// the month in progress at its projected cost, as the hook asks for them, and mark the amounts
// that projected lines make; and so do the comparison by project and each project's products,
// their charges and credit included (#219). What the hook knows of months A and B,
// comparedMonths, decides the variations and the sort of the tables.
const CompareTab = ({
  compareMonthA, setCompareMonthA, compareMonthB, setCompareMonthB, comparedMonths,
  sortingOf, unfoldingOf, compareDataA, compareDataB, byServiceA, byServiceB, byProjectA,
  byProjectB, byResourceTypeA, byResourceTypeB, backupStatsA, backupStatsB, projectProductsQuery,
  resourceTypeServicesQuery, backupServicesQuery, logsDataPlatformChargesQuery,
  projectsMonthInProgress = false, setProjectsMonthInProgress, language, t, fmt, months,
  accountColumn,
}) => {
  // Months A and B as the page names them, in its language (#33)
  const monthALabel = formatMonthLabel(compareMonthA?.value, language);
  const monthBLabel = formatMonthLabel(compareMonthB?.value, language);

  // The projects of months A and B, paired by id (#55), and by account in the Account column
  // (#119), in the order the user sorts them, by month A until then (#146), and by the costs
  // that the table shows, those of the month in progress at its projected cost while the page
  // projects it (#219)
  const projectSorting = sortingOf('projects');
  const compareProjects = sortRows(
    projectComparisonRows(byProjectA, byProjectB), projectSorting.sort,
    valuesAsShown(comparedMonths, projectComparisonValues(accountColumn)), language,
  );
  // The projects whose products the tab compares (#181), once each, in the order of their
  // first rows: in the Account column, a project billed to several accounts has a row for each
  // (#119)
  const detailedProjects = firstRowOfEachProject(compareProjects);

  // The rows of the chart of the service types: those of month A, each with its cost in months
  // A and B, and what projected lines add to it in the month in progress, while the page
  // projects it (#218)
  const comparisonChartData = byServiceA.map((s) => {
    const matchB = byServiceB.find(b => b.name === s.name);
    return {
      name: s.name,
      ...chartCostsOf('moisA', s),
      ...chartCostsOf('moisB', matchB),
    };
  });
  // Whether a month's bars stack a projected part on what it billed: those of the month in
  // progress, while the page projects it, when projected lines add anything to a type's cost
  const stacksProjectedPart = (month) => comparisonChartData
    .some((row) => row[CHART_MONTHS[month].projectedKey]);
  // The formatter of the tooltip of a service type's bar in a month: its cost, which its bars add
  // up to, or, with a projected part, what the month billed and its projected cost
  const tooltipFormatterOf = (month) => (bar, name, { payload }) => {
    const { projectedKey, partKey } = CHART_MONTHS[month];
    const cost = bar + payload[projectedKey];
    const projectedPart = payload[partKey];
    return [
      projectedPart
        ? formatBilledAndProjected(cost, projectedPart, fmt, t)
        : `${fmt(cost)}€`,
      name,
    ];
  };
  // The bars of a month: what it billed, or its projected cost when projected lines take from it,
  // and while it has one, its projected part, stacked on it, lighter and dashed, which the legend
  // names and the tooltip leaves to the bar under it
  const monthBars = (month, label) => {
    const { projectedKey, billed, projected } = CHART_MONTHS[month];
    const stacked = stacksProjectedPart(month);
    return [
      <Bar
        key={month} dataKey={month} fill={billed} name={label}
        stackId={stacked ? month : undefined} formatter={tooltipFormatterOf(month)}
      />,
      stacked && (
        <Bar
          key={projectedKey} dataKey={projectedKey} stackId={month}
          fill={projected} stroke={billed} strokeDasharray="4 3"
          name={`${label} (${t('projected')})`} tooltipType="none"
        />
      ),
    ];
  };

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
  // comparison, in the order the user sorts them, in this order until then (#146). Logs Data
  // Platform, apart from the storage since #246, unfolds into its charges, which the query of its
  // charges gives (chargesQueryOf), rather than into its services, as the others do (#248).
  const infrastructureSorting = sortingOf('infrastructure');
  const infrastructureTypes = sortRows([
    { key: 'dedicated_server', label: t('dedicatedServers') },
    { key: 'vps', label: 'VPS' },
    { key: 'storage', label: language === 'en' ? 'Storage' : 'Stockage' },
    { key: 'load_balancer', label: language === 'en' ? 'Load Balancer' : 'Load Balancer' },
    { key: 'ip_service', label: language === 'en' ? 'IP Addresses' : 'Adresses IP' },
    { key: 'domain', label: language === 'en' ? 'Domains' : 'Noms de domaine' },
    {
      key: 'logs_data_platform', label: t('logsDataPlatform'),
      chargesQueryOf: logsDataPlatformChargesQuery,
    },
    ...privateCloudTypes,
  ], infrastructureSorting.sort, valuesAsShown(
    comparedMonths, resourceTypeValues(byResourceTypeA, byResourceTypeB),
  ), language);

  // What a cell of a month shows in the infrastructure, backup and Private Cloud comparisons: the
  // row's cost, and what projected lines make of it, marked so (#218), after the number of
  // services that it counts, for a row of the backups
  const monthCell = ({ count, total, projected }) => (
    <>
      {count !== undefined && `${count} / `}
      <ComparedAmount amount={total} projectedPart={projected} fmt={fmt} t={t} />
    </>
  );

  // Draws a row of the infrastructure, backup or Private Cloud comparison, by the comparison's
  // name: its label, its figures in months A and B, its cost and what projected lines make of it
  // (#218), with, for a row of the backups, the number of services that it counts, and the
  // variation from one cost to the other. It unfolds when it has anything to unfold into
  // (unfolds), into the rows that `detail` draws under it, which its chevron names
  // (chevronLabel); each comparison's rows unfold on their own (#192, #197).
  const drawUnfoldingRow = (comparison, {
    key, label, figuresA, figuresB, unfolds, chevronLabel, detail,
  }) => (
    <UnfoldingRow
      key={key}
      unfolding={unfolds ? unfoldingOf(comparison, key) : null}
      chevronLabel={chevronLabel}
      label={label}
      detail={detail}
    >
      <td className="p-3 text-right font-medium">{monthCell(figuresA)}</td>
      <td className="p-3 text-right text-gray-500">{monthCell(figuresB)}</td>
      <td className="p-3 text-right">
        <Variation
          from={figuresA.total} to={figuresB.total} comparedMonths={comparedMonths}
          language={language} t={t}
        />
      </td>
    </UnfoldingRow>
  );

  // Draws a row of these comparisons that unfolds into its services, when either month billed it
  // more than 0 €, as its services are those whose lines add up to more than 0 €: those that the
  // query of its services in a month gives (servicesQueryOf), which follow the comparison's sort
  // (#192, #197)
  const drawServicesRow = (comparison, { servicesQueryOf, ...row }) => drawUnfoldingRow(
    comparison, {
      ...row,
      unfolds: row.figuresA.total > 0 || row.figuresB.total > 0,
      chevronLabel: `${t('servicesOf')} ${row.label}`,
      detail: (
        <UnfoldedRowServices
          servicesQueryOf={servicesQueryOf}
          monthA={compareMonthA} monthB={compareMonthB} comparedMonths={comparedMonths}
          sort={sortingOf(comparison).sort} values={SERVICE_VALUES} columnCount={COMPARISON_COLUMNS}
          accountColumn={accountColumn} fmt={fmt} language={language} t={t}
        />
      ),
    },
  );

  // Draws a row of these comparisons that unfolds into its charges rather than its services, as
  // a product of a project does: those that the query of its charges in a month gives
  // (chargesQueryOf), the services together, which follow the comparison's sort (#248). It
  // unfolds when either month's cost is other than 0 €: its charges keep those that a refund
  // brings below 0 €, so that they add up to its amounts.
  const drawChargesRow = (comparison, { chargesQueryOf, ...row }) => drawUnfoldingRow(
    comparison, {
      ...row,
      unfolds: row.figuresA.total !== 0 || row.figuresB.total !== 0,
      chevronLabel: `${t('chargesOf')} ${row.label}`,
      detail: (
        <UnfoldedRowCharges
          chargesQueryOf={chargesQueryOf}
          monthA={compareMonthA} monthB={compareMonthB} comparedMonths={comparedMonths}
          sort={sortingOf(comparison).sort} values={CHARGE_VALUES} columnCount={COMPARISON_COLUMNS}
          fmt={fmt} language={language} t={t}
        />
      ),
    },
  );

  // Draws a row of the infrastructure or Private Cloud comparison, by the comparison's name: the
  // cost of a resource type in months A and B (#32), and what projected lines make of it in the
  // month in progress (#218), which unfolds into each service that it lists (#192), or, for a
  // resource type that gives the query of its charges (chargesQueryOf), into its charges (#248)
  const drawResourceTypeRow = (comparison, { key, label, chargesQueryOf }) => {
    const row = {
      key,
      label,
      figuresA: costsOfType(byResourceTypeA, key),
      figuresB: costsOfType(byResourceTypeB, key),
    };
    return chargesQueryOf
      ? drawChargesRow(comparison, { ...row, chargesQueryOf })
      : drawServicesRow(comparison, {
        ...row, servicesQueryOf: (month) => resourceTypeServicesQuery(key, month),
      });
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
                  {monthLabel(m, language, t)}
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
                  {monthLabel(m, language, t)}
                </option>
              ))}
            </select>
          </div>
          {/* The page's setting that projects the month in progress, the Trends tab's (#218): it
              follows the months on their line, or goes whole to a line of its own where it
              lacks room, as on a phone */}
          <ProjectionCheckbox
            projectsMonthInProgress={projectsMonthInProgress}
            setProjectsMonthInProgress={setProjectsMonthInProgress} t={t}
          />
        </div>

        {/* The totals of months A and B, and the variation between them: one under the other on
            a phone, which cannot hold them side by side, rather than run off its left edge
            (#226). The total of the month in progress at its projected cost is marked so, the
            mark in the size of the months' names (#218). */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-6 md:gap-8 mt-8">
          <div className="text-center">
            <div className="text-3xl md:text-4xl font-bold text-blue-600">
              <ComparedAmount
                amount={compareDataA?.total || 0} projectedPart={compareDataA?.projected}
                fmt={fmt} t={t} markClassName={HEADLINE_MARK}
              />
            </div>
            <div className="text-gray-500 mt-1 text-sm">{monthALabel}</div>
          </div>
          <div className="flex flex-col items-center">
            {/* From the total of month A to that of month B, once both are in */}
            {compareDataA && compareDataB && (
              <Variation
                from={compareDataA.total} to={compareDataB.total} language={language} t={t}
                size="headline" comparedMonths={comparedMonths}
              />
            )}
          </div>
          <div className="text-center">
            <div className="text-3xl md:text-4xl font-bold text-gray-400">
              <ComparedAmount
                amount={compareDataB?.total || 0} projectedPart={compareDataB?.projected}
                fmt={fmt} t={t} markClassName={HEADLINE_MARK}
              />
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
              <Legend formatter={legendLabel} />
              {monthBars('moisA', monthALabel)}
              {monthBars('moisB', monthBLabel)}
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
                {/* Its cost in each month, and what projected lines make of it (#219) */}
                <td className="p-3 text-right font-medium">
                  <ComparedAmount amount={p.totalA} projectedPart={p.projectedA} fmt={fmt} t={t} />
                </td>
                <td className="p-3 text-right text-gray-500">
                  <ComparedAmount amount={p.totalB} projectedPart={p.projectedB} fmt={fmt} t={t} />
                </td>
                <td className="p-3 text-right">
                  <Variation
                    from={p.totalA} to={p.totalB} comparedMonths={comparedMonths}
                    language={language} t={t}
                  />
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
                and B, as the Backup tab shows them for the selected month (#32), and what
                projected lines make of that cost in the month in progress (#218). A row that
                either month billed unfolds into its services (#197), which come by month A,
                then by month B: the comparison's sort stays null, as no header sorts it. */}
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
            ].map(({ key, kind, label }) => drawServicesRow('backup', {
              key,
              label,
              figuresA: backupsOf(backupStatsA, kind),
              figuresB: backupsOf(backupStatsB, kind),
              servicesQueryOf: (month) => backupServicesQuery(kind, month),
            }))}
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
      {/* One accordion per Public Cloud project: the comparison of its products (#181), each of
          which unfolds into its charges, the products unfolded held for each project (#195). As
          the comparison by project, the month in progress at its projected cost while the page
          projects it (#219). */}
      {detailedProjects.map((proj) => {
        // The name of the project's comparison, under which the hook holds its sort and the
        // products unfolded
        const productsComparison = `products ${proj.projectId}`;
        return (
          <Accordion key={proj.projectId} title={`${proj.projectName} (${t('project')})`}>
            <ProjectProductComparison
              productsQueryOf={(month) => projectProductsQuery(proj.projectId, month)}
              monthA={compareMonthA} monthB={compareMonthB} comparedMonths={comparedMonths}
              sorting={sortingOf(productsComparison)}
              unfoldingOf={(product) => unfoldingOf(productsComparison, product)}
              fmt={fmt} language={language} t={t}
            />
          </Accordion>
        );
      })}
    </div>
  );
};

export { CompareTab };
