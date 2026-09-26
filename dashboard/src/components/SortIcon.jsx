const SortIcon = ({ column, current }) => (
  <span className="ml-1 text-gray-400">
    {current.column === column ? (current.direction === 'desc' ? '▼' : '▲') : '○'}
  </span>
);

export { SortIcon };
