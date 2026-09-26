import { describe, it, expect } from 'vitest';
import { availablePeriodsFor } from '../../src/utils/trendPeriods.js';

// The trend periods offered for a number of months of data: every period up to the first
// one that covers them all. How many months there are is counted by monthsSince().

// The periods offered, as their lengths in months
const lengths = (periods) => periods.map(({ months }) => months);

describe('availablePeriodsFor', () => {
  it('offers 3 months when there is no month of data', () => {
    expect(availablePeriodsFor(0)).toEqual([{ months: 3, key: 'period3m' }]);
  });

  it.each([
    [1, [3]],
    [3, [3]],
    [6, [3, 6]],
    [13, [3, 6, 12, 24]],
  ])('offers up to the first period that covers %i months: %j', (maxMonths, offered) => {
    expect(lengths(availablePeriodsFor(maxMonths))).toEqual(offered);
  });

  it('stops at 1 year for exactly 12 months', () => {
    expect(availablePeriodsFor(12)).toEqual([
      { months: 3, key: 'period3m' },
      { months: 6, key: 'period6m' },
      { months: 12, key: 'period1y' },
    ]);
  });

  it('offers every period, up to 20 years, for more than 240 months', () => {
    expect(lengths(availablePeriodsFor(241))).toEqual([3, 6, 12, 24, 36, 60, 120, 180, 240]);
    expect(lengths(availablePeriodsFor(600))).toEqual([3, 6, 12, 24, 36, 60, 120, 180, 240]);
  });
});
