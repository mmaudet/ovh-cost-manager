import { describe, it, expect } from 'vitest';
import { holdsMonth } from '../../src/utils/months.js';
import { months } from '../fixtures/calendar.js';

// Whether a months list, as /api/months lists them for the account shown, holds a month: the
// month selected in the header, or a month that the Compare tab compares (#119)

const [september, august, july] = months;

describe('holdsMonth', () => {
  it('holds the months of the list', () => {
    expect(holdsMonth(months, september)).toBe(true);
    expect(holdsMonth(months, july)).toBe(true);
  });

  // The months list of another account lists its own copy of each month
  it('knows a month by its value, whatever list it comes from', () => {
    expect(holdsMonth([september, august], { ...august })).toBe(true);
  });

  it('does not hold a month that the list lacks', () => {
    expect(holdsMonth([august, july], september)).toBe(false);
  });

  // While the months list loads, and before a month is selected
  it('holds no month in an empty list, and holds none without a month', () => {
    expect(holdsMonth([], september)).toBe(false);
    expect(holdsMonth(months, null)).toBe(false);
    expect(holdsMonth(months, undefined)).toBe(false);
  });
});
