// One Web Cloud family: service name, latest bill wording, last billed month. With all
// accounts shown on an instance that knows several, each service's account too (#122): the
// items then carry its name, accountName.
const WebCloudTable = ({ items, showAccountColumn, language, t, fmt }) => (
  <table className="w-full text-sm">
    <thead>
      <tr className="border-b bg-gray-50">
        <th className="p-2 text-left font-medium">{language === 'en' ? 'Service' : 'Service'}</th>
        {showAccountColumn && <th className="p-2 text-left font-medium">{t('account')}</th>}
        <th className="p-2 text-left font-medium">{language === 'en' ? 'Bill wording' : 'Libellé de facture'}</th>
        <th className="p-2 text-left font-medium">{language === 'en' ? 'Last billed' : 'Dernière facture'}</th>
        <th className="p-2 text-right font-medium">{language === 'en' ? 'Cost' : 'Coût'}</th>
      </tr>
    </thead>
    <tbody>
      {items.map((item, i) => (
        <tr key={`${item.category}-${item.name}-${i}`} className="border-b hover:bg-gray-50">
          <td className="p-2 font-medium text-xs truncate max-w-[220px]" title={item.name}>{item.name}</td>
          {showAccountColumn && (
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

// The columns of a family's CSV file: the account's after the service's when the table shows
// it, for a spreadsheet to pivot the services by account (#122)
const webCloudCsvColumns = (language, t, showAccountColumn) => [
  { key: 'name', label: language === 'en' ? 'Service' : 'Service' },
  ...(showAccountColumn ? [{ key: 'accountName', label: t('account') }] : []),
  { key: 'category', label: language === 'en' ? 'Family' : 'Famille' },
  { key: 'description', label: language === 'en' ? 'Bill wording' : 'Libellé de facture' },
  { key: 'lineCount', label: language === 'en' ? 'Bill lines' : 'Lignes de facture' },
  { key: 'firstDate', label: language === 'en' ? 'First billed' : 'Première facture' },
  { key: 'lastDate', label: language === 'en' ? 'Last billed' : 'Dernière facture' },
  { key: 'total', label: language === 'en' ? 'Cost (EUR)' : 'Coût (EUR)' }
];

export { WebCloudTable, webCloudCsvColumns };
