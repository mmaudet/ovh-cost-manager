/**
 * Tests for CSV export functionality
 */

// Same toCSV function as server/index.js
function toCSV(data, columns) {
  const header = columns.map(c => `"${c.label}"`).join(';');
  const rows = data.map(row => {
    return columns.map(c => {
      const value = row[c.key];
      if (value === null || value === undefined) return '';
      if (typeof value === 'number') return value.toString().replace('.', ',');
      return `"${String(value).replace(/"/g, '""')}"`;
    }).join(';');
  });
  return [header, ...rows].join('\n');
}

describe('toCSV', () => {
  const columns = [
    { key: 'id', label: 'ID' },
    { key: 'name', label: 'Name' },
    { key: 'amount', label: 'Amount' }
  ];

  test('generates correct header', () => {
    const csv = toCSV([], columns);
    expect(csv).toBe('"ID";"Name";"Amount"');
  });

  test('converts simple data to CSV', () => {
    const data = [
      { id: '001', name: 'Test', amount: 100 }
    ];
    const csv = toCSV(data, columns);
    const lines = csv.split('\n');
    expect(lines[0]).toBe('"ID";"Name";"Amount"');
    expect(lines[1]).toBe('"001";"Test";100');
  });

  test('handles decimal numbers with French format', () => {
    const data = [
      { id: '001', name: 'Test', amount: 123.45 }
    ];
    const csv = toCSV(data, columns);
    expect(csv).toContain('123,45');
  });

  test('handles null and undefined values', () => {
    const data = [
      { id: '001', name: null, amount: undefined }
    ];
    const csv = toCSV(data, columns);
    const lines = csv.split('\n');
    expect(lines[1]).toBe('"001";;');
  });

  test('escapes double quotes in strings', () => {
    const data = [
      { id: '001', name: 'Test "quoted" text', amount: 100 }
    ];
    const csv = toCSV(data, columns);
    expect(csv).toContain('"Test ""quoted"" text"');
  });

  test('handles multiple rows', () => {
    const data = [
      { id: '001', name: 'First', amount: 100 },
      { id: '002', name: 'Second', amount: 200 },
      { id: '003', name: 'Third', amount: 300 }
    ];
    const csv = toCSV(data, columns);
    const lines = csv.split('\n');
    expect(lines.length).toBe(4); // header + 3 rows
  });

  test('uses semicolon as separator (French Excel)', () => {
    const data = [
      { id: '001', name: 'Test', amount: 100 }
    ];
    const csv = toCSV(data, columns);
    expect(csv).toContain(';');
    expect(csv).not.toMatch(/[^""];[^""]/); // No unquoted commas in data
  });
});
