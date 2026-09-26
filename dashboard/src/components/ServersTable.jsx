import { fmtMemory } from '../utils/format.js';

// Dedicated servers inventory, shared by the inline panel and its modal.
const ServersTable = ({ servers, language, t }) => (
  <table className="w-full text-sm">
    <thead>
      <tr className="border-b bg-gray-50">
        <th className="p-3 text-left font-medium">ID</th>
        <th className="p-3 text-left font-medium">{t('datacenter')}</th>
        <th className="p-3 text-left font-medium">CPU</th>
        <th className="p-3 text-left font-medium">{t('ram')}</th>
        <th className="p-3 text-left font-medium">{t('state')}</th>
        <th className="p-3 text-left font-medium">{t('expirationDate')}</th>
        <th className="p-3 text-left font-medium">{t('renewal')}</th>
      </tr>
    </thead>
    <tbody>
      {servers.map(s => (
        <tr key={s.id} className="border-b hover:bg-gray-50">
          <td className="p-3 font-medium">{s.display_name || s.id}</td>
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

const serverCsvColumns = (language) => [
  { key: 'display_name', label: language === 'en' ? 'Name' : 'Nom' },
  { key: 'id', label: 'ID' },
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
