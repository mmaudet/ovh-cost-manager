import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { formatYearMonth } from '../utils/format.js';

// The colors of the models: twenty of Tailwind's, as far apart as its steps allow
const MODEL_COLORS = [
  '#3b82f6', '#eab308', '#be123c', '#4d7c0f', '#d946ef', '#22d3ee', '#fb7185', '#7e22ce',
  '#22c55e', '#0e7490', '#854d0e', '#1d4ed8', '#d97706', '#a78bfa', '#8b5cf6', '#14b8a6',
  '#86198f', '#0d9488', '#60a5fa', '#db2777',
];

// The color of a model, from its name, so that it keeps it whatever its rank, and so whatever
// the period, the month or the account shown. Two models may still share a color: more models
// exist than the palette has colors.
const colorOf = (model) => {
  let hash = 0;
  for (const character of model) {
    hash = (hash * 31 + character.codePointAt(0)) % MODEL_COLORS.length;
  }
  return MODEL_COLORS[hash];
};

/**
 * The cost of each AI Endpoints model month by month over the Trends tab's period (#196):
 * stacked bars, one per month of the bills that name a model, one color per model, with a
 * legend of the models, the most expensive over the period first, and a tooltip that gives
 * each model's cost in its month.
 * @param {object} props
 * @param {{ models: object[], monthlyTrend: object[] }} props.aiEndpointsTrend - The models of
 *   the period and their cost month by month, as /api/analysis/ai-endpoints gives them
 * @param {string} props.language
 * @param {function(string): string} props.t
 * @param {function(number): string} props.fmt - The amount format of the page
 * @returns {JSX.Element}
 */
const AiEndpointsTrend = ({ aiEndpointsTrend, language, t, fmt }) => (
  <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
    <h3 className="font-semibold text-gray-900 mb-4">{t('aiEndpointsTrend')}</h3>
    <ul className="flex flex-wrap gap-2 mb-4">
      {aiEndpointsTrend.models.map(({ model }) => (
        <li
          key={model}
          className={'flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium'
            + ' border border-gray-300 text-gray-700'}
        >
          <span
            className="inline-block w-3 h-3 rounded-full"
            style={{ backgroundColor: colorOf(model) }}
          />
          {model}
        </li>
      ))}
    </ul>
    <div className="h-72">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={aiEndpointsTrend.monthlyTrend}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="month" tickFormatter={(month) => formatYearMonth(month, language)} />
          <YAxis tickFormatter={(value) => `${value}€`} />
          <Tooltip
            labelFormatter={(month) => formatYearMonth(month, language)}
            formatter={(value, model) => [`${fmt(value)}€`, model]}
          />
          {/* By a function: a text dataKey would read the dot of a model's name as a path */}
          {aiEndpointsTrend.models.map(({ model }) => (
            <Bar
              key={model}
              name={model}
              dataKey={(row) => row.costs[model]}
              stackId="models"
              fill={colorOf(model)}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  </div>
);

export { AiEndpointsTrend };
