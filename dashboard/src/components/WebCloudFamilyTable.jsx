import { accountCsvColumns } from '../utils/accounts.js';
import { SortableHeader, sortRows } from './SortableHeader.jsx';

// The value of a service in each column, which the table sorts by (#146)
const SERVICE_VALUES = {
  name: (item) => item.name,
  account: (item) => item.accountName,
  description: (item) => item.description,
  lastDate: (item) => item.lastDate,
  cost: (item) => item.total,
};

// One Web Cloud family: service name, latest bill wording, last billed month. With the
// Account column of the lists, null when they show none, each service's account too (#122):
// the items then carry its name, accountName. The panel of the family and its "show all"
// modal sort it alike (sorting, see SortableHeader.jsx).
const WebCloudTable = ({ items, sorting, accountColumn, language, t, fmt }) => (
  <table className="w-full text-sm">
    <thead>
      <tr className="border-b bg-gray-50">
        <SortableHeader
          column="name" kind="text" sorting={sorting} t={t}
          className="p-2 text-left font-medium"
        >
          {language === 'en' ? 'Service' : 'Service'}
        </SortableHeader>
        {accountColumn && (
          <SortableHeader
            column="account" kind="text" sorting={sorting} t={t}
            className="p-2 text-left font-medium"
          >
            {accountColumn.label}
          </SortableHeader>
        )}
        <SortableHeader
          column="description" kind="text" sorting={sorting} t={t}
          className="p-2 text-left font-medium"
        >
          {language === 'en' ? 'Bill wording' : 'Libellé de facture'}
        </SortableHeader>
        <SortableHeader
          column="lastDate" kind="date" sorting={sorting} t={t}
          className="p-2 text-left font-medium"
        >
          {language === 'en' ? 'Last billed' : 'Dernière facture'}
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
      {sortRows(items, sorting.sort, SERVICE_VALUES, language).map((item, i) => (
        <tr key={`${item.category}-${item.name}-${i}`} className="border-b hover:bg-gray-50">
          <td className="p-2 font-medium text-xs truncate max-w-[220px]" title={item.name}>{item.name}</td>
          {accountColumn && (
            <td
              className="p-2 text-xs text-gray-500 truncate max-w-[160px]"
              title={item.accountName}
            >
              {item.accountName}
            </td>
          )}
          <td className="p-2 text-xs text-gray-500 truncate max-w-[320px]" title={item.description}>{item.description}</td>
          <td className="p-2 text-xs text-gray-500">{item.lastDate || '-'}</td>
          <td className="p-2 text-right font-medium text-xs">{fmt(item.total)}€</td>
        </tr>
      ))}
    </tbody>
  </table>
);

/**
 * The columns of a family's CSV file, for downloadCSV(): the account's after the service's
 * when the table shows it, for a spreadsheet to pivot the services by account (#122, see
 * accountCsvColumns()).
 * @param {string} language - The page's, 'fr' or 'en'
 * @param {?{ label: string }} accountColumn - The Account column of the lists
 *   (accountColumnOf()), null when they show none
 * @returns {{ key: string, label: string }[]}
 */
const webCloudCsvColumns = (language, accountColumn) => [
  { key: 'name', label: language === 'en' ? 'Service' : 'Service' },
  ...accountCsvColumns(accountColumn),
  { key: 'category', label: language === 'en' ? 'Family' : 'Famille' },
  { key: 'description', label: language === 'en' ? 'Bill wording' : 'Libellé de facture' },
  { key: 'lineCount', label: language === 'en' ? 'Bill lines' : 'Lignes de facture' },
  { key: 'firstDate', label: language === 'en' ? 'First billed' : 'Première facture' },
  { key: 'lastDate', label: language === 'en' ? 'Last billed' : 'Dernière facture' },
  { key: 'total', label: language === 'en' ? 'Cost (EUR)' : 'Coût (EUR)' }
];

export { WebCloudTable, webCloudCsvColumns };
