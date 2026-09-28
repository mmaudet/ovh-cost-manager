import { accountCsvColumns } from '../utils/accounts.js';
import { fmtMemory } from '../utils/format.js';
import { SortableHeader, sortRows } from './SortableHeader.jsx';

// The value of a server in each column, which the table sorts by (#146): none for a RAM that
// the API did not give, which the import stores as 0 and the table shows as "-"
const SERVER_VALUES = {
  id: (s) => s.display_name || s.id,
  account: (s) => s.accountName,
  datacenter: (s) => s.datacenter,
  cpu: (s) => s.cpu,
  ram: (s) => s.ram_size || null,
  state: (s) => s.state,
  expiration: (s) => s.expiration_date,
  renewal: (s) => s.renewal_type,
};

// Dedicated servers inventory, shared by the inline panel and its modal, which sort it alike
// (sorting, see SortableHeader.jsx). With the Account column of the lists, null when they
// show none, each server's account too (#123): the servers then carry its name, accountName.
const ServersTable = ({ servers, sorting, accountColumn, language, t }) => (
  <table className="w-full text-sm">
    <thead>
      <tr className="border-b bg-gray-50">
        <SortableHeader
          column="id" kind="text" sorting={sorting} t={t}
          className="p-3 text-left font-medium"
        >
          ID
        </SortableHeader>
        {accountColumn && (
          <SortableHeader
            column="account" kind="text" sorting={sorting} t={t}
            className="p-3 text-left font-medium"
          >
            {accountColumn.label}
          </SortableHeader>
        )}
        <SortableHeader
          column="datacenter" kind="text" sorting={sorting} t={t}
          className="p-3 text-left font-medium"
        >
          {t('datacenter')}
        </SortableHeader>
        <SortableHeader
          column="cpu" kind="text" sorting={sorting} t={t}
          className="p-3 text-left font-medium"
        >
          CPU
        </SortableHeader>
        <SortableHeader
          column="ram" kind="number" sorting={sorting} t={t}
          className="p-3 text-left font-medium"
        >
          {t('ram')}
        </SortableHeader>
        <SortableHeader
          column="state" kind="text" sorting={sorting} t={t}
          className="p-3 text-left font-medium"
        >
          {t('state')}
        </SortableHeader>
        <SortableHeader
          column="expiration" kind="date" sorting={sorting} t={t}
          className="p-3 text-left font-medium"
        >
          {t('expirationDate')}
        </SortableHeader>
        <SortableHeader
          column="renewal" kind="text" sorting={sorting} t={t}
          className="p-3 text-left font-medium"
        >
          {t('renewal')}
        </SortableHeader>
      </tr>
    </thead>
    <tbody>
      {sortRows(servers, sorting.sort, SERVER_VALUES, language).map(s => (
        <tr key={s.id} className="border-b hover:bg-gray-50">
          <td className="p-3 font-medium">{s.display_name || s.id}</td>
          {accountColumn && <td className="p-3 text-gray-600">{s.accountName}</td>}
          <td className="p-3">{s.datacenter}</td>
          <td className="p-3">{s.cpu}</td>
          {/* In the units and number format of the language, and in powers of 1024 (#88). The
              import stores 0 for a RAM the API did not give: "-" */}
          <td className="p-3">{s.ram_size ? fmtMemory(s.ram_size, language) : '-'}</td>
          <td className="p-3">
            <span className={`px-2 py-0.5 rounded text-xs font-medium ${s.state === 'ok' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
              {s.state}
            </span>
          </td>
          <td className="p-3">{s.expiration_date || '-'}</td>
          <td className="p-3">{s.renewal_type || '-'}</td>
        </tr>
      ))}
    </tbody>
  </table>
);

/**
 * The columns of the servers' CSV file, for downloadCSV(): the account's after the server's
 * id when the table shows it, for a spreadsheet to pivot the servers by account (#123, see
 * accountCsvColumns()).
 * @param {string} language - The page's, 'fr' or 'en'
 * @param {?{ label: string }} [accountColumn] - The Account column of the lists
 *   (accountColumnOf()), null when they show none
 * @returns {{ key: string, label: string }[]}
 */
const serverCsvColumns = (language, accountColumn = null) => [
  { key: 'display_name', label: language === 'en' ? 'Name' : 'Nom' },
  { key: 'id', label: 'ID' },
  ...accountCsvColumns(accountColumn),
  { key: 'datacenter', label: language === 'en' ? 'Datacenter' : 'Datacentre' },
  { key: 'cpu', label: 'CPU' },
  // In megabytes, as the API gives them, named in the units of the language (#88)
  { key: 'ram_size', label: language === 'en' ? 'RAM (MB)' : 'RAM (Mo)' },
  { key: 'os', label: 'OS' },
  { key: 'state', label: language === 'en' ? 'State' : 'État' },
  { key: 'expiration_date', label: language === 'en' ? 'Expiration date' : 'Date d\'expiration' },
  { key: 'renewal_type', label: language === 'en' ? 'Renewal' : 'Renouvellement' }
];

export { ServersTable, serverCsvColumns };
