import { describe, it, expect } from 'vitest';
import { shiftMonths, webCloudPeriodEndingOn } from '../../src/utils/webCloudPeriod.js';

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

describe('webCloudPeriodEndingOn', () => {
  // Months as /api/months lists them
  const january = {
    value: '2026-01', label: 'Janvier 2026', from: '2026-01-01', to: '2026-01-31',
  };
  const december = {
    value: '2025-12', label: 'Décembre 2025', from: '2025-12-01', to: '2025-12-31',
  };
  const leapFebruary = {
    value: '2024-02', label: 'Février 2024', from: '2024-02-01', to: '2024-02-29',
  };

  it('starts in the February before a January', () => {
    expect(webCloudPeriodEndingOn(january)).toEqual({ from: '2025-02-01', to: '2026-01-31' });
  });

  it('covers the calendar year that ends on a December', () => {
    expect(webCloudPeriodEndingOn(december)).toEqual({ from: '2025-01-01', to: '2025-12-31' });
  });

  it('ends on the last day of a leap February', () => {
    expect(webCloudPeriodEndingOn(leapFebruary))
      .toEqual({ from: '2023-03-01', to: '2024-02-29' });
  });

  it('covers no period before a month is selected', () => {
    expect(webCloudPeriodEndingOn(null)).toBeNull();
  });
});
