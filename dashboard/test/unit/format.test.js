import { describe, it, expect } from 'vitest';
import { formatCurrency, formatYearMonth, fmtBytes } from '../../src/utils/format.js';
import { NNBSP } from '../support/amounts.js';

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

// The size of a bucket, as the Public Cloud tab shows it. The same in every language: it
// takes none, and writes a decimal point in French too.
describe('fmtBytes', () => {
  it('writes a dash for a size the API does not know', () => {
    // A bucket billed but gone from the inventory
    expect(fmtBytes(null)).toBe('-');
    expect(fmtBytes(undefined)).toBe('-');
  });

  it('writes an empty bucket in bytes', () => {
    expect(fmtBytes(0)).toBe('0 B');
  });

  it('writes a size below a kilobyte in bytes', () => {
    expect(fmtBytes(1)).toBe('1 B');
    expect(fmtBytes(999)).toBe('999 B');
  });

  it('counts in powers of 1000, as the OVH manager does', () => {
    expect(fmtBytes(1000)).toBe('1.0 KB');
    expect(fmtBytes(1024)).toBe('1.0 KB');
    expect(fmtBytes(1000000)).toBe('1.0 MB');
    expect(fmtBytes(4200000000)).toBe('4.2 GB');
    expect(fmtBytes(1500000000000)).toBe('1.5 TB');
    expect(fmtBytes(2500000000000000)).toBe('2.5 PB');
  });

  it('keeps one decimal below 10 of a unit, and none from 10', () => {
    expect(fmtBytes(1500)).toBe('1.5 KB');
    expect(fmtBytes(10000)).toBe('10 KB');
    expect(fmtBytes(12345)).toBe('12 KB');
  });

  it('rounds in the unit it picks, up to 1000 of it', () => {
    expect(fmtBytes(9999)).toBe('10.0 KB');
    expect(fmtBytes(999999)).toBe('1000 KB');
  });

  it('counts in petabytes beyond', () => {
    expect(fmtBytes(5000000000000000000)).toBe('5000 PB');
  });
});
