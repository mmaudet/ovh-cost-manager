import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { formatYearMonth } from '../utils/format.js';

// The colours of the models, in their order, the most expensive first: one each, the palette's
// again from the eleventh
const MODEL_COLOURS = [
  '#3b82f6', '#ef4444', '#f59e0b', '#10b981', '#8b5cf6',
  '#ec4899', '#06b6d4', '#84cc16', '#f97316', '#6b7280',
];

// The colour of the model at an index of the models
const colourOf = (index) => MODEL_COLOURS[index % MODEL_COLOURS.length];

/**
 * The cost of each AI Endpoints model month by month over the Trends tab's period (#196):
 * stacked bars, one per month of the bills that name a model, one colour per model, with a
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
      {aiEndpointsTrend.models.map(({ model }, index) => (
        <li
          key={model}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border border-gray-300 text-gray-700"
        >
          <span
            className="inline-block w-3 h-3 rounded-full"
            style={{ backgroundColor: colourOf(index) }}
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
          {aiEndpointsTrend.models.map(({ model }, index) => (
            <Bar
              key={model}
              name={model}
              dataKey={(row) => row.costs[model]}
              stackId="models"
              fill={colourOf(index)}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  </div>
);

export { AiEndpointsTrend };
