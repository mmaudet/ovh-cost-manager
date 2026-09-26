/**
 * Tests for the month bounds behind /api/months, for the months that a trend
 * covers, and for the months it lists.
 *
 * The bounds must not depend on the server timezone. Jest ignores TZ changes
 * made at runtime, hence a child process per timezone.
 */

const path = require('path');
const { execFileSync } = require('child_process');
const { trendWindowFromQuery } = require('../server/months');
const { monthsOfWindow, trendWindow } = require('../data/months');

// Calls a function of data/months.js in a Node process of its own, run in a
// timezone
function callInTimezone(timezone, name, ...args) {
  const monthsModule = path.join(__dirname, '..', 'data', 'months.js');
  const script = `process.stdout.write(JSON.stringify(require(${JSON.stringify(monthsModule)})`
    + `.${name}(...${JSON.stringify(args)})))`;
  const output = execFileSync(process.execPath, ['-e', script], {
    env: { ...process.env, TZ: timezone },
    encoding: 'utf8'
  });
  return JSON.parse(output);
}

function monthBoundsInTimezone(yearMonth, timezone) {
  return callInTimezone(timezone, 'monthBounds', yearMonth);
}

function trendWindowInTimezone(endMonth, months, timezone) {
  return callInTimezone(timezone, 'trendWindow', endMonth, months);
}

describe('monthBounds', () => {
  test.each(['UTC', 'America/New_York', 'Europe/Paris', 'Pacific/Kiritimati'])(
    'ends February 2026 on the 28th in %s',
    (timezone) => {
      expect(monthBoundsInTimezone('2026-02', timezone)).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    }
  );

  test('ends a leap-year February on the 29th', () => {
    expect(monthBoundsInTimezone('2024-02', 'Europe/Paris')).toEqual({ from: '2024-02-01', to: '2024-02-29' });
  });

  test('ends December on the 31st', () => {
    expect(monthBoundsInTimezone('2025-12', 'Europe/Paris')).toEqual({ from: '2025-12-01', to: '2025-12-31' });
  });
});

// A trend over N months covers N calendar months, the month it ends on included. The
// dashboard counts its windows the same way: dashboard/test/unit/month-window.test.js checks
// its monthWindowEndingOn() on the same months.
describe('trendWindow', () => {
  test.each([
    ['2026-09', 1, '2026-09-01', '2026-09-30'],
    ['2026-09', 3, '2026-07-01', '2026-09-30'],
    ['2026-09', 12, '2025-10-01', '2026-09-30'],
    ['2026-09', 24, '2024-10-01', '2026-09-30'],
    ['2026-09', 240, '2006-10-01', '2026-09-30'],
    ['2026-01', 3, '2025-11-01', '2026-01-31'],
    ['2026-01', 12, '2025-02-01', '2026-01-31'],
    ['2025-12', 12, '2025-01-01', '2025-12-31'],
    ['2024-02', 3, '2023-12-01', '2024-02-29'],
  ])('ends on %s, %i months: from %s to %s', (endMonth, months, from, to) => {
    expect(trendWindowInTimezone(endMonth, months, 'Europe/Paris')).toEqual({ from, to });
  });

  test.each(['UTC', 'America/New_York', 'Europe/Paris', 'Pacific/Kiritimati'])(
    'covers July to September for 3 months that end on September 2026 in %s',
    (timezone) => {
      expect(trendWindowInTimezone('2026-09', 3, timezone))
        .toEqual({ from: '2026-07-01', to: '2026-09-30' });
    }
  );
});

