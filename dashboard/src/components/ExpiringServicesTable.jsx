import { accountCsvColumns } from '../utils/accounts.js';
import { downloadCSV } from '../utils/csv.js';
import { takesSingular } from '../utils/format.js';
import { SortableHeader, sortRows } from './SortableHeader.jsx';

// The services about to expire, as the Overview's card and its "show all" modal show them
// (#225): the inventory's dedicated servers, VPS and storage services that expire within 30 days
// or already have, as /api/inventory/expiring lists them.

// The badge of each resource type of the services about to expire (CONTEXT.md), its label and
// its colours: those of storage for any other, as the card showed them
const TYPE_BADGES = {
  dedicated_server: { labelKey: 'dedicatedServers', tone: 'bg-red-100 text-red-700' },
  vps: { labelKey: 'vpsInstances', tone: 'bg-amber-100 text-amber-700' },
  storage: { labelKey: 'storageServices', tone: 'bg-green-100 text-green-700' },
};
const badgeOf = (service) => TYPE_BADGES[service.type] ?? TYPE_BADGES.storage;

// The days until a service expires, from today: negative once it has (#74)
const daysLeftOf = (service) => Math.ceil(
  (new Date(service.expiration_date) - new Date()) / (1000 * 60 * 60 * 24),
);

/**
 * The badge of the resource type of a service about to expire, on one line, as a phone would
 * otherwise break « Serveurs dédiés » inside it.
 * @param {object} props
 * @param {{ type: string }} props.service
 * @param {function(string): string} props.t
 * @returns {JSX.Element}
 */
const ExpiringTypeBadge = ({ service, t }) => (
  <span
    className={`px-2 py-0.5 rounded text-xs font-medium whitespace-nowrap ${badgeOf(service).tone}`}
  >
    {t(badgeOf(service).labelKey)}
  </span>
);

/**
 * When a service expires, or since when it has, in the singular or the plural as the language
 * needs (#74): « Expire dans 5 jours », « Expiré depuis 1 jour »; in red within a week.
 * @param {object} props
 * @param {{ expiration_date: string }} props.service
 * @param {string} props.language - The page's, 'fr' or 'en'
 * @param {function(string): string} props.t
 * @returns {JSX.Element}
 */
const ExpirationDelay = ({ service, language, t }) => {
  const daysLeft = daysLeftOf(service);
  const days = Math.abs(daysLeft);
  const singular = takesSingular(days, language);
  return (
    <span className={`text-sm font-medium ${daysLeft <= 7 ? 'text-red-600' : 'text-orange-600'}`}>
      {daysLeft < 0 ? (
        <>{t('expiredSince')} {days} {t(singular ? 'dayAgo' : 'daysAgo')}</>
      ) : (
        <>{t('expiringIn')} {days} {t(singular ? 'day' : 'days')}</>
      )}
    </span>
  );
};

// The value of a service in each column, which the table sorts by (#146): its resource type by
// the label its badge shows, its expiration by its date
const expiringValues = (t) => ({
  type: (s) => t(badgeOf(s).labelKey),
  service: (s) => s.display_name || s.id,
  account: (s) => s.accountName,
  expiration: (s) => s.expiration_date,
});

/**
 * The table of every service about to expire, in the order the server lists them, soonest
 * first, until a header sorts it (sorting, see SortableHeader.jsx). With the Account column of
 * the lists, null when they show none, each service's account too (#123): the services then
 * carry its name, accountName.
 * @param {object} props
 * @param {object[]} props.services - As /api/inventory/expiring lists them
 * @param {object} props.sorting - The table's order, as useTableSorts() gives it
 * @param {?{ label: string }} props.accountColumn
 * @param {string} props.language
 * @param {function(string): string} props.t
 * @returns {JSX.Element}
 */
const ExpiringServicesTable = ({ services, sorting, accountColumn, language, t }) => (
  <table className="w-full text-sm">
    <thead>
      <tr className="border-b bg-gray-50">
        <SortableHeader
          column="type" kind="text" sorting={sorting} t={t}
          className="p-3 text-left font-medium"
        >
          {t('type')}
        </SortableHeader>
        <SortableHeader
          column="service" kind="text" sorting={sorting} t={t}
          className="p-3 text-left font-medium"
        >
          {t('service')}
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
          column="expiration" kind="date" sorting={sorting} t={t}
          className="p-3 text-left font-medium"
        >
          {t('expiration')}
        </SortableHeader>
      </tr>
    </thead>
    <tbody>
      {sortRows(services, sorting.sort, expiringValues(t), language).map((s) => (
        <tr key={`${s.type} ${s.id}`} className="border-b hover:bg-gray-50">
          <td className="p-3"><ExpiringTypeBadge service={s} t={t} /></td>
          <td className="p-3 font-medium">{s.display_name || s.id}</td>
          {accountColumn && <td className="p-3 text-gray-600">{s.accountName}</td>}
          <td className="p-3"><ExpirationDelay service={s} language={language} t={t} /></td>
        </tr>
      ))}
    </tbody>
  </table>
);

/**
 * The columns of the CSV file of the services about to expire, for downloadCSV(): the account's
 * after the service's id when the table shows it, as the other lists' (#123, see
 * accountCsvColumns()), and the resource type and the expiration date as the API gives them.
 * @param {string} language - The page's, 'fr' or 'en'
 * @param {?{ label: string }} [accountColumn] - The Account column of the lists
 *   (accountColumnOf()), null when they show none
 * @returns {{ key: string, label: string }[]}
 */
const expiringServiceCsvColumns = (language, accountColumn = null) => [
  { key: 'display_name', label: language === 'en' ? 'Name' : 'Nom' },
  { key: 'id', label: 'ID' },
  ...accountCsvColumns(accountColumn),
  { key: 'type', label: 'Type' },
  { key: 'expiration_date', label: language === 'en' ? 'Expiration date' : 'Date d\'expiration' },
];

/**
 * Downloads the services about to expire as CSV, from the card and from its modal alike.
 * @param {object[]} services - With their account's name, accountName, when the lists name it
 * @param {string} language - The page's, 'fr' or 'en'
 * @param {?{ label: string }} accountColumn - The Account column of the lists, null without one
 */
const downloadExpiringServices = (services, language, accountColumn) => downloadCSV(
  services, expiringServiceCsvColumns(language, accountColumn), 'ovh-expiring-services',
);

export {
  ExpiringTypeBadge, ExpirationDelay, ExpiringServicesTable, downloadExpiringServices,
};
