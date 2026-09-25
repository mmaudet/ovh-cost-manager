/**
 * Tests for the month bounds behind /api/months.
 *
 * The bounds must not depend on the server timezone. Jest ignores TZ changes
 * made at runtime, hence a child process per timezone.
 */

const path = require('path');
const { execFileSync } = require('child_process');

function monthBoundsInTimezone(yearMonth, timezone) {
  const monthsModule = path.join(__dirname, '..', 'server', 'months.js');
  const script = `process.stdout.write(JSON.stringify(require(${JSON.stringify(monthsModule)}).monthBounds(${JSON.stringify(yearMonth)})))`;
  const output = execFileSync(process.execPath, ['-e', script], {
    env: { ...process.env, TZ: timezone },
    encoding: 'utf8'
  });
  return JSON.parse(output);
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
