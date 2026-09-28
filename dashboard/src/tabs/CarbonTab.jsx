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

// The Carbon tab (#147), which the shell renders while it is active: what useCarbonTab()
// returns, with the shell's language, translations (t) and amount format (fmt): the carbon
// footprint that OVHcloud's carbon calculator attributes to the month selected, by emission
// source, or, when that month has none, to the latest month that has one (#152).
const CarbonTab = ({ carbonFootprint, loadingCarbon, failedCarbon, language, t, fmt }) => {
  if (loadingCarbon) {
    return <div className="text-center text-gray-500 py-8">{t('loading')}</div>;
  }
  if (failedCarbon) {
    return (
      <div className="text-center text-red-600 py-8">
        {language === 'en'
          ? 'Could not load the carbon footprint.'
          : "Impossible de charger l'empreinte carbone."}
      </div>
    );
  }

  const { month, shown } = carbonFootprint;
  const { footprint } = shown;
  if (!footprint) {
    return (
      <div className={`${PANEL} p-8 text-center text-gray-500`}>
        {language === 'en'
          ? `${formatMonthLabel(month, language)}: no carbon footprint.`
          : `${formatMonthLabel(month, language)} : pas d'empreinte carbone.`}
      </div>
    );
  }

  // Whether the tab shows the latest month that has a footprint, as the month selected has none
  const fallsBack = shown.month !== month;
  const monthLabel = formatMonthLabel(month, language);
  const shownLabel = formatMonthLabel(shown.month, language);

  return (
    <div className="space-y-6">
      {fallsBack && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-lg p-4 text-sm">
          {language === 'en'
            ? `${monthLabel} has no carbon footprint yet: OVHcloud publishes it once the month is `
              + 'over.'
            : `${monthLabel} n'a pas encore d'empreinte carbone : OVHcloud la publie une fois le `
              + 'mois terminé.'}
        </div>
      )}
      <h3 className="text-lg font-semibold text-gray-800">
        {fallsBack
          ? `${shownLabel} · ${language === 'en'
            ? 'latest month available'
            : 'dernier mois disponible'}`
          : shownLabel}
      </h3>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <FootprintCard label={t('carbonFootprint')} value={footprint.total} fmt={fmt} emphasis>
          <p className="text-xs text-gray-500 mt-1">
            {language === 'en' ? 'Market-based: ' : 'Market-based : '}
            {fmt(footprint.marketBasedTotal)} kgCO₂e
          </p>
        </FootprintCard>
        {EMISSION_SOURCES.map(source => (
          <FootprintCard key={source} label={t(source)} value={footprint[source]} fmt={fmt} />
        ))}
      </div>
      <p className="text-xs text-gray-500">
        {language === 'en'
          ? "The market-based total counts OVHcloud's low-carbon energy contracts instead of each "
            + "datacenter's local electricity mix."
          : "Le total market-based tient compte des contrats d'énergie bas carbone d'OVHcloud, au "
            + 'lieu du mix électrique local de chaque datacenter.'}
      </p>
    </div>
  );
};

export { CarbonTab };
