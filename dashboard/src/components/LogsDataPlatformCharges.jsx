import { formatMonthLabel } from '../utils/format.js';
import { SortableHeader, sortRows } from './SortableHeader.jsx';

// The value of a charge in each column that sorts the table (#146)
const CHARGE_VALUES = {
  charge: (row) => row.charge,
  total: (row) => row.total,
};

/**
 * The charges of the Logs Data Platform services that the bills of the month shown charged
 * (#247), one row per charge, the services together, and the accounts too when all are shown:
 * each as the bills name it, without its period, in their wording whatever the page's language,
 * with its cost, in the order the user sorts them, and the month's Logs Data Platform cost in the
 * table's foot. A charge that a refund brings below 0 € shows, as the server keeps it, so that the
 * charges add up to that cost. What the month billed, never projected, as the rest of the
 * Infrastructure tab.
 * @param {object} props
 * @param {{ total: number, charges: { charge: string, total: number }[] }} props.logsDataPlatform
 *   - The charges of the month, as /api/analysis/logs-data-platform gives them, the most expensive
 *   first, which the tab's hook loads (useInfrastructureTab())
 * @param {{ sort: ?object, onSort: function(object) }} props.sorting - The sort of the table,
 *   as useTableSorts() gives it: by cost, the most expensive first, until the user sorts it
 * @param {?object} props.selectedMonth - The month of the header, which the heading names
 * @param {string} props.language
 * @param {function(string): string} props.t
 * @param {function(number): string} props.fmt - The amount format of the page
 * @returns {JSX.Element}
 */
const LogsDataPlatformCharges = ({
  logsDataPlatform, sorting, selectedMonth, language, t, fmt,
}) => (
  <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
    <h3 className="font-semibold text-gray-900 mb-4">
      {t('logsDataPlatformByCharge')}
      {selectedMonth && (
        <span className="text-sm font-normal text-gray-400 ml-2">
          ({formatMonthLabel(selectedMonth.value, language)})
        </span>
      )}
    </h3>
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-gray-50">
            <SortableHeader
              column="charge" kind="text" sorting={sorting} t={t}
              className="p-3 text-left font-medium"
            >
              {t('charge')}
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
          {sortRows(logsDataPlatform.charges, sorting.sort, CHARGE_VALUES, language).map((row) => (
            <tr key={row.charge} className="border-b hover:bg-gray-50">
              {/* A long charge wraps, rather than widen the table past a phone's screen */}
              <td className="p-3 break-words">{row.charge}</td>
              <td className="p-3 text-right font-medium whitespace-nowrap">{fmt(row.total)}€</td>
            </tr>
          ))}
        </tbody>
        {/* The month's Logs Data Platform cost, which the charges add up to */}
        <tfoot>
          <tr className="bg-gray-50 font-semibold">
            <td className="p-3">{t('logsDataPlatformTotal')}</td>
            <td className="p-3 text-right whitespace-nowrap">{fmt(logsDataPlatform.total)}€</td>
          </tr>
        </tfoot>
      </table>
    </div>
  </div>
);

export { LogsDataPlatformCharges };
