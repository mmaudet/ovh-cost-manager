import { describe, it, expect } from 'vitest';
import {
  localeOf, formatCurrency, formatPercent, formatYearMonth, formatMonthLabel, yearMonthOf,
  fmtBytes, takesSingular,
} from '../../src/utils/format.js';
import { NBSP, NNBSP } from '../support/amounts.js';

// The locale of the page's numbers and dates, which the Markdown report writes its date in
describe('localeOf', () => {
  it('writes English the American way, and French otherwise', () => {
    expect(localeOf('en')).toBe('en-US');
    expect(localeOf('fr')).toBe('fr-FR');
    expect(localeOf(undefined)).toBe('fr-FR');
  });
});

describe('formatCurrency', () => {
  it('writes an amount the French way', () => {
    expect(formatCurrency(1250.4, 'fr')).toBe(`1${NNBSP}250,40`);
    expect(formatCurrency(1234567.891, 'fr')).toBe(`1${NNBSP}234${NNBSP}567,89`);
  });

  it('writes an amount the English way in English', () => {
    expect(formatCurrency(1250.4, 'en')).toBe('1,250.40');
    expect(formatCurrency(1234567.891, 'en')).toBe('1,234,567.89');
  });

  it('writes French amounts by default', () => {
    expect(formatCurrency(1250.4)).toBe(`1${NNBSP}250,40`);
  });

  it('always shows two decimals, rounded', () => {
    expect(formatCurrency(0, 'fr')).toBe('0,00');
    expect(formatCurrency(3, 'en')).toBe('3.00');
    expect(formatCurrency(15.999, 'fr')).toBe('16,00');
    // A sum of floating-point amounts
    expect(formatCurrency(0.30000000000000004, 'fr')).toBe('0,30');
  });

  it('keeps the minus sign of a credit note', () => {
    expect(formatCurrency(-120.5, 'fr')).toBe('-120,50');
    expect(formatCurrency(-120.5, 'en')).toBe('-120.50');
  });
});

// A share of a total, such as that of the backups in the month's cost (#64)
describe('formatPercent', () => {
  it('writes a share the French way, with one decimal (#64)', () => {
    expect(formatPercent(0.092, 'fr')).toBe(`9,2${NBSP}%`);
    expect(formatPercent(0.0919, 'fr')).toBe(`9,2${NBSP}%`);
    expect(formatPercent(1, 'fr')).toBe(`100,0${NBSP}%`);
  });

  it('writes a share the English way in English (#64)', () => {
    expect(formatPercent(0.092, 'en')).toBe('9.2%');
    expect(formatPercent(0.0919, 'en')).toBe('9.2%');
    expect(formatPercent(1, 'en')).toBe('100.0%');
  });

  it('writes French shares by default (#64)', () => {
    expect(formatPercent(0.092)).toBe(`9,2${NBSP}%`);
  });

  it('keeps its decimal for a share of nothing (#64)', () => {
    expect(formatPercent(0, 'fr')).toBe(`0,0${NBSP}%`);
    expect(formatPercent(0, 'en')).toBe('0.0%');
  });
});

describe('formatYearMonth', () => {
  it('labels a month with its short name and its year', () => {
    expect(formatYearMonth('2026-09', 'fr')).toBe('sept. 2026');
    expect(formatYearMonth('2026-09', 'en')).toBe('Sep 2026');
  });

  it('labels the first and the last month of a year', () => {
    expect(formatYearMonth('2026-01', 'fr')).toBe('janv. 2026');
    expect(formatYearMonth('2025-12', 'fr')).toBe('déc. 2025');
    expect(formatYearMonth('2026-01', 'en')).toBe('Jan 2026');
    expect(formatYearMonth('2025-12', 'en')).toBe('Dec 2025');
  });

  it('labels in French by default', () => {
    expect(formatYearMonth('2026-05')).toBe('mai 2026');
  });

  it('labels nothing without a month', () => {
    expect(formatYearMonth(undefined)).toBe('');
    expect(formatYearMonth(null)).toBe('');
    expect(formatYearMonth('')).toBe('');
  });

  it('leaves as it is what is not a month', () => {
    expect(formatYearMonth('2026')).toBe('2026');
    expect(formatYearMonth('2026-00')).toBe('2026-00');
    expect(formatYearMonth('N/A')).toBe('N/A');
  });
});

// A month as the month selectors and the report name it: in the language of the page, where
// the label of /api/months is always in French (#33)
describe('formatMonthLabel', () => {
  it('names each month in full with its year, capitalised as /api/months does (#33)', () => {
    const months = ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06',
      '2026-07', '2026-08', '2026-09', '2026-10', '2026-11', '2026-12'];

    expect(months.map((month) => formatMonthLabel(month, 'fr'))).toEqual([
      'Janvier 2026', 'Février 2026', 'Mars 2026', 'Avril 2026', 'Mai 2026', 'Juin 2026',
      'Juillet 2026', 'Août 2026', 'Septembre 2026', 'Octobre 2026', 'Novembre 2026',
      'Décembre 2026',
    ]);
  });

  it('names a month in English in English (#33)', () => {
    expect(formatMonthLabel('2026-09', 'en')).toBe('September 2026');
    expect(formatMonthLabel('2026-01', 'en')).toBe('January 2026');
    expect(formatMonthLabel('2025-12', 'en')).toBe('December 2025');
  });

  it('names a month in French by default (#33)', () => {
    expect(formatMonthLabel('2026-08')).toBe('Août 2026');
  });

  it('names nothing without a month, and leaves as it is what is not one (#33)', () => {
    expect(formatMonthLabel(undefined)).toBe('');
    expect(formatMonthLabel('')).toBe('');
    expect(formatMonthLabel('2026-00')).toBe('2026-00');
    expect(formatMonthLabel('N/A')).toBe('N/A');
  });
});

