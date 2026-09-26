import { describe, it, expect } from 'vitest';
import { webCloudPeriodEndingOn } from '../../src/utils/webCloudPeriod.js';

// The 12 months that end on the selected month: how they are counted is unit tested with
// monthWindowEndingOn() (month-window.test.js)
describe('webCloudPeriodEndingOn', () => {
  // Months as /api/months lists them
  const january = {
    value: '2026-01', label: 'Janvier 2026', from: '2026-01-01', to: '2026-01-31',
  };
  const december = {
    value: '2025-12', label: 'Décembre 2025', from: '2025-12-01', to: '2025-12-31',
  };
  const leapFebruary = {
    value: '2024-02', label: 'Février 2024', from: '2024-02-01', to: '2024-02-29',
  };

  it('starts in the February before a January', () => {
    expect(webCloudPeriodEndingOn(january)).toEqual({ from: '2025-02-01', to: '2026-01-31' });
  });

  it('covers the calendar year that ends on a December', () => {
    expect(webCloudPeriodEndingOn(december)).toEqual({ from: '2025-01-01', to: '2025-12-31' });
  });

  it('ends on the last day of a leap February', () => {
    expect(webCloudPeriodEndingOn(leapFebruary))
      .toEqual({ from: '2023-03-01', to: '2024-02-29' });
  });

  it('covers no period before a month is selected', () => {
    expect(webCloudPeriodEndingOn(null)).toBeNull();
  });
});
