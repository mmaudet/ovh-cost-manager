import { formatMonthLabel } from '../utils/format.js';

// The emission sources of a carbon footprint, in the order the tab shows them: the key of
// each one's figure, and of its label in the translations (see CONTEXT.md)
const EMISSION_SOURCES = ['manufacturing', 'electricity', 'operations'];

// The white block that the tab shows a card or a message in
const PANEL = 'bg-white rounded-xl shadow-sm border border-gray-100';

// A card of the footprint: its label, and its emissions in kg CO2eq
const FootprintCard = ({ label, value, fmt, emphasis = false }) => (
  <div className={`${PANEL} p-5`}>
    <span className="text-gray-500 text-sm">{label}</span>
    <div className={`text-3xl font-bold mt-2 ${emphasis ? 'text-green-700' : 'text-gray-800'}`}>
      {fmt(value)} kgCO₂e
    </div>
  </div>
);

// The Carbon tab (#147), which the shell renders while it is active: what useCarbonTab()
// returns, with the shell's language, translations (t) and amount format (fmt): the carbon
// footprint that OVHcloud's carbon calculator attributes to the month selected, by emission
// source.
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

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <FootprintCard label={t('carbonFootprint')} value={footprint.total} fmt={fmt} emphasis />
        {EMISSION_SOURCES.map(source => (
          <FootprintCard key={source} label={t(source)} value={footprint[source]} fmt={fmt} />
        ))}
      </div>
    </div>
  );
};

export { CarbonTab };
