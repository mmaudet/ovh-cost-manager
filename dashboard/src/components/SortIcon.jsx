// The sort mark of a column: ▲ or ▼ when the table is sorted by it, from its smallest or its
// largest value, ○ otherwise, as when the table is not sorted (current is null). Screen
// readers skip it: the header of the column says it (aria-sort, see SortableHeader.jsx).
const SortIcon = ({ column, current }) => (
  <span className="sort-mark ml-1 text-gray-400" aria-hidden="true">
    {current?.column === column ? (current.direction === 'desc' ? '▼' : '▲') : '○'}
  </span>
);

export { SortIcon };
