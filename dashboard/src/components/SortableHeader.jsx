import { useState } from 'react';
import { localeOf } from '../utils/format.js';
import { SortIcon } from './SortIcon.jsx';

// How every table of the page sorts its rows (#146): by the column whose header the user
// clicks, one way then the other. A first click sorts a column of text from A to Z, and a
// column of numbers, amounts, sizes or dates from the largest or the latest; a second click
// reverses it. The rows compare by their raw value, never by what the page writes: 900 Mo
// before 4,2 Go, logs-9 before logs-10, in the alphabet of the page's language. A row without a
// value in the column, which the page writes "-" or "—", comes last either way, and rows of the
// same value keep the order that the table gives them: its own order, which the rows keep until
// the user sorts them.
//
// The sort of a table is null until the user sorts it, unless the table sorts by one of its
// columns from the start, or else { column, kind, direction }: the name of the column, its kind,
// 'text', 'number' or 'date', and the direction, 'asc' or 'desc'. The hook of the table's tab
// holds it, or the shell for its own table, with useTableSorts(), so that the table keeps it
// while another tab is open, and the "show all" modal of a table sorts it as its panel does:
// see docs/adr/0001-tab-state-lives-in-the-dashboard-shell.md.

// The value a row sorts by in a column of a kind, from its raw value: null when it has none
const sortKey = (kind, value) => {
  if (value === null || value === undefined || value === '') return null;
  if (kind === 'text') return String(value);
  const key = kind === 'date' ? new Date(value).getTime() : Number(value);
  return Number.isNaN(key) ? null : key;
};

/**
 * The rows of a table in the order of its sort.
 * @param {object[]} rows - The rows in the table's own order: the order without a sort, and
 *   that of the rows of the same value
 * @param {?{ column: string, kind: string, direction: string }} sort - The table's sort, null
 *   until the user sorts it
 * @param {Object<string, function(object): *>} values - For each column that sorts the table,
 *   by name, the raw value of a row in it: a number, a date or its ISO text, or a text. A
 *   column that the table does not show, as the Account column with a single account shown,
 *   gives none: the rows keep their order.
 * @param {string} language - The page's, 'fr' or 'en', whose alphabet sorts the text
 * @returns {object[]} A new list; or the rows themselves without a sort, or when the values
 *   name no column of the sort's name
 */
const sortRows = (rows, sort, values, language) => {
  const valueOf = sort && values[sort.column];
  if (!valueOf) return rows;
  const compare = sort.kind === 'text'
    ? new Intl.Collator(localeOf(language), { numeric: true }).compare
    : (a, b) => a - b;
  const sign = sort.direction === 'asc' ? 1 : -1;
  return rows
    .map((row) => ({ row, key: sortKey(sort.kind, valueOf(row)) }))
    .sort((a, b) => {
      if (a.key === null) return b.key === null ? 0 : 1;
      if (b.key === null) return -1;
      return sign * compare(a.key, b.key);
    })
    .map(({ row }) => row);
};

// The sort that a click on the header of a column gives: the other way round when the table
// is sorted by that column, or else from A to Z for text, the largest or the latest first for
// the other kinds
const nextSort = (sort, column, kind) => {
  if (sort?.column === column) {
    return { column, kind, direction: sort.direction === 'asc' ? 'desc' : 'asc' };
  }
  return { column, kind, direction: kind === 'text' ? 'asc' : 'desc' };
};

// The value of aria-sort of the column that sorts the table
const ARIA_SORT = { asc: 'ascending', desc: 'descending' };

/**
 * The header of a column that sorts its table: its label and its sort mark, in a button that
 * sorts the table by the column, with the mouse or the keyboard, which the whole cell takes the
 * click for. It says what a click does, and, to screen readers, which way the table is sorted.
 * @param {object} props
 * @param {string} props.column - The name of the column, as the values of sortRows() name it
 * @param {'text'|'number'|'date'} props.kind - What the column shows, which says which way a
 *   first click sorts it
 * @param {{ sort: ?object, onSort: function(object) }} props.sorting - The sort of the table,
 *   and what takes the next one, as useTableSorts() gives them
 * @param {function(string): string} props.t
 * @param {string} [props.className] - The classes of the cell
 * @param {React.ReactNode} props.children - The label of the column
 * @returns {JSX.Element}
 */
const SortableHeader = ({
  column, kind, sorting: { sort, onSort }, t, className = '', children,
}) => {
  const next = nextSort(sort, column, kind);
  return (
    <th
      className={`${className} relative hover:bg-gray-100`}
      aria-sort={sort?.column === column ? ARIA_SORT[sort.direction] : undefined}
    >
      <button
        type="button"
        className="sort-header select-none [text-align:inherit] after:absolute after:inset-0"
        title={t(next.direction === 'asc' ? 'sortAscending' : 'sortDescending')}
        onClick={() => onSort(next)}
      >
        {children}<SortIcon column={column} current={sort} />
      </button>
    </th>
  );
};

// The sort of a table that sorts by its `total` column from the start, the most expensive first,
// until the user sorts it by another column, which useTableSorts() takes as its default: the
// Overview's breakdown by project, the AI Endpoints models (#193) and the Logs Data Platform
// charges (#247)
const BY_TOTAL = { column: 'total', kind: 'number', direction: 'desc' };

/**
 * The sorts of the tables of a tab, which the hook of the tab holds (see above).
 * @param {Object<string, object>} [defaults] - By table, the sort of the tables that sort by
 *   one of their columns from the start; the others keep their own order until the user sorts
 *   them
 * @returns {function(string): { sort: ?object, onSort: function(object) }} sortingOf(table):
 *   the sort of a table, by its name, and what its headers give the next one to
 */
const useTableSorts = (defaults = {}) => {
  const [sorts, setSorts] = useState(defaults);
  return (table) => ({
    sort: sorts[table] ?? null,
    onSort: (sort) => setSorts((current) => ({ ...current, [table]: sort })),
  });
};

export { BY_TOTAL, SortableHeader, sortRows, useTableSorts };