// The window that the trend routes read from their query, ?months=3&end=2026-09, and the
// month of the latest bill. It does not read the real date: no timezone to run it in.
describe('trendWindowFromQuery', () => {
  // The latest bill of the account is from August 2026
  const windowOf = (query) => trendWindowFromQuery(query, '2026-08');

  test('ends on the month the query names', () => {
    expect(windowOf({ months: '3', end: '2026-09' }))
      .toEqual({ valid: true, from: '2026-07-01', to: '2026-09-30' });
  });

  test('covers 6 months when the query names no number of months', () => {
    expect(windowOf({ end: '2026-09' }))
      .toEqual({ valid: true, from: '2026-04-01', to: '2026-09-30' });
    expect(windowOf({ months: '', end: '2026-09' }))
      .toEqual({ valid: true, from: '2026-04-01', to: '2026-09-30' });
  });

  // Up to the longest period that the Trends tab offers, 20 years
  test('covers from 1 to 240 months', () => {
    expect(windowOf({ months: '1', end: '2026-09' }))
      .toEqual({ valid: true, from: '2026-09-01', to: '2026-09-30' });
    expect(windowOf({ months: '240', end: '2026-09' }))
      .toEqual({ valid: true, from: '2006-10-01', to: '2026-09-30' });
  });

  test.each(['-3', '0', '241', '100000000', '1.5', '6m', 'six'])(
    'refuses %s months',
    (months) => {
      expect(windowOf({ months, end: '2026-09' })).toEqual({
        valid: false,
        error: `Invalid 'months' value: ${months}. Expected an integer from 1 to 240`,
      });
    }
  );

  // Where the bills end, as the dashboard's latest month, whatever the date today
  test('ends on the month of the latest bill when the query names no end month', () => {
    expect(windowOf({ months: '3' }))
      .toEqual({ valid: true, from: '2026-06-01', to: '2026-08-31' });
  });

  test('reads an empty end month as none', () => {
    expect(windowOf({ months: '3', end: '' }))
      .toEqual({ valid: true, from: '2026-06-01', to: '2026-08-31' });
  });

  // No window: a trend over it finds no bill (see trend-queries.test.js)
  test('covers no months when the query names no end month and nothing was billed', () => {
    expect(trendWindowFromQuery({ months: '3' }, undefined))
      .toEqual({ valid: true, from: null, to: null });
  });

  test.each(['2026-9', '09-2026', '2026-09-01', 'september'])(
    'refuses an end month written %s',
    (end) => {
      expect(windowOf({ months: '3', end }))
        .toEqual({ valid: false, error: `Invalid 'end' month format: ${end}. Expected YYYY-MM` });
    }
  );

  test.each(['2026-00', '2026-13'])('refuses %s, which is no month', (end) => {
    expect(windowOf({ months: '3', end }))
      .toEqual({ valid: false, error: `Invalid 'end' month: ${end}` });
  });
});

// The months that a trend lists, each one, billed or not (#65), from the first and last day
// of its window. It counts on the digits of the dates, not on Date: no timezone to run it in.
describe('monthsOfWindow', () => {
  test('lists the months from the first day to the last, both included', () => {
    expect(monthsOfWindow('2026-07-01', '2026-09-30'))
      .toEqual(['2026-07', '2026-08', '2026-09']);
  });

  test('lists a single month for a window within it', () => {
    expect(monthsOfWindow('2026-09-01', '2026-09-30')).toEqual(['2026-09']);
  });

  test('ends on December', () => {
    expect(monthsOfWindow('2025-10-01', '2025-12-31'))
      .toEqual(['2025-10', '2025-11', '2025-12']);
  });

  test('crosses New Year', () => {
    expect(monthsOfWindow('2025-11-01', '2026-01-31'))
      .toEqual(['2025-11', '2025-12', '2026-01']);
    expect(monthsOfWindow('2025-10-01', '2026-09-30')).toEqual([
      '2025-10', '2025-11', '2025-12', '2026-01', '2026-02', '2026-03',
      '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09',
    ]);
  });

  // The longest period that the Trends tab offers, 20 years
  test('lists the 240 months of 20 years', () => {
    const months = monthsOfWindow('2006-10-01', '2026-09-30');

    expect(months).toHaveLength(240);
    expect(months.slice(0, 4)).toEqual(['2006-10', '2006-11', '2006-12', '2007-01']);
    expect(months.slice(-2)).toEqual(['2026-08', '2026-09']);
  });

  // As for an account with no bill, where trendWindowFromQuery() gives no window
  test('lists no months without a window', () => {
    expect(monthsOfWindow(null, null)).toEqual([]);
  });

  // trendWindow() counts the months of a trend the same way
  test.each([
    ['2026-09', 1],
    ['2026-09', 3],
    ['2026-01', 12],
    ['2025-12', 12],
    ['2024-02', 3],
    ['2026-09', 240],
  ])('lists the months of a trend window that ends on %s, %i of them', (end, months) => {
    const { from, to } = trendWindow(end, months);
    const listed = monthsOfWindow(from, to);

    expect(listed).toHaveLength(months);
    expect(listed[listed.length - 1]).toBe(end);
  });
});
