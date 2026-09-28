import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import {
  formatDecimal, formatMonthLabel, formatMonthName, formatWholeNumber, formatYearMonth,
} from '../utils/format.js';

// The emission sources of a carbon footprint, in the order the tab shows them: the key of
// each one's figure, and of its label in the translations (see CONTEXT.md)
const EMISSION_SOURCES = ['manufacturing', 'electricity', 'operations'];

// The color of each emission source in the trend's chart (#154): the first three slots of a
// categorical palette checked for color vision deficiencies, in the order of the sources. The
// third is below 3:1 against the white panel: the legend names each one, and the table gives
// every figure.
const SOURCE_COLORS = {
  manufacturing: '#2a78d6',
  electricity: '#eb6834',
  operations: '#1baf7a',
};

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
// a month after the latest it gave yet, while an older month without one will never have it,
// nor any month of an account that is no longer imported (#153)
function missingMonthNotice(missingMonth, shownMonth, accountImport, language) {
  const label = formatMonthLabel(missingMonth, language);
  if (accountImport === 'removed') {
    return language === 'en'
      ? `${label} has no carbon footprint: this account is no longer imported.`
      : `${label} n'a pas d'empreinte carbone : ce compte n'est plus importé.`;
  }
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

// The accounts that the footprint of all accounts leaves out, as it has none for the month
// (#153)
const withoutFootprintSentence = (month, names, language) => (language === 'en'
  ? `Without a carbon footprint in ${formatMonthName(month, language)}: ${names}.`
  : `Sans empreinte carbone en ${formatMonthName(month, language)} : ${names}.`);

// OVHcloud's guide to the carbon footprint, which lists the services it covers
const guideUrl = (language) => `https://docs.ovhcloud.com/${language === 'en' ? 'en' : 'fr'}`
  + '/guides/account-and-service-management/managing-billing-payments-and-services/'
  + 'carbon-footprint';

// How to get a carbon footprint: the right to add to the account's key, and the import option
// (#153)
const HowToGetOne = ({ language }) => {
  const code = (text) => <code className="text-xs bg-gray-100 rounded px-1">{text}</code>;
  const guideLink = (text) => (
    <a href={guideUrl(language)} className="text-blue-600 underline" target="_blank"
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
      see {guideLink('the list of those it covers')}.
    </>
  ) : (
    <>
      Pas encore d'empreinte carbone. Pour l'importer, ajoutez à la clé API du compte le
      droit {code('POST /me/carbonCalculator/csv')}, et importez avec{' '}
      {code('--include-carbon')}, que {code('--all')} comprend. OVHcloud ne calcule pas
      l'empreinte de tous ses services : voir {guideLink("la liste de ceux qu'il couvre")}.
    </>
  );
};

// Why the account shown has no carbon footprint at all (#153), from how it is imported
// (importStateOf()): the Unknown account never has one, an account that the configuration no
// longer lists is no longer imported, and any other account, or all of them, has not imported
// one
const NoFootprint = ({ accountImport, language, t }) => {
  if (accountImport === 'unknown') return t('carbonUnknownAccount');
  if (accountImport === 'removed') return t('carbonNoLongerImported');
  return <HowToGetOne language={language} />;
};

// The translation keys of the types of footprint lines that the list names (#155); another
// type shows as OVHcloud's file names it
const TYPE_LABELS = {
  BAREMETAL: 'carbonServer',
  'PCI-COMPUTE': 'carbonInstance',
  'PCI-BLOCK-STORAGE': 'carbonVolume',
};

// What a line of the list names: a dedicated server, the servers that OVHcloud's file does not
// name, with their number, or an instance flavor or a volume type
const itemOf = (line, t) => (line.unnamedServers
  ? `${t('carbonUnnamedServers')} (${line.unnamedServers})`
  : line.serverDomain ?? line.name);

// A line's datacenter: none for the servers that the file does not name, all of them for a
// line that the file gives for every datacenter
const datacenterOf = (datacenter, t) => {
  if (!datacenter) return '—';
  return datacenter === 'ALL' ? t('allDatacenters') : datacenter;
};

// Each line of the month's footprint (#155), the largest first, with what its bill lines cost
// in the month of use and its intensity, and the Account column when all accounts are shown
const ListPanel = ({
  carbonLines, loadingLines, failedLines, language, t, fmt, accountColumn,
}) => {
  let content;
  if (loadingLines) {
    content = <p className="text-gray-500 text-sm">{t('loading')}</p>;
  } else if (failedLines) {
    content = <p className="text-red-600 text-sm">{t('carbonListFailed')}</p>;
  } else {
    content = (
      <div className="max-h-96 overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-white">
            <tr className="text-gray-500">
              <th className="text-left font-medium py-1">{t('carbonItem')}</th>
              <th className="text-left font-medium py-1">{t('carbonType')}</th>
              <th className="text-left font-medium py-1">{t('datacenter')}</th>
              <th className="text-right font-medium py-1">{t('carbonFootprintKg')}</th>
              <th className="text-right font-medium py-1">{t('carbonCost')}</th>
              <th className="text-right font-medium py-1">{t('carbonIntensity')}</th>
              {accountColumn && (
                <th className="text-left font-medium py-1 pl-4">{accountColumn.label}</th>
              )}
            </tr>
          </thead>
          <tbody>
            {carbonLines.map((line, index) => (
              <tr key={index} className="border-t border-gray-100">
                <td className="py-1">{itemOf(line, t)}</td>
                <td className="py-1">
                  {TYPE_LABELS[line.type] ? t(TYPE_LABELS[line.type]) : line.type}
                </td>
                <td className="py-1">{datacenterOf(line.datacenter, t)}</td>
                <td className="text-right py-1">{fmt(line.footprint)}</td>
                <td className="text-right py-1">
                  {line.cost === null ? '—' : `${fmt(line.cost)}€`}
                </td>
                <td className="text-right py-1">
                  {line.intensity === null ? '—' : formatDecimal(line.intensity, language, 3)}
                </td>
                {accountColumn && (
                  <td className="py-1 pl-4">{accountColumn.nameOf(line.account)}</td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  return (
    <div className={`${PANEL} p-5 space-y-4`}>
      <h3 className="text-lg font-semibold text-gray-800">{t('carbonList')}</h3>
      {content}
    </div>
  );
};

// The footprint of the 12 months up to the month that the tab shows (#154), stacked by
// emission source, with the table of its figures: a month without a footprint has none, not 0
const TrendPanel = ({ carbonTrend, loadingTrend, failedTrend, language, t, fmt }) => {
  let content;
  if (loadingTrend) {
    content = <p className="text-gray-500 text-sm">{t('loading')}</p>;
  } else if (failedTrend) {
    content = <p className="text-red-600 text-sm">{t('carbonTrendFailed')}</p>;
  } else {
    content = (
      <>
        <ul aria-label={t('emissionSources')} className="flex gap-4 text-sm text-gray-600">
          {EMISSION_SOURCES.map(source => (
            <li key={source} className="flex items-center gap-2">
              <span
                className="inline-block w-3 h-3 rounded-sm"
                style={{ backgroundColor: SOURCE_COLORS[source] }}
              />
              {t(source)}
            </li>
          ))}
        </ul>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={carbonTrend.map(({ month, footprint }) => ({ month, ...footprint }))}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
              <XAxis
                dataKey="month" tick={{ fontSize: 12 }}
                tickFormatter={(yearMonth) => formatYearMonth(yearMonth, language)}
              />
              <YAxis
                tick={{ fontSize: 12 }} width={64}
                tickFormatter={(value) => formatWholeNumber(value, language)}
              />
              <Tooltip
                labelFormatter={(yearMonth) => formatYearMonth(yearMonth, language)}
                formatter={(value, name) => [`${fmt(value)} kgCO₂e`, name]}
              />
              {EMISSION_SOURCES.map((source, index) => (
                <Bar
                  key={source} dataKey={source} name={t(source)} stackId="footprint"
                  fill={SOURCE_COLORS[source]} stroke="#ffffff" strokeWidth={2}
                  radius={index === EMISSION_SOURCES.length - 1 ? [4, 4, 0, 0] : 0}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
        <details>
          <summary className="cursor-pointer text-sm text-gray-500">{t('seeFigures')}</summary>
          <table className="w-full text-sm mt-2">
            <thead>
              <tr className="text-gray-500">
                <th className="text-left font-medium py-1">{t('month')}</th>
                {EMISSION_SOURCES.map(source => (
                  <th key={source} className="text-right font-medium py-1">{t(source)}</th>
                ))}
                <th className="text-right font-medium py-1">Total</th>
              </tr>
            </thead>
            <tbody>
              {carbonTrend.map(({ month, footprint }) => (
                <tr key={month} className="border-t border-gray-100">
                  <td className="py-1">{formatMonthLabel(month, language)}</td>
                  {[...EMISSION_SOURCES, 'total'].map(key => (
                    <td key={key} className="text-right py-1">
                      {footprint ? fmt(footprint[key]) : '—'}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      </>
    );
  }
  return (
    <div className={`${PANEL} p-5 space-y-4`}>
      <h3 className="text-lg font-semibold text-gray-800">{t('carbonTrend')} (kgCO₂e)</h3>
      {content}
    </div>
  );
};

// The Carbon tab (#147), which the shell renders while it is active: what useCarbonTab()
// returns, with the shell's language, translations (t) and amount format (fmt), how the
// account shown is imported (importStateOf(), #153), and the Account column of the lists,
// which names an account when all of them are shown: the carbon footprint that OVHcloud's
// carbon calculator attributes to the month selected, by emission source, or, when that month
// has none, to the latest month that has one (#152).
const CarbonTab = ({
  carbonFootprint, missingMonth, carbonTrend, carbonLines, loadingCarbon, failedCarbon,
  loadingTrend, failedTrend, loadingLines, failedLines, language, t, fmt, accountImport,
  accountColumn,
}) => {
  if (loadingCarbon) {
    return <div className="text-center text-gray-500 py-8">{t('loading')}</div>;
  }
  if (failedCarbon) {
    return <div className="text-center text-red-600 py-8">{t('carbonFailed')}</div>;
  }

  const { month, footprint, accountsWithoutFootprint } = carbonFootprint;
  if (!footprint) {
    return (
      <div className={`${PANEL} p-8 text-center text-gray-500`}>
        <NoFootprint accountImport={accountImport} language={language} t={t} />
      </div>
    );
  }

  // French puts a space before a colon, English none
  const colon = language === 'en' ? ':' : ' :';

  return (
    <div className="space-y-6">
      {missingMonth && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-lg p-4 text-sm">
          {missingMonthNotice(missingMonth, month, accountImport, language)}
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
      {accountsWithoutFootprint?.length > 0 && (
        <p className="text-sm text-gray-600">
          {withoutFootprintSentence(month, accountsWithoutFootprint
            .map(nic => accountColumn?.nameOf(nic) ?? nic).join(', '), language)}
        </p>
      )}
      <ListPanel
        carbonLines={carbonLines} loadingLines={loadingLines} failedLines={failedLines}
        language={language} t={t} fmt={fmt} accountColumn={accountColumn}
      />
      <TrendPanel
        carbonTrend={carbonTrend} loadingTrend={loadingTrend} failedTrend={failedTrend}
        language={language} t={t} fmt={fmt}
      />
    </div>
  );
};

export { CarbonTab };
