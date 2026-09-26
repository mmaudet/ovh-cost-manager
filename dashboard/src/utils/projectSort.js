// Sort projects helper
const sortProjects = (projects, sortConfig) => {
  if (!projects) return [];
  return [...projects].sort((a, b) => {
    let aVal, bVal;
    if (sortConfig.column === 'name') {
      aVal = a.projectName?.toLowerCase() || '';
      bVal = b.projectName?.toLowerCase() || '';
    } else {
      aVal = a.total || 0;
      bVal = b.total || 0;
    }
    if (aVal < bVal) return sortConfig.direction === 'asc' ? -1 : 1;
    if (aVal > bVal) return sortConfig.direction === 'asc' ? 1 : -1;
    return 0;
  });
};

export { sortProjects };
