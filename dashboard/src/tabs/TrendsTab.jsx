import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line, Dot,
} from 'recharts';
import { AiEndpointsTrend } from '../components/AiEndpointsTrend.jsx';
import { ProjectionCheckbox } from '../components/ProjectionCheckbox.jsx';
import { formatYearMonth } from '../utils/format.js';
import { comparedMonthsOf } from '../utils/monthComparison.js';
import { isMonthInProgress } from '../utils/months.js';
import { lineParts, trendAmount, trendMonthLabel } from '../utils/trendLines.js';
import { PERIOD_OPTIONS } from '../utils/trendPeriods.js';
import { comparedVariation, comparesPartialMonth } from '../utils/variation.js';

// The colours of each tone of the growth over the period: red when it grows, green when it
// shrinks, grey when it rounds to 0 (#87)
const GROWTH_TONES = {
  increase: 'text-red-600',
  decrease: 'text-green-600',
  neutral: 'text-gray-600',
};

/**
 * The lines that draw a series of the tab's line charts (#217): solid through the complete
 * months, and dashed from the month before the month in progress to it, whose point is hollow,
 * whether the trends project it or not (lineParts()). Both bear the series' name, under which
 * the tooltip gives its amount once (payloadUniqBy), as trendAmount() writes it.
 * @param {object} series
 * @param {string} series.key - Its key in the chart's rows
 * @param {string} series.name - What the tooltip names it
 * @param {string} series.color
 * @param {number} series.width - The width of its lines
 * @param {object|boolean} series.dot - The points of its complete months, as a Line takes them
 * @param {number} series.dotRadius - The radius of its hollow point in the month in progress
 * @param {number} series.activeRadius - The radius of its point under the pointer
 * @param {function(object): number} series.projectedPartOf - The part of its amount in a row
 *   that projected lines make, 0 for none
 * @param {object} chart
 * @param {object} chart.parts - The parts of the chart's series (lineParts())
 * @param {?string} chart.monthInProgress - The month in progress, YYYY-MM, when it covers it
 * @param {boolean} chart.projected - Whether the trends project it
 * @param {function(number): string} chart.fmt
 * @param {function(string): string} chart.t
 * @returns {JSX.Element[]}
 */
const seriesLines = (
  { key, name, color, width, dot, dotRadius, activeRadius, projectedPartOf },
  { parts, monthInProgress, projected, fmt, t },
) => {
  // Its amount in a month, as the tooltip gives it
  const formatter = (value, seriesName, { payload }) => [
    trendAmount(value, projectedPartOf(payload), {
      inProgress: payload.yearMonth === monthInProgress, projected,
    }, fmt, t),
    seriesName,
  ];
  // Its point in the month in progress, hollow, and none in the other months
  const hollowPoint = (radius) => ({ key: pointKey, cx, cy, payload }) => (
    payload.yearMonth === monthInProgress
      ? <Dot key={pointKey} cx={cx} cy={cy} r={radius} fill="#fff" stroke={color} strokeWidth={2} />
      : null
  );
  return [
    <Line
      key={`${key}-complete`} type="monotone" dataKey={parts.solid(key)} name={name}
      stroke={color} strokeWidth={width} dot={dot} activeDot={{ r: activeRadius }}
      formatter={formatter}
    />,
    <Line
      key={`${key}-in-progress`} type="monotone" dataKey={parts.dashed(key)} name={name}
      stroke={color} strokeWidth={width} strokeDasharray="6 4" dot={hollowPoint(dotRadius)}
      activeDot={hollowPoint(activeRadius)} formatter={formatter}
    />,
  ];
};

