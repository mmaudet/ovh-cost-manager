import { PRO_RATA_HINT } from '../utils/estimatedCost.js';
import { fmtBytes } from '../utils/format.js';
import { SortableHeader, sortRows } from './SortableHeader.jsx';

// The value of a volume in each column, which the table sorts by (#146): a bill line without a
// volume behind it has no size
const VOLUME_VALUES = {
  name: (v) => v.name,
  type: (v) => v.type,
  region: (v) => v.region,
  size: (v) => v.sizeGb,
  cost: (v) => v.total,
};

// Block storage volumes of a project, shared by the inline panel and its modal, which sort it
// alike (sorting, see SortableHeader.jsx).
const VolumesTable = ({ volumes, sorting, language, t, fmt }) => (
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
          column="type" kind="text" sorting={sorting} t={t}
          className="p-2 text-left font-medium"
        >
          Type
        </SortableHeader>
        <SortableHeader
          column="region" kind="text" sorting={sorting} t={t}
          className="p-2 text-left font-medium"
        >
          {t('region')}
        </SortableHeader>
        <SortableHeader
          column="size" kind="number" sorting={sorting} t={t}
          className="p-2 text-right font-medium"
        >
          {language === 'en' ? 'Size' : 'Taille'}
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
      {sortRows(volumes, sorting.sort, VOLUME_VALUES, language).map((v, i) => (
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
          {/* In the units and number format of the language, as the buckets (#70) */}
          <td className="p-2 text-right text-xs">
            {v.sizeGb !== null && v.sizeGb !== undefined
              ? fmtBytes(v.sizeGb * 1e9, language)
              : '-'}
          </td>
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
