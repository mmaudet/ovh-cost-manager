/**
 * Client-side CSV export.
 *
 * Mirrors the conventions of the server exports (`toCSV` in server/index.js):
 * ';' separator and comma decimals, so files open straight in a French Excel.
 * Use this whenever the rows are already in the browser rather than adding a
 * server route for them.
 */

// Spreadsheet software evaluates a cell starting with one of these characters
// as a formula (CSV injection), so such text values get a leading quote.
const FORMULA_PREFIX = /^[=+\-@\t\r]/;

const cell = (value) => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return value.toString().replace('.', ',');
  if (typeof value === 'boolean') return value ? '1' : '0';
  let text = String(value);
  if (text.length > 1 && FORMULA_PREFIX.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
};

/**
 * Build a CSV string.
 * @param {Array<Object>} rows
 * @param {Array<{key: string, label: string}>} columns
 * @returns {string}
 */
function toCSV(rows, columns) {
  const header = columns.map(c => `"${c.label}"`).join(';');
  const body = rows.map(row => columns.map(c => cell(row[c.key])).join(';'));
  return [header, ...body].join('\n');
}

/**
 * Trigger a browser download of the given data as CSV.
 * @param {Array<Object>} rows
 * @param {Array<{key: string, label: string}>} columns
 * @param {string} filename - without extension
 */
export function downloadCSV(rows, columns, filename) {
  // BOM so Excel detects UTF-8 on accented headers
  const blob = new Blob(['\uFEFF' + toCSV(rows, columns)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${filename}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
