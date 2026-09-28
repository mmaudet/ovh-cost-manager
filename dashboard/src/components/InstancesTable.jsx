import { SortableHeader, sortRows } from './SortableHeader.jsx';

// Label of the row that carries the bill lines left without an instance
const UNALLOCATED_INSTANCES = {
  fr: 'Non attribué (instances supprimées)',
  en: 'Unallocated (deleted instances)'
};

// The value of an instance in each column, which the table sorts by (#146). The row of the bill
// lines left without an instance has a cost only: it sorts by its cost as an instance does, and
// comes last by any other column.
const INSTANCE_VALUES = {
  name: (inst) => (inst.unallocated ? null : inst.name || inst.id),
  flavor: (inst) => inst.plan_code || inst.flavor,
  region: (inst) => inst.region,
  state: (inst) => inst.status,
  cost: (inst) => inst.total,
};

// The instances, the most expensive first, the unallocated row among them: the order of the
// table until the user sorts it
const mostExpensiveFirst = (instances) => (
  [...instances].sort((a, b) => (b.total || 0) - (a.total || 0))
);

// Cloud instances of a project, shared by the inline panel and its modal, which sort it alike
// (sorting, see SortableHeader.jsx).
const InstancesTable = ({ instances, sorting, language, t, fmt }) => (
  <table className="w-full text-sm">
    <thead>
      <tr className="border-b bg-gray-50">
        <SortableHeader
          column="name" kind="text" sorting={sorting} t={t}
          className="p-2 text-left font-medium"
        >
          {language === 'en' ? 'Name' : 'Nom'}
        </SortableHeader>
        <SortableHeader
          column="flavor" kind="text" sorting={sorting} t={t}
          className="p-2 text-left font-medium"
        >
          Flavor
        </SortableHeader>
        <SortableHeader
          column="region" kind="text" sorting={sorting} t={t}
          className="p-2 text-left font-medium"
        >
          {t('region')}
        </SortableHeader>
        <SortableHeader
          column="state" kind="text" sorting={sorting} t={t}
          className="p-2 text-left font-medium"
        >
          {t('state')}
        </SortableHeader>
        <SortableHeader
          column="cost" kind="number" sorting={sorting} t={t}
          className="p-2 text-right font-medium"
        >
          {language === 'en' ? 'Cost' : 'Coût'}
        </SortableHeader>
      </tr>
    </thead>
    <tbody>
      {sortRows(
        mostExpensiveFirst(instances), sorting.sort, INSTANCE_VALUES, language,
      ).map(inst => {
        if (inst.unallocated) {
          return (
            <tr key="unallocated" className="border-b hover:bg-gray-50">
              <td className="p-2 text-xs italic text-gray-500" colSpan={4}>{UNALLOCATED_INSTANCES[language]}</td>
              <td className="p-2 text-right font-medium text-xs">{fmt(inst.total)}€</td>
            </tr>
          );
        }
        const pc = inst.plan_code || inst.flavor || '';
        const isGpu = /^(l4-|l40s-|a100-|h100-|v100-|t1-|t2-)/.test(pc);
        return (
          <tr key={inst.id} className={`border-b hover:bg-gray-50 ${isGpu ? 'bg-purple-50' : ''}`}>
            <td className="p-2 font-medium text-xs">{inst.name || inst.id}</td>
            <td className="p-2 text-xs">
              {isGpu ? (
                <span className="px-1.5 py-0.5 bg-purple-100 text-purple-700 rounded font-medium">{pc}</span>
              ) : (
                pc
              )}
            </td>
            <td className="p-2 text-xs">{inst.region}</td>
            <td className="p-2">
              <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${inst.status === 'ACTIVE' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700'}`}>
                {inst.status}
              </span>
            </td>
            <td
              className="p-2 text-right font-medium text-xs"
              title={inst.cost_estimated
                ? (language === 'en'
                  ? 'Even share of the aggregated hourly line for this flavor: the API exposes no per-instance runtime'
                  : 'Part égale de la ligne horaire agrégée de ce flavor : l\'API n\'expose pas le temps de fonctionnement par instance')
                : undefined}
            >
              {inst.total === null || inst.total === undefined ? (
                <span className="text-gray-300">-</span>
              ) : (
                <>
                  {inst.cost_estimated && <span className="text-gray-400">~</span>}
                  {fmt(inst.total)}€
                </>
              )}
            </td>
          </tr>
        );
      })}
    </tbody>
  </table>
);

const instanceCsvColumns = (language) => [
  { key: 'name', label: language === 'en' ? 'Name' : 'Nom' },
  { key: 'flavor_display', label: 'Flavor' },
  { key: 'region', label: language === 'en' ? 'Region' : 'Région' },
  { key: 'status', label: language === 'en' ? 'State' : 'État' },
  { key: 'total', label: language === 'en' ? 'Cost (EUR)' : 'Coût (EUR)' },
  { key: 'cost_estimated', label: language === 'en' ? 'Estimated' : 'Estimé' },
  { key: 'monthly_billing', label: language === 'en' ? 'Monthly billing' : 'Facturation mensuelle' },
  { key: 'created_at', label: language === 'en' ? 'Created at' : 'Créé le' },
  { key: 'id', label: 'ID' }
];

// The displayed flavor falls back to the raw flavor id when planCode is missing.
// The unallocated row has no instance name: it carries its label instead.
const instanceCsvRows = (instances, language) =>
  instances.map(i => ({
    ...i,
    name: i.unallocated ? UNALLOCATED_INSTANCES[language] : i.name,
    flavor_display: i.plan_code || i.flavor || ''
  }));

export { InstancesTable, instanceCsvColumns, instanceCsvRows };
