import { describe, it, expect, vi } from 'vitest';
import { translations } from '../../src/i18n/translations.js';
import { PERIOD_OPTIONS, monthsSince, availablePeriodsFor } from '../../src/utils/trendPeriods.js';

// "Today" is 15 September 2026 (see setup.js)

describe('trend period options', () => {
  it('go from 3 months to 20 years, each labelled in French and in English', () => {
    const options = PERIOD_OPTIONS.map(({ months, key }) =>
      [months, translations.fr[key], translations.en[key]]);

    expect(options).toEqual([
      [3, '3 mois', '3 months'],
      [6, '6 mois', '6 months'],
      [12, '1 an', '1 year'],
      [24, '2 ans', '2 years'],
      [36, '3 ans', '3 years'],
      [60, '5 ans', '5 years'],
      [120, '10 ans', '10 years'],
      [180, '15 ans', '15 years'],
      [240, '20 ans', '20 years'],
    ]);
  });
});

// The months of data: the Trends tab offers the period options up to the
// first one that covers them all.
describe('monthsSince', () => {
  it.each([
    ['2026-09', 1],
    ['2026-07', 3],
    ['2026-04', 6],
    ['2025-10', 12],
    ['2025-09', 13],
    ['2006-10', 240],
    ['2006-09', 241],
  ])('counts the months from %s to this month, both included: %i', (oldest, months) => {
    expect(monthsSince(oldest)).toBe(months);
  });

  it('counts across New Year', () => {
    vi.setSystemTime(new Date('2027-01-05T10:00:00Z'));

    expect(monthsSince('2027-01')).toBe(1);
    expect(monthsSince('2026-12')).toBe(2);
    expect(monthsSince('2026-02')).toBe(12);
  });

  it('counts no month without one', () => {
    expect(monthsSince(undefined)).toBe(0);
    expect(monthsSince(null)).toBe(0);
    expect(monthsSince('')).toBe(0);
  });

  it('counts no month from what is not a month', () => {
    expect(monthsSince('2026')).toBe(0);
    expect(monthsSince('2026-00')).toBe(0);
    expect(monthsSince('N/A')).toBe(0);
  });
});

// The periods offered for that many months of data: every period up to the first one that
// covers them all.
describe('availablePeriodsFor', () => {
  // The periods offered, as their lengths in months
  const lengths = (periods) => periods.map(({ months }) => months);

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
