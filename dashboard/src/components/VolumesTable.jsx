import { PRO_RATA_HINT } from '../utils/estimatedCost.js';

// Block storage volumes of a project, shared by the inline panel and its modal.
const VolumesTable = ({ volumes, language, t, fmt }) => (
  <table className="w-full text-sm">
    <thead>
      <tr className="border-b bg-gray-50">
        <th className="p-2 text-left font-medium">{language === 'en' ? 'Name' : 'Nom'}</th>
        <th className="p-2 text-left font-medium">Type</th>
        <th className="p-2 text-left font-medium">{t('region')}</th>
        <th className="p-2 text-right font-medium">{language === 'en' ? 'Size' : 'Taille'}</th>
        <th className="p-2 text-right font-medium">{language === 'en' ? 'Cost' : 'Coût'}</th>
      </tr>
    </thead>
    <tbody>
      {volumes.map((v, i) => (
        <tr key={v.id || i} className="border-b hover:bg-gray-50">
          <td className="p-2 font-medium text-xs truncate max-w-[200px]" title={v.name}>
            {v.name}
            {v.attachedTo && v.attachedTo.length === 0 && (
              <span
                className="ml-1 px-1.5 py-0.5 rounded text-xs bg-red-100 text-red-700"
                title={language === 'en' ? 'Not attached to any instance' : "Attaché à aucune instance"}
              >
                {language === 'en' ? 'detached' : 'détaché'}
              </span>
            )}
          </td>
          <td className="p-2 text-xs">
            <span className={`px-1.5 py-0.5 rounded text-xs ${v.type === 'high-speed' ? 'bg-orange-100 text-orange-700' : 'bg-gray-100 text-gray-700'}`}>
              {v.type}
            </span>
          </td>
          <td className="p-2 text-xs">{v.region}</td>
          <td className="p-2 text-right text-xs">{v.sizeGb !== null && v.sizeGb !== undefined ? `${Math.round(v.sizeGb)} GB` : '-'}</td>
          <td className="p-2 text-right font-medium text-xs" title={v.allocated ? PRO_RATA_HINT[language] : undefined}>
            {v.allocated && <span className="text-gray-400">~</span>}
            {fmt(v.total)}€
          </td>
        </tr>
      ))}
    </tbody>
  </table>
);

const volumeCsvColumns = (language) => [
  { key: 'name', label: language === 'en' ? 'Name' : 'Nom' },
  { key: 'type', label: 'Type' },
  { key: 'region', label: language === 'en' ? 'Region' : 'Région' },
  { key: 'sizeGb', label: language === 'en' ? 'Size (GB)' : 'Taille (Go)' },
  { key: 'status', label: language === 'en' ? 'Status' : 'Statut' },
  { key: 'attached', label: language === 'en' ? 'Attached' : 'Attaché' },
  { key: 'total', label: language === 'en' ? 'Cost (EUR)' : 'Coût (EUR)' },
  { key: 'allocated', label: language === 'en' ? 'Estimated' : 'Estimé' },
  { key: 'createdAt', label: language === 'en' ? 'Created at' : 'Créé le' },
  { key: 'id', label: 'ID' }
];

const volumeCsvRows = (volumes) =>
  volumes.map(v => ({ ...v, attached: (v.attachedTo || []).join(' ') }));

export { VolumesTable, volumeCsvColumns, volumeCsvRows };
