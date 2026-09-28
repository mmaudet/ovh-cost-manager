import { PRO_RATA_HINT } from '../utils/estimatedCost.js';
import { fmtBytes } from '../utils/format.js';
import { SortableHeader, sortRows } from './SortableHeader.jsx';

// The value of a snapshot in each column, which the table sorts by (#146)
const SNAPSHOT_VALUES = {
  name: (sn) => sn.name,
  region: (sn) => sn.region,
  createdAt: (sn) => sn.createdAt,
  size: (sn) => sn.sizeGb,
  cost: (sn) => sn.total,
};

// Instance snapshots of a project, shared by the inline panel and its modal, which sort it
// alike (sorting, see SortableHeader.jsx).
const SnapshotsTable = ({ snapshots, sorting, language, t, fmt, locale }) => (
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
          column="region" kind="text" sorting={sorting} t={t}
          className="p-2 text-left font-medium"
        >
          {t('region')}
        </SortableHeader>
        <SortableHeader
          column="createdAt" kind="date" sorting={sorting} t={t}
          className="p-2 text-left font-medium"
        >
          {language === 'en' ? 'Created at' : 'Créé le'}
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
      {sortRows(snapshots, sorting.sort, SNAPSHOT_VALUES, language).map((sn, i) => (
        <tr key={sn.id || i} className="border-b hover:bg-gray-50">
          <td className="p-2 font-medium text-xs truncate max-w-[220px]" title={sn.name}>{sn.name}</td>
          <td className="p-2 text-xs">{sn.region}</td>
          <td className="p-2 text-xs text-gray-500">
            {sn.createdAt ? new Date(sn.createdAt).toLocaleDateString(locale) : '-'}
          </td>
          {/* In the units and number format of the language, as the buckets (#70) */}
          <td className="p-2 text-right text-xs">
            {sn.sizeGb !== null && sn.sizeGb !== undefined
              ? fmtBytes(sn.sizeGb * 1e9, language)
              : '-'}
          </td>
          <td className="p-2 text-right font-medium text-xs" title={sn.allocated ? PRO_RATA_HINT[language] : undefined}>
            {sn.allocated && <span className="text-gray-400">~</span>}
            {fmt(sn.total)}€
          </td>
        </tr>
      ))}
    </tbody>
  </table>
);

const snapshotCsvColumns = (language) => [
  { key: 'name', label: language === 'en' ? 'Name' : 'Nom' },
  { key: 'region', label: language === 'en' ? 'Region' : 'Région' },
  { key: 'sizeGb', label: language === 'en' ? 'Size (GB)' : 'Taille (Go)' },
  { key: 'visibility', label: language === 'en' ? 'Visibility' : 'Visibilité' },
  { key: 'osType', label: 'OS' },
  { key: 'total', label: language === 'en' ? 'Cost (EUR)' : 'Coût (EUR)' },
  { key: 'allocated', label: language === 'en' ? 'Estimated' : 'Estimé' },
  { key: 'createdAt', label: language === 'en' ? 'Created at' : 'Créé le' },
  { key: 'id', label: 'ID' }
];

export { SnapshotsTable, snapshotCsvColumns };