// The month of a date, as the month-end forecast names that of today (#33)
describe('yearMonthOf', () => {
  it('gives the month of a date as YYYY-MM, in the local time of the page', () => {
    expect(yearMonthOf(new Date(2026, 8, 15, 12))).toBe('2026-09');
    // Still 30 September in UTC, 1 October in Paris
    expect(yearMonthOf(new Date(2026, 9, 1, 0, 30))).toBe('2026-10');
    expect(yearMonthOf(new Date(2025, 11, 31, 23, 59))).toBe('2025-12');
  });
});

// Whether a number of days reads in the singular, as the expiring services do: the Overview
// wrote "1 jours" (#74)
describe('takesSingular', () => {
  const counts = [0, 1, 2, 5, 31];

  it('takes the singular for 0 and 1 in French: 0 jour, 1 jour, 2 jours', () => {
    expect(counts.map((count) => takesSingular(count, 'fr')))
      .toEqual([true, true, false, false, false]);
  });

  it('takes the singular for 1 only in English: 0 days, 1 day, 2 days', () => {
    expect(counts.map((count) => takesSingular(count, 'en')))
      .toEqual([false, true, false, false, false]);
  });

  it('counts in French by default', () => {
    expect(takesSingular(0)).toBe(true);
  });
});

// The size of a bucket, as the Public Cloud tab shows it: in the units and the number format
// of the language (#70)
describe('fmtBytes', () => {
  it('writes a dash for a size the API does not know', () => {
    // A bucket billed but gone from the inventory
    expect(fmtBytes(null, 'fr')).toBe('-');
    expect(fmtBytes(undefined, 'en')).toBe('-');
  });

  it('writes an empty bucket in bytes (#70)', () => {
    expect(fmtBytes(0, 'fr')).toBe('0 o');
    expect(fmtBytes(0, 'en')).toBe('0 B');
  });

  it('writes a size below a kilobyte in bytes (#70)', () => {
    expect(fmtBytes(1, 'fr')).toBe('1 o');
    expect(fmtBytes(999, 'fr')).toBe('999 o');
    expect(fmtBytes(999, 'en')).toBe('999 B');
  });

  it('counts in powers of 1000, as the OVH manager does, in French units (#70)', () => {
    expect(fmtBytes(1000, 'fr')).toBe('1,0 Ko');
    expect(fmtBytes(1024, 'fr')).toBe('1,0 Ko');
    expect(fmtBytes(1000000, 'fr')).toBe('1,0 Mo');
    expect(fmtBytes(4200000000, 'fr')).toBe('4,2 Go');
    expect(fmtBytes(1500000000000, 'fr')).toBe('1,5 To');
    expect(fmtBytes(2500000000000000, 'fr')).toBe('2,5 Po');
  });

  it('counts in English units in English', () => {
    expect(fmtBytes(1000, 'en')).toBe('1.0 KB');
    expect(fmtBytes(1024, 'en')).toBe('1.0 KB');
    expect(fmtBytes(1000000, 'en')).toBe('1.0 MB');
    expect(fmtBytes(4200000000, 'en')).toBe('4.2 GB');
    expect(fmtBytes(1500000000000, 'en')).toBe('1.5 TB');
    expect(fmtBytes(2500000000000000, 'en')).toBe('2.5 PB');
  });

  it('writes French sizes by default (#70)', () => {
    expect(fmtBytes(4200000000)).toBe('4,2 Go');
  });

  it('keeps one decimal below 10 of a unit, and none from 10', () => {
    expect(fmtBytes(1500, 'fr')).toBe('1,5 Ko');
    expect(fmtBytes(1500, 'en')).toBe('1.5 KB');
    expect(fmtBytes(10000, 'en')).toBe('10 KB');
    expect(fmtBytes(12345, 'en')).toBe('12 KB');
  });

  it('rounds a half up, as the amounts do (#70)', () => {
    expect(fmtBytes(1150000000, 'fr')).toBe('1,2 Go');
    expect(fmtBytes(1150000000, 'en')).toBe('1.2 GB');
  });

  it('picks its decimals once rounded: none from 10 of a unit (#70)', () => {
    expect(fmtBytes(9949, 'en')).toBe('9.9 KB');
    expect(fmtBytes(9950, 'en')).toBe('10 KB');
    expect(fmtBytes(9950, 'fr')).toBe('10 Ko');
    expect(fmtBytes(9999, 'en')).toBe('10 KB');
    // At every unit
    expect(fmtBytes(9999999, 'en')).toBe('10 MB');
    expect(fmtBytes(9999999999, 'en')).toBe('10 GB');
    expect(fmtBytes(9999999999999, 'en')).toBe('10 TB');
  });

  it('rounds in the unit it picks, below 1000 of it', () => {
    expect(fmtBytes(999499, 'en')).toBe('999 KB');
  });

  it('picks the next unit when the size rounds to 1000 of one (#70)', () => {
    expect(fmtBytes(999999, 'en')).toBe('1.0 MB');
    expect(fmtBytes(999999, 'fr')).toBe('1,0 Mo');
    expect(fmtBytes(999500, 'en')).toBe('1.0 MB');
    expect(fmtBytes(999999999999, 'en')).toBe('1.0 TB');
  });

  it('counts in petabytes beyond, with the thousands separator of the language (#70)', () => {
    expect(fmtBytes(5000000000000000000, 'en')).toBe('5,000 PB');
    expect(fmtBytes(5000000000000000000, 'fr')).toBe(`5${NNBSP}000 Po`);
  });
});
