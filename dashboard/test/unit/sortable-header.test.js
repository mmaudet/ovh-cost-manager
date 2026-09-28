import { describe, it, expect } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { sortRows, useTableSorts } from '../../src/components/SortableHeader.jsx';

// How every table of the page sorts its rows (#146): by the raw value of a column, never by
// what the page writes, the rows without a value last. The page tests click the headers.

// Buckets as a table holds them, in its own order: the order they keep until it is sorted
const buckets = [
  { name: 'logs-9', size: 900e6, total: 0 },
  { name: 'Archives', size: 1.5e12, total: 9 },
  { name: 'logs-10', size: 4.2e9, total: 14 },
  { name: 'éditions', size: null, total: 2 },
];
// The raw value of a bucket in each column
const values = {
  name: (bucket) => bucket.name,
  size: (bucket) => bucket.size,
  total: (bucket) => bucket.total,
};
// The buckets in the order of a sort, by name
const names = (sort, rows = buckets) => sortRows(rows, sort, values, 'fr').map(({ name }) => name);

const bySize = (direction) => ({ column: 'size', kind: 'number', direction });
const byName = (direction) => ({ column: 'name', kind: 'text', direction });

describe('sortRows', () => {
  it('keeps the rows as they are until the table is sorted', () => {
    expect(sortRows(buckets, null, values, 'fr')).toBe(buckets);
  });

  // As the page writes them, 900 Mo, 4,2 Go and 1,5 To would read the other way round
  it('sorts numbers as numbers, the largest first or last', () => {
    expect(names(bySize('desc'))).toEqual(['Archives', 'logs-10', 'logs-9', 'éditions']);
    expect(names(bySize('asc'))).toEqual(['logs-9', 'logs-10', 'Archives', 'éditions']);
  });

  it('sorts text in the alphabet of the page, its numbers as numbers, whatever the case', () => {
    expect(names(byName('asc'))).toEqual(['Archives', 'éditions', 'logs-9', 'logs-10']);
    expect(names(byName('desc'))).toEqual(['logs-10', 'logs-9', 'éditions', 'Archives']);
  });

  it('sorts text in English too', () => {
    const sorted = sortRows(buckets, byName('asc'), values, 'en').map(({ name }) => name);

    expect(sorted).toEqual(['Archives', 'éditions', 'logs-9', 'logs-10']);
  });

  // An hour apart, in two time zones: as text, they would read the other way round
  it('sorts dates as dates, whether the API gives them as text or the page as dates', () => {
    const imports = [
      { id: 'paris', at: '2026-09-15T00:30:00+02:00' },
      { id: 'utc', at: '2026-09-14T23:00:00Z' },
      { id: 'day', at: '2026-09-14' },
      { id: 'date', at: new Date('2026-09-15T08:00:00Z') },
      { id: 'never', at: null },
    ];
    const byDate = (direction) => sortRows(
      imports, { column: 'at', kind: 'date', direction }, { at: (row) => row.at }, 'fr',
    ).map(({ id }) => id);

    expect(byDate('desc')).toEqual(['date', 'utc', 'paris', 'day', 'never']);
    expect(byDate('asc')).toEqual(['day', 'paris', 'utc', 'date', 'never']);
  });

  // The page writes "-" or "—" for them
  it('puts the rows without a value last, whichever way, in their order', () => {
    const rows = [
      { id: 'none', size: null },
      { id: 'small', size: 1 },
      { id: 'missing' },
      { id: 'empty', size: '' },
      { id: 'large', size: 3 },
      { id: 'unreadable', size: NaN },
      { id: 'zero', size: 0 },
    ];
    const bySizeOf = (direction) => sortRows(rows, bySize(direction), values, 'fr')
      .map(({ id }) => id);

    // 0 is a size: the page writes 0 o
    expect(bySizeOf('desc'))
      .toEqual(['large', 'small', 'zero', 'none', 'missing', 'empty', 'unreadable']);
    expect(bySizeOf('asc'))
      .toEqual(['zero', 'small', 'large', 'none', 'missing', 'empty', 'unreadable']);
    expect(names(byName('asc'), [{ name: null }, { name: 'logs' }, { name: '' }]))
      .toEqual(['logs', null, '']);
  });

  it('keeps the rows of the same value in their order, whichever way', () => {
    const twins = [
      { name: 'web-2', total: 24 },
      { name: 'db-1', total: 64 },
      { name: 'web-1', total: 24 },
    ];
    const byTotal = (direction) => sortRows(
      twins, { column: 'total', kind: 'number', direction }, values, 'fr',
    ).map(({ name }) => name);

    expect(byTotal('desc')).toEqual(['db-1', 'web-2', 'web-1']);
    expect(byTotal('asc')).toEqual(['web-2', 'web-1', 'db-1']);
  });

  // As the Account column, which shows with all accounts only
  it('keeps the rows as they are once the table no longer shows the column it sorts by',
    () => {
      const byAccount = { column: 'account', kind: 'text', direction: 'asc' };

      expect(sortRows(buckets, byAccount, values, 'fr')).toBe(buckets);
    });

  it('returns a new list, and leaves the one it sorts as it was', () => {
    const sorted = sortRows(buckets, bySize('asc'), values, 'fr');

    expect(sorted).not.toBe(buckets);
    expect(buckets.map(({ name }) => name))
      .toEqual(['logs-9', 'Archives', 'logs-10', 'éditions']);
  });
});

describe('useTableSorts', () => {
  it('sorts no table until the user sorts it, unless a table sorts by default', () => {
    const byAmount = { column: 'total', kind: 'number', direction: 'desc' };
    const { result } = renderHook(() => useTableSorts({ projects: byAmount }));

    expect(result.current('buckets').sort).toBeNull();
    expect(result.current('projects').sort).toEqual(byAmount);
  });

  it('keeps the sort of each table, apart from the others', () => {
    const { result } = renderHook(() => useTableSorts());

    act(() => result.current('buckets').onSort(bySize('desc')));
    act(() => result.current('volumes').onSort(byName('asc')));
    act(() => result.current('buckets').onSort(bySize('asc')));

    expect(result.current('buckets').sort).toEqual(bySize('asc'));
    expect(result.current('volumes').sort).toEqual(byName('asc'));
    expect(result.current('snapshots').sort).toBeNull();
  });
});
