import { describe, it, expect } from 'vitest';
import { shiftMonths } from '../../src/utils/webCloudPeriod.js';

describe('shiftMonths', () => {
  it('goes back to the first day of an earlier month', () => {
    // Where the 12 months that end on September 2026 start
    expect(shiftMonths('2026-09-01', -11)).toBe('2025-10-01');
  });

  it('crosses New Year both ways', () => {
    expect(shiftMonths('2026-01-01', -11)).toBe('2025-02-01');
    expect(shiftMonths('2025-12-01', -11)).toBe('2025-01-01');
    expect(shiftMonths('2026-01-01', -1)).toBe('2025-12-01');
    expect(shiftMonths('2025-12-01', 1)).toBe('2026-01-01');
  });

  it('lands on the first day of the month, whatever the day it starts from', () => {
    // Not on 3 March, as 31 February would
    expect(shiftMonths('2026-03-31', -1)).toBe('2026-02-01');
  });
});
