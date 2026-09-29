import { useState } from 'react';
import { BY_MONTH_A, BY_MONTH_B } from '../utils/monthComparison.js';
import { sortRows } from './SortableHeader.jsx';

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
      <td className="relative py-3 pr-3 pl-9 font-medium">
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

export { UnfoldingRow, sortUnfolded, useUnfoldedRows };
