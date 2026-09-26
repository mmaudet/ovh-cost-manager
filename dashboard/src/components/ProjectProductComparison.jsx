import { useQuery } from '@tanstack/react-query';
import { fetchProjectConsumption } from '../services/api';
import { formatMonthLabel } from '../utils/format.js';
import { Variation } from './Variation.jsx';

export default function ProjectProductComparison({ projectId, monthA, monthB, fmt, language, t }) {
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

  if (!consA.length && !consB.length) {
    return <div className="text-gray-400 text-sm">{language === 'en' ? 'No data for this project' : 'Aucune donnée pour ce projet'}</div>;
  }

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b text-left bg-gray-50">
          <th className="p-3 font-medium rounded-tl-lg">{language === 'en' ? 'Product/Type' : 'Produit/Type'}</th>
          <th className="p-3 font-medium text-right">
            {formatMonthLabel(monthA?.value, language)}
          </th>
          <th className="p-3 font-medium text-right">
            {formatMonthLabel(monthB?.value, language)}
          </th>
          <th className="p-3 font-medium text-right rounded-tr-lg">{language === 'en' ? 'Variation' : 'Variation'}</th>
        </tr>
      </thead>
      <tbody>
        {allTypes.map(type => {
          const valA = aByType[type] || 0;
          const valB = bByType[type] || 0;
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