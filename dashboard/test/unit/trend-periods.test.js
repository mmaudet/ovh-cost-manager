import { describe, it, expect, vi } from 'vitest';
import { translations } from '../../src/i18n/translations.js';
import { PERIOD_OPTIONS, monthsSince } from '../../src/utils/trendPeriods.js';

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
});
