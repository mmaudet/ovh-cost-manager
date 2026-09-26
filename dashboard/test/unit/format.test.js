import { describe, it, expect } from 'vitest';
import { formatCurrency, formatYearMonth } from '../../src/utils/format.js';
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
