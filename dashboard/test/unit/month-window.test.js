import { describe, it, expect } from 'vitest';
import { shiftMonths, monthWindowEndingOn } from '../../src/utils/monthWindow.js';

describe('shiftMonths', () => {
  it('goes back to the first day of an earlier month', () => {
    // Where the 12 months that end on September 2026 start
    expect(shiftMonths('2026-09-01', -11)).toBe('2025-10-01');
  });

  it('crosses New Year both ways', () => {
    expect(shiftMonths('2026-01-01', -11)).toBe('2025-02-01');
    expect(shiftMonths('2025-12-01', -11)).toBe('2025-01-01');
    expect(shiftMonths('2026-01-01', -1)).toBe('2025-12-01');
    expect(shiftMonths('2025-12-01', 1)).toBe('2026-01-01');
  });

  it('lands on the first day of the month, whatever the day it starts from', () => {
    // Not on 3 March, as 31 February would
    expect(shiftMonths('2026-03-31', -1)).toBe('2026-02-01');
  });

  it('leaves a missing date as it is', () => {
    expect(shiftMonths(undefined, -11)).toBeUndefined();
    expect(shiftMonths(null, -11)).toBeNull();
    expect(shiftMonths('', -11)).toBe('');
  });
});

// The first and last day of the months that end on a month, that one included: the 12
// months of the Web Cloud tab, and the period of the Trends tab. The server counts the
// months of the cost trends the same way: tests/months.test.js checks its trendWindow() on
// the same months.
describe('monthWindowEndingOn', () => {
  // The months the windows end on, as /api/months lists them
  const listed = {
    '2026-09': { value: '2026-09', label: 'Septembre 2026', from: '2026-09-01', to: '2026-09-30' },
    '2026-01': { value: '2026-01', label: 'Janvier 2026', from: '2026-01-01', to: '2026-01-31' },
    '2025-12': { value: '2025-12', label: 'Décembre 2025', from: '2025-12-01', to: '2025-12-31' },
    '2024-02': { value: '2024-02', label: 'Février 2024', from: '2024-02-01', to: '2024-02-29' },
  };

  it.each([
    ['2026-09', 1, '2026-09-01', '2026-09-30'],
    ['2026-09', 3, '2026-07-01', '2026-09-30'],
    ['2026-09', 12, '2025-10-01', '2026-09-30'],
    ['2026-09', 24, '2024-10-01', '2026-09-30'],
    ['2026-09', 240, '2006-10-01', '2026-09-30'],
    ['2026-01', 3, '2025-11-01', '2026-01-31'],
    ['2026-01', 12, '2025-02-01', '2026-01-31'],
    ['2025-12', 12, '2025-01-01', '2025-12-31'],
    ['2024-02', 3, '2023-12-01', '2024-02-29'],
  ])('ends on %s, %i months: from %s to %s', (end, count, from, to) => {
    expect(monthWindowEndingOn(listed[end], count)).toEqual({ from, to });
  });

  it('covers no months before a month is selected', () => {
    expect(monthWindowEndingOn(null, 3)).toBeNull();
  });
});
