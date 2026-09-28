import { useQuery } from '@tanstack/react-query';
import { fetchProjectConsumption } from '../services/api';
import { formatMonthLabel } from '../utils/format.js';
import { variationPercent } from '../utils/variation.js';
import { SortableHeader, sortRows } from './SortableHeader.jsx';
import { Variation } from './Variation.jsx';

// The value of a cloud resource kind in each column that sorts the comparison (#146): what the
// project consumed of it in months A and B, and the variation from one to the other, none from
// 0 € or less
const RESOURCE_KIND_VALUES = {
  type: (row) => row.type,
  totalA: (row) => row.valA,
  totalB: (row) => row.valB,
  variation: (row) => variationPercent(row.valA, row.valB),
};

// What a project consumed in months A and B by cloud resource kind, in the order of its kinds in
// month A then in month B until the user sorts them (sorting, which the Compare tab's hook holds
// for each project: see SortableHeader.jsx)
export default function ProjectProductComparison({
  projectId, monthA, monthB, sorting, fmt, language, t,
}) {
  // Fetch the detailed consumption of each month
  const { data: consA = [] } = useQuery({
    queryKey: ['projectConsumption', projectId, monthA?.from, monthA?.to],
    queryFn: () => fetchProjectConsumption(projectId, monthA?.from, monthA?.to),
    enabled: !!projectId && !!monthA?.from && !!monthA?.to
  });
  const { data: consB = [] } = useQuery({
    queryKey: ['projectConsumption', projectId, monthB?.from, monthB?.to],
    queryFn: () => fetchProjectConsumption(projectId, monthB?.from, monthB?.to),
    enabled: !!projectId && !!monthB?.from && !!monthB?.to
  });

  // Group by resource_type
  const groupByType = (arr) => {
    const map = {};
    arr.forEach(item => {
      const key = item.resource_type || 'other';
      map[key] = (map[key] || 0) + (item.total_price || 0);
    });
    return map;
  };
  const aByType = groupByType(consA);
  const bByType = groupByType(consB);
  const allTypes = Array.from(new Set([...Object.keys(aByType), ...Object.keys(bByType)]));
  const rows = allTypes.map((type) => ({
    type, valA: aByType[type] || 0, valB: bByType[type] || 0,
  }));

  if (!consA.length && !consB.length) {
    return <div className="text-gray-400 text-sm">{language === 'en' ? 'No data for this project' : 'Aucune donnée pour ce projet'}</div>;
  }

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b text-left bg-gray-50">
          <SortableHeader
            column="type" kind="text" sorting={sorting} t={t}
            className="p-3 font-medium rounded-tl-lg"
          >
            {language === 'en' ? 'Product/Type' : 'Produit/Type'}
          </SortableHeader>
          <SortableHeader
            column="totalA" kind="number" sorting={sorting} t={t}
            className="p-3 font-medium text-right"
          >
            {formatMonthLabel(monthA?.value, language)}
          </SortableHeader>
          <SortableHeader
            column="totalB" kind="number" sorting={sorting} t={t}
            className="p-3 font-medium text-right"
          >
            {formatMonthLabel(monthB?.value, language)}
          </SortableHeader>
          <SortableHeader
            column="variation" kind="number" sorting={sorting} t={t}
            className="p-3 font-medium text-right rounded-tr-lg"
          >
            {language === 'en' ? 'Variation' : 'Variation'}
          </SortableHeader>
        </tr>
      </thead>
      <tbody>
        {sortRows(
          rows, sorting.sort, RESOURCE_KIND_VALUES, language,
        ).map(({ type, valA, valB }) => {
          return (
            <tr key={type} className="border-b hover:bg-gray-50 transition-colors">
              <td className="p-3 font-medium">{type}</td>
              <td className="p-3 text-right font-medium">{fmt(valA)}€</td>
              <td className="p-3 text-right text-gray-500">{fmt(valB)}€</td>
              <td className="p-3 text-right">
                <Variation from={valA} to={valB} language={language} t={t} />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}