// The Trends tab, which the shell renders while it is active: what useTrendsTab() returns,
// with the shell's months list, language, translations (t) and amount format (fmt).
const TrendsTab = ({
  trendPeriod, monthlyTrend, trendByCategory, hiddenCategories, toggleCategory, gpuTrend,
  aiEndpointsTrend, monthInProgress, projected, months, language, t, fmt,
}) => {
  const currentPeriodLabel = (PERIOD_OPTIONS.find(o => o.months === trendPeriod) || {}).key;
  // What each line chart draws of the month in progress that the period covers (#217): the
  // parts of its series, and whether the trends project it
  const chartOf = (rows) => ({
    parts: lineParts(rows, monthInProgress), monthInProgress, projected, fmt, t,
  });
  const totalChart = chartOf(monthlyTrend);
  const categoryChart = chartOf(trendByCategory.data);
  // The months as the tooltips name them
  const monthLabel = (yearMonth) => trendMonthLabel(yearMonth, monthInProgress, language, t);
  // The first and the last months of the period, as the trend gives them
  const firstMonth = monthlyTrend[0];
  const lastMonth = monthlyTrend[monthlyTrend.length - 1];
  // The growth over the period, in percent, from its first month to its last, as the page
  // shows it: its text and its tone (#87), or why it shows none. Three states show none:
  // - N/A, without two months to compare: with no months at all, as when nothing was billed
  //   over the period, since the trend routes give every month of a period with a bill (#65);
  // - "—", with a tooltip, when the first month, at 0 € or less, leaves none to compute (#65);
  // - "—", with a tooltip, when the last month is the month in progress at what it billed so
  //   far (#216). At its projected cost, while the trends project it, it has one (#217).
  const spansTwoMonths = monthlyTrend.length > 1;
  const growth = spansTwoMonths
    ? comparedVariation(
      comparedMonthsOf(
        months, { value: firstMonth.yearMonth }, { value: lastMonth.yearMonth }, { projected },
      ),
      firstMonth.cost, lastMonth.cost, language, { notComputable: 'periodGrowthNotComputable' },
    )
    : null;
  // The annual projection, 12 times the cost of the last month: none, "—" with a tooltip, while
  // that month is the month in progress at what it billed so far (#216, #217)
  const lastMonthPartial = lastMonth !== undefined && comparesPartialMonth({
    includesMonthInProgress: isMonthInProgress(months, { value: lastMonth.yearMonth }), projected,
  });

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
                <Tooltip labelFormatter={monthLabel} payloadUniqBy={(entry) => entry.name} />
                {seriesLines({
                  key: 'cost', name: t('cost'), color: '#3b82f6', width: 3,
                  dot: { fill: '#3b82f6', r: 6, strokeWidth: 2, stroke: '#fff' },
                  dotRadius: 6, activeRadius: 8, projectedPartOf: (row) => row.projected ?? 0,
                }, totalChart)}
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
                  <Tooltip labelFormatter={monthLabel} payloadUniqBy={(entry) => entry.name} />
                  {trendByCategory.categories
                    .filter((c) => !hiddenCategories.has(c.key))
                    .flatMap((c) => seriesLines({
                      key: c.key, name: c.label, color: c.color, width: 2, dot: false,
                      dotRadius: 4, activeRadius: 5,
                      projectedPartOf: (row) => row.projected?.[c.key] ?? 0,
                    }, categoryChart))}
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

      {/* The cost of each AI Endpoints model month by month (#196), once two months of the
          period have some, as the GPU trend: a single bar is no trend */}
      {aiEndpointsTrend?.monthlyTrend.length > 1 && (
        <AiEndpointsTrend
          aiEndpointsTrend={aiEndpointsTrend} language={language} t={t} fmt={fmt}
        />
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className={`bg-white rounded-xl p-5 shadow-sm border border-gray-100 ${monthlyTrend.length === 0 ? 'opacity-50' : ''}`}>
          <span className="text-gray-500 text-sm">{t('periodGrowth')}</span>
          <div
            className={`text-3xl font-bold mt-2 ${growth === null || growth.why
              ? 'text-gray-400'
              : GROWTH_TONES[growth.tone]}`}
            title={growth?.why ? t(growth.why) : undefined}
          >
            {!spansTwoMonths && 'N/A'}
            {growth?.why && '—'}
            {growth?.text}
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
          <div
            className={`text-3xl font-bold mt-2 ${monthlyTrend.length > 0 && !lastMonthPartial
              ? 'text-blue-600'
              : 'text-gray-400'}`}
            title={lastMonthPartial ? t('annualProjectionMonthInProgress') : undefined}
          >
            {monthlyTrend.length === 0 && 'N/A'}
            {lastMonthPartial && '—'}
            {monthlyTrend.length > 0 && !lastMonthPartial
              && `~${fmt((lastMonth.cost || 0) * 12)}€`}
          </div>
          <p className="text-sm text-gray-500 mt-1">{t('basedOnLastMonth')}</p>
        </div>
      </div>
    </div>
  );
};

// The period selector of the Trends tab, which the shell renders in its tab bar while the
// tab is active, so that the tab bar keeps its markup: see
// docs/adr/0001-tab-state-lives-in-the-dashboard-shell.md. The checkbox that projects the month
// in progress follows it (#217): the shell holds that setting, and passes it with its setter.
const TrendsPeriodSelector = ({
  trendPeriod, setTrendPeriod, availablePeriods, projectsMonthInProgress,
  setProjectsMonthInProgress, t,
}) => (
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
    <ProjectionCheckbox
      projectsMonthInProgress={projectsMonthInProgress}
      setProjectsMonthInProgress={setProjectsMonthInProgress} t={t}
    />
  </div>
);

export { TrendsTab, TrendsPeriodSelector };
