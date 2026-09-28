import { formatMonthLabel } from '../utils/format.js';

// The emission sources of a carbon footprint, in the order the tab shows them (see CONTEXT.md)
const EMISSION_SOURCES = [
  { key: 'manufacturing', fr: 'Fabrication', en: 'Manufacturing' },
  { key: 'electricity', fr: 'Électricité', en: 'Electricity' },
  { key: 'operations', fr: 'Opérations', en: 'Operations' },
];

// A card of the footprint: its label, and its emissions in kg CO2eq
const FootprintCard = ({ label, value, fmt, emphasis = false }) => (
  <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
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
      <div className="bg-white rounded-xl p-8 shadow-sm border border-gray-100 text-center text-gray-500">
        {language === 'en'
          ? `${formatMonthLabel(month, language)}: no carbon footprint.`
          : `${formatMonthLabel(month, language)} : pas d'empreinte carbone.`}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <FootprintCard
          label={language === 'en' ? 'Carbon footprint' : 'Empreinte carbone'}
          value={footprint.total} fmt={fmt} emphasis
        />
        {EMISSION_SOURCES.map(source => (
          <FootprintCard
            key={source.key} label={source[language === 'en' ? 'en' : 'fr']}
            value={footprint[source.key]} fmt={fmt}
          />
        ))}
      </div>
    </div>
  );
};

export { CarbonTab };
