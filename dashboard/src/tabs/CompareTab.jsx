import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import Accordion from '../components/Accordion.jsx';
import { SortIcon } from '../components/SortIcon.jsx';
import ProjectProductComparison from '../components/ProjectProductComparison.jsx';
import { Variation } from '../components/Variation.jsx';
import { projectComparisonRows } from '../utils/projectComparison.js';

// The Compare tab, which the shell renders while it is active: what useCompareTab() returns,
// with the shell's language, translations (t), amount format (fmt) and months list, and the
// dedicated servers of the inventory, which the Infrastructure hook loads, on its own tab
// and on this one (#35).
const CompareTab = ({
  compareMonthA, setCompareMonthA, compareMonthB, setCompareMonthB,
  compareSort, handleCompareSort,
  compareDataA, compareDataB, byServiceA, byServiceB, byProjectA, byProjectB,
  byResourceTypeA, byResourceTypeB, backupStatsA, backupStatsB,
  language, t, fmt, months, inventoryServers,
}) => {
  // Merge and sort comparison data: the projects of months A and B, paired by id (#55)
  const getSortedCompareProjects = () => {
    const merged = projectComparisonRows(byProjectA, byProjectB);
    return merged.sort((a, b) => {
      let aVal, bVal;
      if (compareSort.column === 'name') {
        aVal = a.projectName?.toLowerCase() || '';
        bVal = b.projectName?.toLowerCase() || '';
      } else if (compareSort.column === 'totalA') {
        aVal = a.totalA || 0;
        bVal = b.totalA || 0;
      } else if (compareSort.column === 'totalB') {
        aVal = a.totalB || 0;
        bVal = b.totalB || 0;
      } else if (compareSort.column === 'diff') {
        aVal = a.variation ?? -Infinity;
        bVal = b.variation ?? -Infinity;
      }
      if (aVal < bVal) return compareSort.direction === 'asc' ? -1 : 1;
      if (aVal > bVal) return compareSort.direction === 'asc' ? 1 : -1;
      return 0;
    });
  };

  // Comparison chart data
  const comparisonChartData = byServiceA.map((s) => {
    const matchB = byServiceB.find(b => b.name === s.name);
    return {
      name: s.name,
      moisA: s.value,
      moisB: matchB?.value || 0
    };
  });

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
              {months.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
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
              {months.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </div>
        </div>

        <div className="flex items-center justify-center gap-6 md:gap-8 mt-8">
          <div className="text-center">
            <div className="text-3xl md:text-4xl font-bold text-blue-600">
              {fmt(compareDataA?.total || 0)}€
            </div>
            <div className="text-gray-500 mt-1 text-sm">{compareMonthA?.label}</div>
          </div>
          <div className="flex flex-col items-center">
            {/* From the total of month A to that of month B, once both are in */}
            {compareDataA && compareDataB && (
              <Variation
                from={compareDataA.total} to={compareDataB.total} t={t} size="headline"
              />
            )}
          </div>
          <div className="text-center">
            <div className="text-3xl md:text-4xl font-bold text-gray-400">
              {fmt(compareDataB?.total || 0)}€
            </div>
            <div className="text-gray-500 mt-1 text-sm">{compareMonthB?.label}</div>
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
              <Bar dataKey="moisA" fill="#3b82f6" name={compareMonthA?.label} />
              <Bar dataKey="moisB" fill="#94a3b8" name={compareMonthB?.label} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <Accordion title={t('projectComparison')} defaultOpen>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left bg-gray-50">
              <th
                className="p-3 font-medium rounded-tl-lg cursor-pointer hover:bg-gray-100 select-none"
                onClick={() => handleCompareSort('name')}
              >
                {t('project')}<SortIcon column="name" current={compareSort} />
              </th>
              <th
                className="p-3 font-medium text-right cursor-pointer hover:bg-gray-100 select-none"
                onClick={() => handleCompareSort('totalA')}
              >
                {compareMonthA?.label}<SortIcon column="totalA" current={compareSort} />
              </th>
              <th
                className="p-3 font-medium text-right cursor-pointer hover:bg-gray-100 select-none"
                onClick={() => handleCompareSort('totalB')}
              >
                {compareMonthB?.label}<SortIcon column="totalB" current={compareSort} />
              </th>
              <th
                className="p-3 font-medium text-right rounded-tr-lg cursor-pointer hover:bg-gray-100 select-none"
                onClick={() => handleCompareSort('diff')}
              >
                {t('variation')}<SortIcon column="diff" current={compareSort} />
              </th>
            </tr>
          </thead>
          <tbody>
            {getSortedCompareProjects().map((p) => (
              <tr key={p.projectId} className="border-b hover:bg-gray-50 transition-colors">
                <td className="p-3 font-medium">{p.projectName}</td>
                <td className="p-3 text-right font-medium">{fmt(p.totalA)}€</td>
                <td className="p-3 text-right text-gray-500">{fmt(p.totalB)}€</td>
                <td className="p-3 text-right">
                  <Variation from={p.totalA} to={p.totalB} t={t} />
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
              <th className="p-3 font-medium rounded-tl-lg">{language === 'en' ? 'Type' : 'Type'}</th>
              <th className="p-3 font-medium text-right">{compareMonthA?.label}</th>
              <th className="p-3 font-medium text-right">{compareMonthB?.label}</th>
              <th className="p-3 font-medium text-right rounded-tr-lg">{t('variation')}</th>
            </tr>
          </thead>
          <tbody>
            {[
              { key: 'dedicated_server', label: language === 'en'
                ? `List of Dedicated Servers present on ${new Date().toLocaleDateString('en-GB')}`
                : `Liste des Serveurs dédiés présents au ${new Date().toLocaleDateString('fr-FR')}`,
                renderNames: () => (
                  <ul className="text-xs text-gray-500 mt-1">
                    {inventoryServers.map(srv => (
                      <li key={srv.id}>{srv.display_name || srv.id}</li>
                    ))}
                  </ul>
                )
              },
              { key: 'vps', label: 'VPS' },
              { key: 'storage', label: language === 'en' ? 'Storage' : 'Stockage' },
              { key: 'load_balancer', label: language === 'en' ? 'Load Balancer' : 'Load Balancer' },
              { key: 'ip_service', label: language === 'en' ? 'IP Addresses' : 'Adresses IP' },
              { key: 'domain', label: language === 'en' ? 'Domains' : 'Noms de domaine' },
              { key: 'private_cloud_host', label: language === 'en' ? 'Private Cloud Hosts' : 'Hôtes Private Cloud' },
              { key: 'private_cloud_datastore', label: language === 'en' ? 'Private Cloud Datastores' : 'Datastores Private Cloud' },
            ].map(row => {
              // The costs of the row's resource type in months A and B (#32)
              const a = byResourceTypeA.find(r => r.resource_type === row.key) || {};
              const b = byResourceTypeB.find(r => r.resource_type === row.key) || {};
              const valA = a.value || 0;
              const valB = b.value || 0;
              return (
                <tr key={row.key} className="border-b hover:bg-gray-50 transition-colors">
                  <td className="p-3 font-medium">
                    {row.label}
                    {row.key === 'dedicated_server' && row.renderNames && inventoryServers.length > 0 && row.renderNames()}
                  </td>
                  <td className="p-3 text-right font-medium">{fmt(valA)}€</td>
                  <td className="p-3 text-right text-gray-500">{fmt(valB)}€</td>
                  <td className="p-3 text-right">
                    <Variation from={valA} to={valB} t={t} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Accordion>

      {/* Accordion for the backup */}
      <Accordion title={language === 'en' ? 'Backup Comparison' : 'Comparaison Backup'}>
        {/* Backup comparison table */}
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left bg-gray-50">
              <th className="p-3 font-medium rounded-tl-lg">{language === 'en' ? 'Category' : 'Catégorie'}</th>
              <th className="p-3 font-medium text-right">{compareMonthA?.label}</th>
              <th className="p-3 font-medium text-right">{compareMonthB?.label}</th>
              <th className="p-3 font-medium text-right rounded-tr-lg">{t('variation')}</th>
            </tr>
          </thead>
          <tbody>
            {/* The number and the cost of the Veeam VMs and Enterprise licences of months A
                and B, as the Backup tab shows them for the selected month (#32) */}
            {[
              {
                key: 'backup_vms',
                label: language === 'en' ? 'Veeam Backup VMs' : 'VMs Veeam Backup',
                getA: () => (backupStatsA?.vms?.count || 0),
                getB: () => (backupStatsB?.vms?.count || 0),
                getValA: () => (backupStatsA?.vms?.total || 0),
                getValB: () => (backupStatsB?.vms?.total || 0),
              },
              {
                key: 'backup_enterprise',
                label: language === 'en' ? 'Veeam Enterprise License' : 'Licence Veeam Enterprise',
                getA: () => (backupStatsA?.enterprise?.count || 0),
                getB: () => (backupStatsB?.enterprise?.count || 0),
                getValA: () => (backupStatsA?.enterprise?.total || 0),
                getValB: () => (backupStatsB?.enterprise?.total || 0),
              },
            ].map(row => {
              const countA = row.getA();
              const countB = row.getB();
              const valA = row.getValA();
              const valB = row.getValB();
              return (
                <tr key={row.key} className="border-b hover:bg-gray-50 transition-colors">
                  <td className="p-3 font-medium">{row.label}</td>
                  <td className="p-3 text-right font-medium">{countA} / {fmt(valA)}€</td>
                  <td className="p-3 text-right text-gray-500">{countB} / {fmt(valB)}€</td>
                  <td className="p-3 text-right">
                    <Variation from={valA} to={valB} t={t} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Accordion>

      {/* Accordion for the Private Cloud */}
      <Accordion title={language === 'en' ? 'Private Cloud Comparison' : 'Comparaison Private Cloud'}>
        {/* Private Cloud comparison table */}
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left bg-gray-50">
              <th className="p-3 font-medium rounded-tl-lg">{language === 'en' ? 'Type' : 'Type'}</th>
              <th className="p-3 font-medium text-right">{compareMonthA?.label}</th>
              <th className="p-3 font-medium text-right">{compareMonthB?.label}</th>
              <th className="p-3 font-medium text-right rounded-tr-lg">{t('variation')}</th>
            </tr>
          </thead>
          <tbody>
            {[
              { key: 'private_cloud_host', label: language === 'en' ? 'Private Cloud Hosts' : 'Hôtes Private Cloud' },
              { key: 'private_cloud_datastore', label: language === 'en' ? 'Private Cloud Datastores' : 'Datastores Private Cloud' },
            ].map(row => {
              // The costs of the row's resource type in months A and B (#32)
              const a = byResourceTypeA.find(r => r.resource_type === row.key) || {};
              const b = byResourceTypeB.find(r => r.resource_type === row.key) || {};
              const valA = a.value || 0;
              const valB = b.value || 0;
              return (
                <tr key={row.key} className="border-b hover:bg-gray-50 transition-colors">
                  <td className="p-3 font-medium">{row.label}</td>
                  <td className="p-3 text-right font-medium">{fmt(valA)}€</td>
                  <td className="p-3 text-right text-gray-500">{fmt(valB)}€</td>
                  <td className="p-3 text-right">
                    <Variation from={valA} to={valB} t={t} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Accordion>
      {/* One accordion per Public Cloud project: detailed comparison of products/services */}
      {getSortedCompareProjects().map((proj) => (
        <Accordion key={proj.projectId} title={`${proj.projectName} (${t('project')})`}>
          <ProjectProductComparison
            projectId={proj.projectId} monthA={compareMonthA} monthB={compareMonthB}
            fmt={fmt} language={language} t={t}
          />
        </Accordion>
      ))}
    </div>
  );
};

export { CompareTab };
