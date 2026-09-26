import { describe, it, expect } from 'vitest';
import { parseSqliteDate } from '../../src/utils/sqliteDate.js';

// SQLite writes its timestamps in UTC, without saying so. The tests run in
// Paris time (see vitest.config.js): UTC+2 in summer, UTC+1 in winter.
describe('parseSqliteDate', () => {
  it('reads a SQLite timestamp as UTC', () => {
    expect(parseSqliteDate('2026-09-14 04:02:30').toISOString()).toBe('2026-09-14T04:02:30.000Z');
  });

  it('gives a date that reads in local time: two hours later in summer', () => {
    const date = parseSqliteDate('2026-09-14 04:02:30');

    expect(date.getHours()).toBe(6);
    expect(date.toLocaleString('fr-FR')).toBe('14/09/2026 06:02:30');
  });

  it('and one hour later in winter', () => {
    expect(parseSqliteDate('2026-01-15 10:00:00').toLocaleString('fr-FR'))
      .toBe('15/01/2026 11:00:00');
  });

  it('moves a timestamp of late New Year\'s Eve to the next year', () => {
    expect(parseSqliteDate('2025-12-31 23:30:00').toLocaleString('fr-FR'))
      .toBe('01/01/2026 00:30:00');
  });
});
