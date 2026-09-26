import Modal from '../components/Modal.jsx';
import TableActions from '../components/TableActions.jsx';
import { WebCloudTable, webCloudCsvColumns } from '../components/WebCloudFamilyTable.jsx';
import { downloadCSV } from '../utils/csv.js';
import { formatYearMonth } from '../utils/format.js';

// Web Cloud families, in display order. Each one gets a card and a table.
const WEB_CLOUD_CATEGORIES = [
  { key: 'domain', labelKey: 'domains', color: 'text-violet-600' },
  { key: 'dns_zone', labelKey: 'dnsZones', color: 'text-sky-600' },
  { key: 'hosting', labelKey: 'webHosting', color: 'text-blue-600' },
  { key: 'email', labelKey: 'emails', color: 'text-pink-600' },
  { key: 'option', labelKey: 'hostingOptions', color: 'text-gray-600' }
];

// The Web Cloud tab, which the shell renders while it is active: what useWebCloudTab()
// returns, with the shell's language, translations (t) and amount format (fmt).
const WebCloudTab = ({
  webCloudPeriod, webCloudSummary, webCloudItems, loadingWebCloud, failedWebCloud,
  setShowAllWebCloud, language, t, fmt,
}) => (
  <div className="space-y-6">
    <div className="text-sm text-gray-500">
      {language === 'en' ? 'Rolling 12 months' : '12 mois glissants'}
      {webCloudPeriod && (
        <span className="ml-1 text-gray-400">
          ({formatYearMonth(webCloudPeriod.from.slice(0, 7), language)} → {formatYearMonth(webCloudPeriod.to.slice(0, 7), language)})
        </span>
      )}
      <span className="ml-2 text-gray-400">
        {language === 'en'
          ? '· domains and hosting renew yearly, a single month would only show a slice'
          : '· domaines et hébergements se renouvellent à l\'année, un seul mois n\'en montrerait qu\'une partie'}
      </span>
    </div>

    {/* Web Cloud summary cards, once both answers have arrived (#62) */}
    {!loadingWebCloud && !failedWebCloud && (
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        {WEB_CLOUD_CATEGORIES.map(cat => (
          <div key={cat.key} className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
            <span className="text-gray-500 text-sm">{t(cat.labelKey)}</span>
            <div className={`text-3xl font-bold ${cat.color} mt-2`}>
              {webCloudSummary?.[cat.key]?.count || 0}
            </div>
            {webCloudSummary?.[cat.key]?.total > 0 && (
              <p className="text-xs text-gray-400">{fmt(webCloudSummary[cat.key].total)}€</p>
            )}
          </div>
        ))}
        <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
          <span className="text-gray-500 text-sm">Total</span>
          <div className="text-3xl font-bold text-gray-900 mt-2">
            {fmt(webCloudSummary?.total || 0)}€
          </div>
        </div>
      </div>
    )}

    {/* Web Cloud is read from the bills: the domain, hosting and email
        API routes are not granted to the credentials this project asks for.
        Once either answer failed, the tab says it could not load them, and
        until both arrive, that it is loading, in the words of the page's
        loading screen (#62). */}
    {failedWebCloud ? (
      <div className="text-center text-red-600 py-8">
        {language === 'en'
          ? 'Could not load the Web Cloud data.'
          : 'Impossible de charger les données Web Cloud.'}
      </div>
    ) : loadingWebCloud ? (
      <div className="text-center text-gray-500 py-8">{t('loading')}</div>
    ) : webCloudItems.length === 0 ? (
      <div className="bg-white rounded-xl p-8 shadow-sm border border-gray-100 text-center text-gray-400">
        {language === 'en' ? 'No Web Cloud service billed over this period' : 'Aucun service Web Cloud facturé sur cette période'}
      </div>
    ) : (
      WEB_CLOUD_CATEGORIES.map(cat => {
        const items = webCloudItems.filter(i => i.category === cat.key);
        if (!items.length) return null;
        const total = items.reduce((sum, i) => sum + (i.total || 0), 0);
        return (
          <div key={cat.key} className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
            <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <span>
                {t(cat.labelKey)} ({items.length})
                <span className={`ml-2 text-sm font-normal ${cat.color}`}>{fmt(total)}€</span>
              </span>
              <TableActions
                language={language}
                onShowAll={() => setShowAllWebCloud(cat.key)}
                onExport={() => downloadCSV(
                  items,
                  webCloudCsvColumns(language),
                  `ovh-${cat.key}-${webCloudPeriod ? webCloudPeriod.from.slice(0, 7) + '-to-' + webCloudPeriod.to.slice(0, 7) : 'export'}`
                )}
              />
            </h3>
            {/* ~11 rows before scrolling, the full list is one click away */}
            <div className="overflow-auto max-h-[430px]">
              <WebCloudTable items={items} language={language} fmt={fmt} />
            </div>
          </div>
        );
      })
    )}
  </div>
);

// The "show all" modal of a Web Cloud family, which the shell renders after the page
// column, whatever the active tab, so that its backdrop covers the whole page: see
// docs/adr/0001-tab-state-lives-in-the-dashboard-shell.md
const WebCloudTabModals = ({
  webCloudPeriod, webCloudItems, showAllWebCloud, setShowAllWebCloud,
  language, t, fmt,
}) => (
  <>
    {(() => {
      const cat = WEB_CLOUD_CATEGORIES.find(c => c.key === showAllWebCloud);
      const items = cat ? webCloudItems.filter(i => i.category === cat.key) : [];
      return (
        <Modal
          open={!!cat}
          onClose={() => setShowAllWebCloud(null)}
          maxWidth="max-w-5xl"
          title={cat ? (
            <>
              {t(cat.labelKey)} ({items.length})
              <span className={`ml-2 text-sm font-normal ${cat.color}`}>
                {fmt(items.reduce((sum, i) => sum + (i.total || 0), 0))}€
              </span>
            </>
          ) : ''}
          actions={cat && (
            <TableActions
              language={language}
              onExport={() => downloadCSV(
                items,
                webCloudCsvColumns(language),
                `ovh-${cat.key}-${webCloudPeriod ? webCloudPeriod.from.slice(0, 7) + '-to-' + webCloudPeriod.to.slice(0, 7) : 'export'}`
              )}
            />
          )}
        >
          <WebCloudTable items={items} language={language} fmt={fmt} />
        </Modal>
      );
    })()}
  </>
);

export { WebCloudTab, WebCloudTabModals };
