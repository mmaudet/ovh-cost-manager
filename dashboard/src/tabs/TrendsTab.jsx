import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line,
} from 'recharts';
import { formatYearMonth } from '../utils/format.js';
import { growthOverPeriod } from '../utils/periodGrowth.js';
import { PERIOD_OPTIONS } from '../utils/trendPeriods.js';

// The Trends tab, which the shell renders while it is active: what useTrendsTab() returns,
// with the shell's language, translations (t) and amount format (fmt).
const TrendsTab = ({
  trendPeriod, monthlyTrend, trendByCategory, hiddenCategories, toggleCategory, gpuTrend,
  language, t, fmt,
}) => {
  const currentPeriodLabel = (PERIOD_OPTIONS.find(o => o.months === trendPeriod) || {}).key;
  // The growth over the period, in percent, from its first month to its last. Two states
  // show none (#65):
  // - N/A, without two months to compare: with no months at all, as when nothing was billed
  //   over the period, since the trend routes give every month of a period with a bill;
  // - "—", with a tooltip, when the first month, at 0 € or less, leaves none to compute.
  const spansTwoMonths = monthlyTrend.length > 1;
  const growth = spansTwoMonths
    ? growthOverPeriod(monthlyTrend[0].cost, monthlyTrend[monthlyTrend.length - 1].cost)
    : null;
  const growthNotComputable = spansTwoMonths && growth === null;

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
        <h3 className="font-semibold text-gray-900 mb-4">{t('costEvolutionOver')} {t(currentPeriodLabel)}</h3>
        {monthlyTrend.length > 0 ? (
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={monthlyTrend}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="yearMonth" tickFormatter={(ym) => formatYearMonth(ym, language)} />
                <YAxis tickFormatter={(v) => `${v}€`} />
                <Tooltip labelFormatter={(ym) => formatYearMonth(ym, language)} formatter={(v) => `${fmt(v)}€`} />
                <Line
                  type="monotone"
                  dataKey="cost"
                  stroke="#3b82f6"
                  strokeWidth={3}
                  dot={{ fill: '#3b82f6', r: 6, strokeWidth: 2, stroke: '#fff' }}
                  activeDot={{ r: 8 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="h-72 flex items-center justify-center text-gray-400">
            <p>{t('noDataAvailable')}</p>
          </div>
        )}
      </div>

      {/* Cost trend by category */}
      <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
        <h3 className="font-semibold text-gray-900 mb-4">{t('trendByCategory')}</h3>
        {trendByCategory.data.length > 0 && trendByCategory.categories.length > 0 ? (
          <>
            {/* Clickable legend: toggle categories to hide/show (Y axis rescales) */}
            <div className="flex flex-wrap gap-2 mb-4">
              {trendByCategory.categories.map((c) => {
                const hidden = hiddenCategories.has(c.key);
                return (
                  <button
                    key={c.key}
                    onClick={() => toggleCategory(c.key)}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors cursor-pointer ${
                      hidden ? 'bg-gray-50 text-gray-400 border-gray-200' : 'bg-white text-gray-700 border-gray-300'
                    }`}
                  >
                    <span
                      className="inline-block w-3 h-3 rounded-full"
                      style={{ backgroundColor: hidden ? '#d1d5db' : c.color }}
                    />
                    {c.label}
                  </button>
                );
              })}
            </div>
            <div className="h-96">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trendByCategory.data}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="yearMonth" tickFormatter={(ym) => formatYearMonth(ym, language)} />
                  <YAxis tickFormatter={(v) => `${v}€`} />
                  <Tooltip
                    labelFormatter={(ym) => formatYearMonth(ym, language)}
                    formatter={(v, name) => [`${fmt(v)}€`, name]}
                  />
                  {trendByCategory.categories
                    .filter((c) => !hiddenCategories.has(c.key))
                    .map((c) => (
                      <Line
                        key={c.key}
                        type="monotone"
                        dataKey={c.key}
                        name={c.label}
                        stroke={c.color}
                        strokeWidth={2}
                        dot={false}
                        activeDot={{ r: 5 }}
                      />
                    ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </>
        ) : (
          <div className="h-72 flex items-center justify-center text-gray-400">
            <p>{t('noDataAvailable')}</p>
          </div>
        )}
      </div>

      {/* GPU Cost Trend */}
      {gpuTrend?.monthlyTrend && gpuTrend.monthlyTrend.length > 1 && (
        <div className="bg-white rounded-xl p-5 shadow-sm border-2 border-purple-300">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-gray-900">
              {language === 'en' ? 'GPU cost evolution' : 'Évolution des coûts GPU'}
            </h3>
            <span className="text-lg font-bold text-purple-700">
              {language === 'en' ? 'Total' : 'Total'}: {fmt(gpuTrend.total)}€
            </span>
          </div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={gpuTrend.monthlyTrend}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" tick={{ fontSize: 10 }} />
                <YAxis tickFormatter={(v) => `${v}€`} />
                <Tooltip formatter={(v) => `${fmt(v)}€`} />
                <Bar dataKey="total" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className={`bg-white rounded-xl p-5 shadow-sm border border-gray-100 ${monthlyTrend.length === 0 ? 'opacity-50' : ''}`}>
          <span className="text-gray-500 text-sm">{t('periodGrowth')}</span>
          <div
            className={`text-3xl font-bold mt-2 ${growth === null
              ? 'text-gray-400'
              : (growth > 0 ? 'text-red-600' : 'text-green-600')}`}
            title={growthNotComputable ? t('periodGrowthNotComputable') : undefined}
          >
            {!spansTwoMonths && 'N/A'}
            {growthNotComputable && '—'}
            {growth !== null && `${growth > 0 ? '+' : ''}${growth.toFixed(1)}%`}
          </div>
          <p className="text-sm text-gray-500 mt-1">{t('overPeriod')} {t(currentPeriodLabel)}</p>
        </div>
        <div className={`bg-white rounded-xl p-5 shadow-sm border border-gray-100 ${monthlyTrend.length === 0 ? 'opacity-50' : ''}`}>
          <span className="text-gray-500 text-sm">{t('mostExpensiveMonth')}</span>
          <div className={`text-3xl font-bold mt-2 ${monthlyTrend.length > 0 ? 'text-red-600' : 'text-gray-400'}`}>
            {monthlyTrend.length > 0
              ? formatYearMonth(monthlyTrend.reduce((max, m) => m.cost > max.cost ? m : max, monthlyTrend[0]).yearMonth, language)
              : 'N/A'}
          </div>
          <p className="text-sm text-gray-500 mt-1">
            {monthlyTrend.length > 0
              ? `${fmt(Math.max(...monthlyTrend.map(m => m.cost)))}€`
              : ''}
          </p>
        </div>
        <div className={`bg-white rounded-xl p-5 shadow-sm border border-gray-100 ${monthlyTrend.length === 0 ? 'opacity-50' : ''}`}>
          <span className="text-gray-500 text-sm">{t('annualProjection')}</span>
          <div className={`text-3xl font-bold mt-2 ${monthlyTrend.length > 0 ? 'text-blue-600' : 'text-gray-400'}`}>
            {monthlyTrend.length > 0
              ? `~${fmt((monthlyTrend[monthlyTrend.length - 1]?.cost || 0) * 12)}€`
              : 'N/A'}
          </div>
          <p className="text-sm text-gray-500 mt-1">{t('basedOnLastMonth')}</p>
        </div>
      </div>
    </div>
  );
};

// The period selector of the Trends tab, which the shell renders in its tab bar while the
// tab is active, so that the tab bar keeps its markup: see
// docs/adr/0001-tab-state-lives-in-the-dashboard-shell.md
const TrendsPeriodSelector = ({ trendPeriod, setTrendPeriod, availablePeriods, t }) => (
  <div className="flex items-center gap-2">
    <span className="text-sm text-gray-600">{t('period')}:</span>
    <select
      value={trendPeriod}
      onChange={(e) => setTrendPeriod(Number(e.target.value))}
      className="px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm shadow-sm cursor-pointer"
    >
      {availablePeriods.map(opt => (
        <option key={opt.months} value={opt.months}>{t(opt.key)}</option>
      ))}
    </select>
  </div>
);

export { TrendsTab, TrendsPeriodSelector };
