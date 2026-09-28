import { fmtBytes } from '../utils/format.js';
import { SortableHeader, sortRows } from './SortableHeader.jsx';

// What the type of a bucket without a class says, and why (#145). OVHcloud gives a class to
// each object, never to a bucket, so an empty one has none. Any other one is unknown: the
// class of its objects could not be read, or it is billed but gone from the inventory, which
// its name's mark tells already.
const withoutClass = (bucket, t) => {
  if (bucket.inInventory === false) return { label: t('bucketUnknownClass') };
  if (bucket.objectsCount === 0) return { label: t('bucketEmpty'), hint: t('bucketEmptyHint') };
  return { label: t('bucketUnknownClass'), hint: t('bucketUnknownClassHint') };
};

// The value of a bucket in each column, which the table sorts by (#146): a bucket without a
// class, whose type says why it has none, sorts as one without a value, as a bucket gone from
// the inventory without a size
const BUCKET_VALUES = {
  name: (bucket) => bucket.name,
  type: (bucket) => bucket.type,
  region: (bucket) => bucket.region,
  size: (bucket) => bucket.objectsSize,
  cost: (bucket) => bucket.total,
};

// Bucket table, shared by the inline panel and the "show all" modal, which sort it alike
// (sorting, see SortableHeader.jsx). Sorted by name until the user sorts it, so the list
// stays stable across period changes.
const BucketsTable = ({ buckets, sorting, language, t, fmt }) => (
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
      {sortRows(
        sortBucketsByName(buckets), sorting.sort, BUCKET_VALUES, language,
      ).map((bucket, i) => (
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
              bucket.type === 'Active Archive' ? 'bg-fuchsia-100 text-fuchsia-700' :
              bucket.type === 'Cold Archive' ? 'bg-purple-100 text-purple-700' :
              bucket.type === 'Public Cloud Archive' ? 'bg-indigo-100 text-indigo-700' :
              bucket.type === 'Swift' ? 'bg-sky-100 text-sky-700' :
              'bg-gray-100 text-gray-700'
            }`} title={bucket.type ? undefined : withoutClass(bucket, t).hint}>
              {bucket.type || withoutClass(bucket, t).label}
            </span>
            {bucket.status && bucket.status !== 'none' && (
              <span className="ml-1 px-1.5 py-0.5 rounded text-xs bg-indigo-100 text-indigo-700">
                {bucket.status}
              </span>
            )}
          </td>
          <td className="p-2 text-xs">{bucket.region}</td>
          <td className="p-2 text-right text-xs">{fmtBytes(bucket.objectsSize, language)}</td>
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
