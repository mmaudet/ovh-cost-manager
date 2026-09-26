import { useQuery } from '@tanstack/react-query';
import { fetchProjectConsumption } from '../services/api';

export default function ProjectProductComparison({ projectId, monthA, monthB, fmt, language }) {
  // Récupérer la consommation détaillée pour chaque mois
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

  // Regrouper par resource_type
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
          <th className="p-3 font-medium text-right">{monthA?.label}</th>
          <th className="p-3 font-medium text-right">{monthB?.label}</th>
          <th className="p-3 font-medium text-right rounded-tr-lg">{language === 'en' ? 'Variation' : 'Variation'}</th>
        </tr>
      </thead>
      <tbody>
        {allTypes.map(type => {
          const valA = aByType[type] || 0;
          const valB = bByType[type] || 0;
          const diff = valA ? ((valB - valA) / valA * 100) : null;
          return (
            <tr key={type} className="border-b hover:bg-gray-50 transition-colors">
              <td className="p-3 font-medium">{type}</td>
              <td className="p-3 text-right font-medium">{fmt(valA)}€</td>
              <td className="p-3 text-right text-gray-500">{fmt(valB)}€</td>
              <td className="p-3 text-right">
                {diff !== null && (
                  <span className={`px-2 py-1 rounded text-xs font-medium ${diff > 0 ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>
                    {diff > 0 ? '+' : ''}{diff.toFixed(1)}%
                  </span>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}