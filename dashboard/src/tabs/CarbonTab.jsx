import { formatMonthLabel } from '../utils/format.js';

// The emission sources of a carbon footprint, in the order the tab shows them: the key of
// each one's figure, and of its label in the translations (see CONTEXT.md)
const EMISSION_SOURCES = ['manufacturing', 'electricity', 'operations'];

// The white block that the tab shows a card or a message in
const PANEL = 'bg-white rounded-xl shadow-sm border border-gray-100';

// A card of the footprint: its label, its emissions in kg CO2eq, and what it adds to them
const FootprintCard = ({ label, value, fmt, emphasis = false, children = null }) => (
  <div className={`${PANEL} p-5`}>
    <span className="text-gray-500 text-sm">{label}</span>
    <div className={`text-3xl font-bold mt-2 ${emphasis ? 'text-green-700' : 'text-gray-800'}`}>
      {fmt(value)} kgCO₂e
    </div>
    {children}
  </div>
);

// Why the month selected shows another month's footprint (#152): OVHcloud has not published
// a month after the latest it gave yet, while an older month without one will never have it
function missingMonthNotice(missingMonth, shownMonth, language) {
  const label = formatMonthLabel(missingMonth, language);
  if (missingMonth > shownMonth) {
    return language === 'en'
      ? `${label} has no carbon footprint yet: OVHcloud publishes it once the month is over.`
      : `${label} n'a pas encore d'empreinte carbone : OVHcloud la publie une fois le mois `
        + 'terminé.';
  }
  return language === 'en'
    ? `${label} has no carbon footprint.`
    : `${label} n'a pas d'empreinte carbone.`;
}

// OVHcloud's guide to the carbon footprint, which lists the services it covers
const GUIDE = (language) => `https://docs.ovhcloud.com/${language === 'en' ? 'en' : 'fr'}`
  + '/guides/account-and-service-management/managing-billing-payments-and-services/'
  + 'carbon-footprint';

// How to get a carbon footprint: the right to add to the account's key, and the import option
// (#153)
const HowToGetOne = ({ language }) => {
  const code = (text) => <code className="text-xs bg-gray-100 rounded px-1">{text}</code>;
  const guide = (text) => (
    <a href={GUIDE(language)} className="text-blue-600 underline" target="_blank"
      rel="noreferrer">
      {text}
    </a>
  );
  return language === 'en' ? (
    <>
      No carbon footprint yet. To import it, add the right{' '}
      {code('POST /me/carbonCalculator/csv')} to the account's API key, and import with{' '}
      {code('--include-carbon')}, which{' '}
      {code('--all')} includes. OVHcloud does not compute the footprint of all its services:
      see {guide('the list of those it covers')}.
    </>
  ) : (
    <>
      Pas encore d'empreinte carbone. Pour l'importer, ajoutez à la clé API du compte le
      droit {code('POST /me/carbonCalculator/csv')}, et importez avec{' '}
      {code('--include-carbon')}, que {code('--all')} comprend. OVHcloud ne calcule pas
      l'empreinte de tous ses services : voir {guide("la liste de ceux qu'il couvre")}.
    </>
  );
};

// Why the account shown has no carbon footprint at all (#153), from what the accounts route
// says of it: the Unknown account never has one, an account that the configuration no longer
// lists is no longer imported, and any other account, or all of them, has not imported one
const NoFootprint = ({ accounts, selectedAccount, language, t }) => {
  const shownAccount = accounts?.find(({ id }) => id === selectedAccount);
  if (shownAccount?.unknown) return t('carbonUnknownAccount');
  if (shownAccount && !shownAccount.configured) return t('carbonNoLongerImported');
  return <HowToGetOne language={language} />;
};

// The Carbon tab (#147), which the shell renders while it is active: what useCarbonTab()
// returns, with the shell's language, translations (t) and amount format (fmt), the accounts
// of the instance and the account shown (#153), and the Account column of the lists, which
// names an account when all of them are shown: the carbon footprint that OVHcloud's carbon
// calculator attributes to the month selected, by emission source, or, when that month has
// none, to the latest month that has one (#152).
const CarbonTab = ({
  carbonFootprint, missingMonth, loadingCarbon, failedCarbon, language, t, fmt,
  accounts, selectedAccount, accountColumn,
}) => {
  if (loadingCarbon) {
    return <div className="text-center text-gray-500 py-8">{t('loading')}</div>;
  }
  if (failedCarbon) {
    return <div className="text-center text-red-600 py-8">{t('carbonFailed')}</div>;
  }

  const { month, footprint, accountsWithout } = carbonFootprint;
  if (!footprint) {
    return (
      <div className={`${PANEL} p-8 text-center text-gray-500`}>
        <NoFootprint
          accounts={accounts} selectedAccount={selectedAccount} language={language} t={t}
        />
      </div>
    );
  }

  // French puts a space before a colon, English none
  const colon = language === 'en' ? ':' : ' :';

  return (
    <div className="space-y-6">
      {missingMonth && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-lg p-4 text-sm">
          {missingMonthNotice(missingMonth, month, language)}
        </div>
      )}
      <h3 className="text-lg font-semibold text-gray-800">
        {formatMonthLabel(month, language)}
        {missingMonth && ` · ${t('latestMonthAvailable')}`}
      </h3>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <FootprintCard label={t('carbonFootprint')} value={footprint.total} fmt={fmt} emphasis>
          <p className="text-xs text-gray-500 mt-1">
            {t('marketBased')}{colon} {fmt(footprint.marketBasedTotal)} kgCO₂e
          </p>
          <p className="text-xs text-gray-400 mt-1">{t('marketBasedExplanation')}</p>
        </FootprintCard>
        {EMISSION_SOURCES.map(source => (
          <FootprintCard key={source} label={t(source)} value={footprint[source]} fmt={fmt} />
        ))}
      </div>
      {/* With all accounts, their sum leaves out those without a footprint (#153) */}
      {accountsWithout?.length > 0 && (
        <p className="text-sm text-gray-600">
          {language === 'en' ? 'Without a carbon footprint this month: ' : 'Sans empreinte '
            + 'carbone pour ce mois : '}
          {accountsWithout.map(nic => accountColumn?.nameOf(nic) ?? nic).join(', ')}.
        </p>
      )}
    </div>
  );
};

export { CarbonTab };
