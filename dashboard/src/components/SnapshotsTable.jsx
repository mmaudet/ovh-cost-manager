import { PRO_RATA_HINT } from '../utils/estimatedCost.js';

// Instance snapshots of a project, shared by the inline panel and its modal.
const SnapshotsTable = ({ snapshots, language, t, fmt, locale }) => (
  <table className="w-full text-sm">
    <thead>
      <tr className="border-b bg-gray-50">
        <th className="p-2 text-left font-medium">{language === 'en' ? 'Name' : 'Nom'}</th>
        <th className="p-2 text-left font-medium">{t('region')}</th>
        <th className="p-2 text-left font-medium">{language === 'en' ? 'Created at' : 'Créé le'}</th>
        <th className="p-2 text-right font-medium">{language === 'en' ? 'Size' : 'Taille'}</th>
        <th className="p-2 text-right font-medium">{language === 'en' ? 'Cost' : 'Coût'}</th>
      </tr>
    </thead>
    <tbody>
      {snapshots.map((sn, i) => (
        <tr key={sn.id || i} className="border-b hover:bg-gray-50">
          <td className="p-2 font-medium text-xs truncate max-w-[220px]" title={sn.name}>{sn.name}</td>
          <td className="p-2 text-xs">{sn.region}</td>
          <td className="p-2 text-xs text-gray-500">
            {sn.createdAt ? new Date(sn.createdAt).toLocaleDateString(locale) : '-'}
          </td>
          <td className="p-2 text-right text-xs">{sn.sizeGb !== null && sn.sizeGb !== undefined ? `${Math.round(sn.sizeGb)} GB` : '-'}</td>
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
