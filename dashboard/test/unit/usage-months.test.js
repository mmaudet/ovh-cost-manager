import { describe, it, expect } from 'vitest';
import { accountsOf, namesUsageMonths, showsUsageCosts } from '../../src/utils/accounts.js';
import { formatMonthLabel, formatMonthName, formatYearMonth } from '../../src/utils/format.js';

// The accounts of the instance, as accountsOf() reads the accounts route: one billed, one whose
// cost source is its Public Cloud usage (CONTEXT.md), one recorded before the cost sources, and
// the Unknown account
const accounts = accountsOf([
  { id: 'billed', name: 'Billed', costSource: 'bills' },
  { id: 'usage', name: 'Usage', costSource: 'cloudUsage' },
  { id: 'before', name: 'Before' },
  { id: 'unknown', unknown: true, costSource: null },
]);

describe('accountsOf', () => {
  it('gives each account its cost source, its bills until the route says, none for the '
    + 'Unknown account', () => {
    expect(accounts.map(({ id, costSource }) => [id, costSource])).toEqual([
      ['billed', 'bills'], ['usage', 'cloudUsage'], ['before', 'bills'], ['unknown', null],
    ]);
  });
});

describe('namesUsageMonths', () => {
  it('is true while the page shows only accounts whose cost source is their usage', () => {
    expect(namesUsageMonths(accounts, 'usage')).toBe(true);
    expect(namesUsageMonths(accounts.filter(({ id }) => id === 'usage'), null)).toBe(true);
  });

  it('is false while it shows an account billed, or the Unknown account', () => {
    expect(namesUsageMonths(accounts, 'billed')).toBe(false);
    expect(namesUsageMonths(accounts, 'unknown')).toBe(false);
    expect(namesUsageMonths(accounts, null)).toBe(false);
  });

  it('is false until the page knows the accounts and the account shown', () => {
    expect(namesUsageMonths(undefined, null)).toBe(false);
    expect(namesUsageMonths(accounts, undefined)).toBe(false);
  });
});

describe('showsUsageCosts', () => {
  it('is true while the page shows an account whose cost source is its usage', () => {
    expect(showsUsageCosts(accounts, null)).toBe(true);
    expect(showsUsageCosts(accounts, 'usage')).toBe(true);
    expect(showsUsageCosts(accounts, 'billed')).toBe(false);
    expect(showsUsageCosts(undefined, null)).toBe(false);
  });
});

describe('the months of the bills named by the month of their usage', () => {
  it('are the months before, the year before for January', () => {
    expect(formatMonthLabel('2026-11', 'fr', { ofUsage: true })).toBe('Octobre 2026');
    expect(formatMonthLabel('2027-01', 'en', { ofUsage: true })).toBe('December 2026');
    expect(formatMonthName('2026-11', 'fr', { ofUsage: true })).toBe('octobre 2026');
    expect(formatYearMonth('2026-11', 'en', { ofUsage: true })).toBe('Oct 2026');
  });

  it('keep what the page calls the month in progress', () => {
    expect(formatMonthLabel('2026-11', 'fr', { inProgressLabel: 'en cours', ofUsage: true }))
      .toBe('Octobre 2026 (en cours)');
  });

  it('are the months themselves without the option', () => {
    expect(formatMonthLabel('2026-11', 'fr')).toBe('Novembre 2026');
    expect(formatMonthLabel(undefined, 'fr', { ofUsage: true })).toBe('');
  });
});
