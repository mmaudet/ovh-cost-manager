import { useState } from 'react';
import { BY_MONTH_A, BY_MONTH_B } from '../utils/monthComparison.js';
import { sortRows } from './SortableHeader.jsx';
import { Variation } from './Variation.jsx';

// The padding of the first cell of a comparison's rows, which leaves room before their label for
// the chevron of those that unfold, so that every row's label lines up, whether it unfolds or
// not: that of a row that never unfolds, such as the credit that a project's bills used, too
const LABEL_PADDING = 'py-3 pr-3 pl-9';

// The padding of the first cell of the rows that show under an unfolded row, indented under its
// label, those that say that they load or could not load included
const DETAIL_PADDING = 'py-2 pr-3 pl-12';

// The chevron of a row that unfolds: pointing at the row's label while it is folded, and down
// once it is unfolded. Screen readers skip it: its button says it (aria-expanded).
const Chevron = ({ unfolded }) => (
  <svg
    viewBox="0 0 20 20" aria-hidden="true"
    className={`w-5 h-5 transition-transform ${unfolded ? 'rotate-90' : ''}`}
  >
    <path
      fill="currentColor"
      d="M7.3 4.3a1 1 0 0 1 1.4 0l5 5a1 1 0 0 1 0 1.4l-5 5a1 1 0 1 1-1.4-1.4L11.6 10 7.3 5.7a1 1 0 0 1 0-1.4z"
    />
  </svg>
);

/**
 * A row of a comparison of the Compare tab that unfolds into what it adds up (#189): a chevron
 * before its label, a button that says which row it unfolds and whether it is unfolded, folds
 * and unfolds it, and its detail shows right under it once unfolded. A row with nothing to
 * unfold has no chevron, its label in line with the others.
 * @param {object} props
 * @param {?{ unfolded: boolean, onToggle: function() }} props.unfolding - Whether the row is
 *   unfolded, and what folds or unfolds it (useUnfoldedRows()); null for a row that does not
 *   unfold
 * @param {string} props.chevronLabel - What the chevron's button is named: the row it unfolds
 * @param {React.ReactNode} props.label - What the first cell shows after the chevron
 * @param {React.ReactNode} props.detail - The rows that show under it once unfolded
 * @param {React.ReactNode} props.children - The row's other cells
 * @returns {JSX.Element}
 */
const UnfoldingRow = ({ unfolding, chevronLabel, label, detail, children }) => (
  <>
    <tr className="border-b hover:bg-gray-50 transition-colors">
      <td className={`relative ${LABEL_PADDING} font-medium`}>
        {unfolding && (
          <button
            type="button"
            className="absolute left-2 top-3 rounded text-gray-400 hover:text-gray-700"
            aria-label={chevronLabel}
            aria-expanded={unfolding.unfolded}
            onClick={unfolding.onToggle}
          >
            <Chevron unfolded={unfolding.unfolded} />
          </button>
        )}
        {label}
      </td>
      {children}
    </tr>
    {unfolding?.unfolded && detail}
  </>
);

/**
 * A row that shows under an unfolded row of a comparison (#189), what the row adds up: a service
 * or a charge, indented under the row's label, in the comparison's columns, its amount in months
 * A and B, 0 € in a month that did not bill it, and the variation from one to the other. The
 * caller gives it its key.
 * @param {object} props
 * @param {number} props.valA - Its amount in month A
 * @param {number} props.valB - Its amount in month B
 * @param {boolean} [props.monthInProgress] - Whether month A or B is the month in progress,
 *   which leaves no variation to compute (#216)
 * @param {React.ReactNode} props.children - What names it, in its first cell, which asks the
 *   table for no width of its own (max-w-0): what names it wraps or is cut to the column of the
 *   rows' labels, whatever the page's width, rather than widen the table
 * @returns {JSX.Element}
 */
const DetailRow = ({
  valA, valB, monthInProgress = false, fmt, language, t, children,
}) => (
  <tr className="border-b text-gray-600">
    <td className={`max-w-0 ${DETAIL_PADDING}`}>{children}</td>
    <td className="py-2 px-3 text-right">{fmt(valA)}€</td>
    <td className="py-2 px-3 text-right">{fmt(valB)}€</td>
    <td className="py-2 px-3 text-right">
      <Variation
        from={valA} to={valB} language={language} t={t} monthInProgress={monthInProgress}
      />
    </td>
  </tr>
);

/**
 * What unfolded rows of a comparison show under them, their services or charges (#189), in the
 * order of the comparison's sort, by the values of its columns, within each row; and, of the
 * same value in its column, in their own order: by month A, the most expensive first, then by
 * month B, which they keep until the user sorts the comparison. Sorted by month B, then by month
 * A, those of the same cost in month A keep their order of month B.
 * @param {object[]} rows - What a row unfolds into
 * @param {?object} sort - The comparison's sort, by its columns (see SortableHeader.jsx): null
 *   until the user sorts it, as for a comparison that does not sort
 * @param {Object<string, function(object): *>} values - The value of each in the comparison's
 *   columns, by the column's name, as sortRows() takes them, those of months A and B (totalA,
 *   totalB) included
 * @param {string} language - The page's, whose alphabet sorts the text
 * @returns {object[]}
 */
const sortUnfolded = (rows, sort, values, language) => sortRows(
  sortRows(sortRows(rows, BY_MONTH_B, values, language), BY_MONTH_A, values, language),
  sort, values, language,
);

/**
 * The rows that the user unfolded in the comparisons of a tab (#189), which the hook of the tab
 * holds, so that they stay unfolded while another tab is open (ADR 0001), whatever the order of
 * the rows or the months compared.
 * @returns {function(string, string): { unfolded: boolean, onToggle: function() }}
 *   unfoldingOf(comparison, row): whether a row of a comparison is unfolded, by their names,
 *   and what folds or unfolds it; every row is folded until the user unfolds it
 */
const useUnfoldedRows = () => {
  const [unfolded, setUnfolded] = useState({});
  return (comparison, row) => {
    const key = JSON.stringify([comparison, row]);
    return {
      unfolded: unfolded[key] === true,
      onToggle: () => setUnfolded((current) => ({ ...current, [key]: !current[key] })),
    };
  };
};

export {
  DETAIL_PADDING, DetailRow, LABEL_PADDING, UnfoldingRow, sortUnfolded, useUnfoldedRows,
};
