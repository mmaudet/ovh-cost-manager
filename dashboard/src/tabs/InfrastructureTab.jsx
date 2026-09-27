import Modal from '../components/Modal.jsx';
import TableActions from '../components/TableActions.jsx';
import { ServersTable, serverCsvColumns } from '../components/ServersTable.jsx';
import { withAccountNames } from '../utils/accounts.js';
import { downloadCSV } from '../utils/csv.js';
import { fmtBytes, fmtMemory, formatMonthLabel } from '../utils/format.js';

// Resource types the Infrastructure tab leaves out: Public Cloud has its own
// tab, and domains moved to Web Cloud, .ovh ones included (web_cloud type).
// Note that part of the 'other' type also shows up in Web Cloud (hosting
// options, mail), it is kept here because the type is a catch-all and would
// hide non Web Cloud lines.
const INFRA_EXCLUDED_TYPES = ['cloud_project', 'domain', 'web_cloud'];

// The bill lines of the open resource type by service, under it: with the Account column of
// the lists, null when they show none, each service's account too, the services then carrying
// its name, accountName (#123)
const BillLinesTable = ({ services, accountColumn, language, fmt }) => (
  <div className="ml-6 mt-2 mb-3">
    <div className="overflow-x-auto max-h-64 overflow-y-auto rounded-lg border border-gray-200">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-gray-50">
          <tr className="border-b">
            <th className="p-2 text-left font-medium">Service</th>
            {accountColumn && <th className="p-2 text-left font-medium">{accountColumn.label}</th>}
            <th className="p-2 text-left font-medium">Description</th>
            <th className="p-2 text-right font-medium">
              {language === 'en' ? 'Amount' : 'Montant'}
            </th>
          </tr>
        </thead>
        <tbody>
          {/* A service billed to several accounts has a row for each (#123) */}
          {services.map((item, i) => (
            <tr key={i} className="border-b hover:bg-gray-50">
              <td className="p-2 font-mono text-xs text-gray-600">{item.domain}</td>
              {accountColumn && <td className="p-2 text-xs text-gray-600">{item.accountName}</td>}
              <td className="p-2 text-gray-700 truncate max-w-xs" title={item.description}>
                {item.description}
              </td>
              <td className="p-2 text-right font-medium whitespace-nowrap">{fmt(item.total)}€</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </div>
);

// The Infrastructure tab, which the shell renders while it is active: what
// useInfrastructureTab() returns, with the shell's language, translations (t), amount format
// (fmt) and selected month, the month's costs by resource type, which load at page start,
// and the resource type whose bill lines are open, with its setter: shared state, see
// docs/adr/0001-tab-state-lives-in-the-dashboard-shell.md. Its lists name the account of each
// service in the Account column of the shell (accountColumn), when it shows one (#123).
const InfrastructureTab = ({
  inventoryServers, inventoryVps, inventoryStorage, resourceTypeDetails, setShowAllServers,
  accountColumn, language, t, fmt, selectedMonth, byResourceType,
  selectedResourceType, setSelectedResourceType,
}) => {
  const servers = withAccountNames(inventoryServers, accountColumn);
  const vpsInstances = withAccountNames(inventoryVps, accountColumn);
  const storageServices = withAccountNames(inventoryStorage, accountColumn);
  const billedServices = withAccountNames(resourceTypeDetails, accountColumn);

  return (
    <div className="space-y-6">
      {/* Infrastructure Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 xl:grid-cols-8 gap-4">
        {[
          {
            type: 'dedicated_server', label: t('dedicatedServers'),
            color: 'text-red-600', ring: 'ring-red-300',
          },
          {
            type: 'vps', label: t('vpsInstances'), color: 'text-amber-600', ring: 'ring-amber-300',
          },
          {
            type: 'storage', label: t('storageServices'),
            color: 'text-green-600', ring: 'ring-green-300',
          },
          {
            type: 'load_balancer', label: 'Load Balancers',
            color: 'text-cyan-600', ring: 'ring-cyan-300',
          },
          {
            type: 'ip_service', label: language === 'en' ? 'IP Addresses' : 'Adresses IP',
            color: 'text-pink-600', ring: 'ring-pink-300',
          },
          {
            type: 'private_cloud_host',
            label: language === 'en' ? 'Private Cloud Hosts' : 'Hôtes Private Cloud',
            color: 'text-violet-600', ring: 'ring-violet-300',
          },
          {
            type: 'private_cloud_datastore',
            label: language === 'en' ? 'Private Cloud Datastores' : 'Datastores Private Cloud',
            color: 'text-fuchsia-600', ring: 'ring-fuchsia-300',
          },
        ].map(card => {
          const isActive = selectedResourceType === card.type;
          const entry = byResourceType.find(r => r.resource_type === card.type);
          return (
            <div
              key={card.type}
              className={[
                'bg-white rounded-xl p-5 shadow-sm border cursor-pointer transition-all',
                'hover:shadow-md',
                isActive ? `ring-2 ${card.ring} border-transparent` : 'border-gray-100',
              ].join(' ')}
              onClick={() => setSelectedResourceType(isActive ? null : card.type)}
            >
              <span className="text-gray-500 text-sm">{card.label}</span>
              <div className={`text-3xl font-bold ${card.color} mt-2`}>
                {entry?.serviceCount || 0}
              </div>
              <div className="text-xs text-gray-400 mt-1">{fmt(entry?.value || 0)}€</div>
            </div>
          );
        })}
      </div>

      {/* Cost breakdown by resource type (non-cloud) */}
      {byResourceType.filter(r => !INFRA_EXCLUDED_TYPES.includes(r.resource_type)).length > 0 && (
        <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
          <h3 className="font-semibold text-gray-900 mb-4">
            {language === 'en' ? 'Costs by resource type' : 'Coûts par type de ressource'}
            {selectedMonth && (
              <span className="text-sm font-normal text-gray-400 ml-2">
                ({formatMonthLabel(selectedMonth.value, language)})
              </span>
            )}
          </h3>
          <div className="space-y-2">
            {byResourceType.filter(r => !INFRA_EXCLUDED_TYPES.includes(r.resource_type)).map(s => {
              const isSelected = selectedResourceType === s.resource_type;
              return (
                <div key={s.resource_type}>
                  <div
                    className={[
                      'flex items-center gap-3 text-sm rounded-lg px-3 py-2 cursor-pointer',
                      'hover:bg-gray-50',
                      isSelected ? 'bg-gray-100 ring-1 ring-gray-300' : '',
                    ].join(' ')}
                    onClick={() => setSelectedResourceType(isSelected ? null : s.resource_type)}
                  >
                    <div
                      className="w-3 h-3 rounded-full flex-shrink-0"
                      style={{ backgroundColor: s.color }}
                    />
                    <span className="text-gray-700 font-medium">{s.name}</span>
                    <span className="ml-auto font-bold">{fmt(s.value)}€</span>
                    <span className="text-gray-400 text-xs">{isSelected ? '▲' : '▼'}</span>
                  </div>
                  {isSelected && billedServices.length > 0 && (
                    <BillLinesTable
                      services={billedServices} accountColumn={accountColumn}
                      language={language} fmt={fmt}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Dedicated Servers Table */}
      {servers.length > 0 && (
        <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
          <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <span>{t('dedicatedServers')} ({servers.length})</span>
            <TableActions
              language={language}
              onShowAll={() => setShowAllServers(true)}
              onExport={() => downloadCSV(
                servers, serverCsvColumns(language, accountColumn), 'ovh-dedicated-servers',
              )}
            />
          </h3>
          {/* ~11 rows before scrolling, the full list is one click away */}
          <div className="overflow-auto max-h-[430px]">
            <ServersTable
              servers={servers} accountColumn={accountColumn} language={language} t={t}
            />
          </div>
        </div>
      )}

      {/* VPS Table */}
      {vpsInstances.length > 0 && (
        <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
          <h3 className="font-semibold text-gray-900 mb-4">{t('vpsInstances')}</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-gray-50">
                  <th className="p-3 text-left font-medium">ID</th>
                  {accountColumn && (
                    <th className="p-3 text-left font-medium">{accountColumn.label}</th>
                  )}
                  <th className="p-3 text-left font-medium">
                    {language === 'en' ? 'Model' : 'Modèle'}
                  </th>
                  <th className="p-3 text-left font-medium">{t('region')}</th>
                  <th className="p-3 text-left font-medium">{t('specs')}</th>
                  <th className="p-3 text-left font-medium">{t('state')}</th>
                  <th className="p-3 text-left font-medium">{t('expirationDate')}</th>
                </tr>
              </thead>
              <tbody>
                {vpsInstances.map(v => (
                  <tr key={v.id} className="border-b hover:bg-gray-50">
                    <td className="p-3 font-medium">{v.display_name || v.id}</td>
                    {accountColumn && <td className="p-3 text-gray-600">{v.accountName}</td>}
                    <td className="p-3">{v.model}</td>
                    <td className="p-3">{v.zone}</td>
                    {/* In the units and number format of the language (#88): the RAM in powers
                        of 1024, as OVH names it, the disk in GB in powers of 1000. The import
                        stores 0 for a size the API did not give: "-", as for the servers */}
                    <td className="p-3 text-xs">
                      {v.vcpus} vCPU / {v.ram_mb ? fmtMemory(v.ram_mb, language) : '-'}
                      {' / '}{v.disk_gb ? fmtBytes(v.disk_gb * 1e9, language) : '-'}
                    </td>
                    <td className="p-3">
                      <span
                        className={[
                          'px-2 py-0.5 rounded text-xs font-medium',
                          v.state === 'running'
                            ? 'bg-green-100 text-green-700'
                            : 'bg-gray-100 text-gray-700',
                        ].join(' ')}
                      >
                        {v.state}
                      </span>
                    </td>
                    <td className="p-3">{v.expiration_date || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Storage Table */}
      {storageServices.length > 0 && (
        <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
          <h3 className="font-semibold text-gray-900 mb-4">{t('storageServices')}</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-gray-50">
                  <th className="p-3 text-left font-medium">ID</th>
                  {accountColumn && (
                    <th className="p-3 text-left font-medium">{accountColumn.label}</th>
                  )}
                  <th className="p-3 text-left font-medium">Type</th>
                  <th className="p-3 text-left font-medium">{t('region')}</th>
                  <th className="p-3 text-right font-medium">
                    {language === 'en' ? 'Size' : 'Taille'}
                  </th>
                  <th className="p-3 text-right font-medium">Shares</th>
                  <th className="p-3 text-left font-medium">{t('expirationDate')}</th>
                </tr>
              </thead>
              <tbody>
                {storageServices.map(s => (
                  <tr key={s.id} className="border-b hover:bg-gray-50">
                    <td className="p-3 font-medium">{s.display_name || s.id}</td>
                    {accountColumn && <td className="p-3 text-gray-600">{s.accountName}</td>}
                    <td className="p-3">{s.service_type}</td>
                    <td className="p-3">{s.region}</td>
                    {/* In GB, in the units and number format of the language, as the volumes of
                        the Public Cloud tab (#88), and "-" when the API did not give it (0) */}
                    <td className="p-3 text-right">
                      {s.total_size_gb ? fmtBytes(s.total_size_gb * 1e9, language) : '-'}
                    </td>
                    <td className="p-3 text-right">{s.share_count}</td>
                    <td className="p-3">{s.expiration_date || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

// The "show all" modal of the dedicated servers, which the shell renders after the page
// column, whatever the active tab, so that its backdrop covers the whole page: see
// docs/adr/0001-tab-state-lives-in-the-dashboard-shell.md. It names the account of each
// server as the panel does (#123).
const InfrastructureTabModals = ({
  inventoryServers, showAllServers, setShowAllServers,
  accountColumn, language, t,
}) => {
  const servers = withAccountNames(inventoryServers, accountColumn);
  return (
    <Modal
      open={showAllServers}
      onClose={() => setShowAllServers(false)}
      maxWidth="max-w-6xl"
      title={`${t('dedicatedServers')} (${servers.length})`}
      actions={
        <TableActions
          language={language}
          onExport={() => downloadCSV(
            servers, serverCsvColumns(language, accountColumn), 'ovh-dedicated-servers',
          )}
        />
      }
    >
      <ServersTable servers={servers} accountColumn={accountColumn} language={language} t={t} />
    </Modal>
  );
};

export { InfrastructureTab, InfrastructureTabModals };
