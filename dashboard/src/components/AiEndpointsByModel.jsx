import { SortableHeader, sortRows } from './SortableHeader.jsx';
import { formatTokens } from '../utils/format.js';

// The value of a model in each column that sorts the table (#146): none for the tokens that
// none of its lines counts, which the table shows as "—"
const MODEL_VALUES = {
  model: (row) => row.model,
  inputTokens: (row) => row.inputTokens,
  outputTokens: (row) => row.outputTokens,
  total: (row) => row.total,
};

/**
 * The AI Endpoints models that the bills of the month shown name (#193), one row per model, the
 * projects together: its input tokens and its output tokens, in millions, and its cost, in the
 * order the user sorts them, and the month's AI Endpoints cost in the table's foot.
 * @param {object} props
 * @param {{ total: number, models: object[] }} props.aiEndpoints - The models of the month, as
 *   /api/analysis/ai-endpoints gives them, the most expensive first
 * @param {{ sort: ?object, onSort: function(object) }} props.sorting - The sort of the table,
 *   as useTableSorts() gives it
 * @param {string} props.language
 * @param {function(string): string} props.t
 * @param {function(number): string} props.fmt - The amount format of the page
 * @returns {JSX.Element}
 */
const AiEndpointsByModel = ({ aiEndpoints, sorting, language, t, fmt }) => (
  <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
    <h3 className="font-semibold text-gray-900 mb-4">{t('aiEndpointsByModel')}</h3>
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-gray-50">
            <SortableHeader
              column="model" kind="text" sorting={sorting} t={t}
              className="p-3 text-left font-medium"
            >
              {t('model')}
            </SortableHeader>
            <SortableHeader
              column="inputTokens" kind="number" sorting={sorting} t={t}
              className="p-3 text-right font-medium"
            >
              {t('inputTokens')}
            </SortableHeader>
            <SortableHeader
              column="outputTokens" kind="number" sorting={sorting} t={t}
              className="p-3 text-right font-medium"
            >
              {t('outputTokens')}
            </SortableHeader>
            <SortableHeader
              column="total" kind="number" sorting={sorting} t={t}
              className="p-3 text-right font-medium"
            >
              {t('cost')}
            </SortableHeader>
          </tr>
        </thead>
        <tbody>
          {sortRows(aiEndpoints.models, sorting.sort, MODEL_VALUES, language).map((row) => (
            <tr key={row.model} className="border-b hover:bg-gray-50">
              <td className="p-3 font-medium">{row.model}</td>
              <td className="p-3 text-right whitespace-nowrap">
                {formatTokens(row.inputTokens, language)}
              </td>
              <td className="p-3 text-right whitespace-nowrap">
                {formatTokens(row.outputTokens, language)}
              </td>
              <td className="p-3 text-right font-medium">{fmt(row.total)}€</td>
            </tr>
          ))}
        </tbody>
        {/* The month's AI Endpoints cost, which the models' costs add up to */}
        <tfoot>
          <tr className="bg-gray-50 font-semibold">
            <td className="p-3" colSpan={3}>{t('aiEndpointsTotal')}</td>
            <td className="p-3 text-right">{fmt(aiEndpoints.total)}€</td>
          </tr>
        </tfoot>
      </table>
    </div>
  </div>
);

export { AiEndpointsByModel };
