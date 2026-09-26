import { describe, it, expect } from 'vitest';
import { variationPercent } from '../../src/utils/variation.js';

// The variation from one amount to another, in percent: from month A to month B in the
// Compare tab, from the first month of a period to its last in the Trends tab
describe('variationPercent', () => {
  it('grows from a positive amount', () => {
    expect(variationPercent(100, 150)).toBe(50);
    expect(variationPercent(1042, 1250.4)).toBeCloseTo(20, 10);
  });

  it('shrinks from a positive amount, to -100 % at 0 € and below it with credits', () => {
    expect(variationPercent(200, 150)).toBe(-25);
    expect(variationPercent(200, 0)).toBe(-100);
    expect(variationPercent(100, -15)).toBeCloseTo(-115, 10);
  });

  it('is 0 % between equal amounts', () => {
    expect(variationPercent(980, 980)).toBe(0);
  });

  // It would be infinite (#65)
  it('cannot be computed from 0 €', () => {
    expect(variationPercent(0, 120)).toBeNull();
    expect(variationPercent(0, 0)).toBeNull();
    expect(variationPercent(0, -15)).toBeNull();
  });

  // Credits larger than the costs: it would have the wrong sign (#65), -766.7 % from -15 €
  // to 100 €
  it('cannot be computed from a negative amount', () => {
    expect(variationPercent(-15, 100)).toBeNull();
    expect(variationPercent(-15, -30)).toBeNull();
  });
});
