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

// The Carbon tab (#147), which the shell renders while it is active: what useCarbonTab()
// returns, with the shell's language, translations (t) and amount format (fmt): the carbon
// footprint that OVHcloud's carbon calculator attributes to the month selected, by emission
// source, or, when that month has none, to the latest month that has one (#152).
const CarbonTab = ({
  carbonFootprint, missingMonth, loadingCarbon, failedCarbon, language, t, fmt,
}) => {
  if (loadingCarbon) {
    return <div className="text-center text-gray-500 py-8">{t('loading')}</div>;
  }
  if (failedCarbon) {
    return <div className="text-center text-red-600 py-8">{t('carbonFailed')}</div>;
  }

  const { month, footprint } = carbonFootprint;
  if (!footprint) {
    return (
      <div className={`${PANEL} p-8 text-center text-gray-500`}>
        {language === 'en'
          ? `${formatMonthLabel(month, language)}: no carbon footprint.`
          : `${formatMonthLabel(month, language)} : pas d'empreinte carbone.`}
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
    </div>
  );
};

export { CarbonTab };
