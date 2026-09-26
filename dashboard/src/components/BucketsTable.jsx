// Bucket table, shared by the inline panel and the "show all" modal.
// Sorted by name so the list stays stable across period changes.
const BucketsTable = ({ buckets, language, t, fmt, fmtBytes }) => (
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
      {sortBucketsByName(buckets).map((bucket, i) => (
        <tr key={i} className={`border-b hover:bg-gray-50 ${bucket.inInventory === false ? 'opacity-60' : ''}`}>
          <td className="p-2 font-medium text-xs truncate max-w-[150px]" title={bucket.name}>
            {bucket.name}
            {bucket.inInventory === false && (
              <span className="ml-1 text-gray-400" title={language === 'en' ? 'Billed but no longer present' : 'Facturé mais absent de l\'inventaire'}>†</span>
            )}
          </td>
          <td className="p-2 text-xs">
            <span className={`px-1.5 py-0.5 rounded text-xs ${
              bucket.type === 'High Performance' ? 'bg-orange-100 text-orange-700' :
              bucket.type === 'Standard IA' ? 'bg-blue-100 text-blue-700' :
              bucket.type === 'Cold Archive' ? 'bg-purple-100 text-purple-700' :
              bucket.type === 'Public Cloud Archive' ? 'bg-indigo-100 text-indigo-700' :
              bucket.type === 'Swift' ? 'bg-sky-100 text-sky-700' :
              'bg-gray-100 text-gray-700'
            }`}>
              {bucket.type || (language === 'en' ? 'Unknown' : 'Inconnu')}
            </span>
            {bucket.status && bucket.status !== 'none' && (
              <span className="ml-1 px-1.5 py-0.5 rounded text-xs bg-indigo-100 text-indigo-700">
                {bucket.status}
              </span>
            )}
          </td>
          <td className="p-2 text-xs">{bucket.region}</td>
          <td className="p-2 text-right text-xs">{fmtBytes(bucket.objectsSize)}</td>
          <td
            className="p-2 text-right font-medium text-xs"
            title={bucket.allocated
              ? (language === 'en'
                ? 'Share of the aggregated "Stockage Cold Archive" bill line, pro rata of stored volume'
                : 'Quote-part de la ligne agrégée « Stockage Cold Archive », au prorata du volume stocké')
              : undefined}
          >
            {bucket.allocated && <span className="text-gray-400">~</span>}
            {fmt(bucket.total)}€
          </td>
        </tr>
      ))}
    </tbody>
  </table>
);

// Column definitions for the bucket CSV export
const bucketCsvColumns = (language) => [
  { key: 'name', label: language === 'en' ? 'Name' : 'Nom' },
  { key: 'type', label: 'Type' },
  { key: 'status', label: language === 'en' ? 'Status' : 'Statut' },
  { key: 'region', label: language === 'en' ? 'Region' : 'Région' },
  { key: 'objectsCount', label: language === 'en' ? 'Objects' : 'Objets' },
  { key: 'objectsSize', label: language === 'en' ? 'Size (bytes)' : 'Taille (octets)' },
  { key: 'total', label: language === 'en' ? 'Cost (EUR)' : 'Coût (EUR)' },
  { key: 'allocated', label: language === 'en' ? 'Estimated' : 'Estimé' },
  { key: 'inInventory', label: language === 'en' ? 'In inventory' : 'Dans l\'inventaire' },
  { key: 'createdAt', label: language === 'en' ? 'Created at' : 'Créé le' }
];

const sortBucketsByName = (buckets) =>
  [...buckets].sort((a, b) => (a.name || '').localeCompare(b.name || '', 'fr', { sensitivity: 'base' }));

export { BucketsTable, bucketCsvColumns, sortBucketsByName };
