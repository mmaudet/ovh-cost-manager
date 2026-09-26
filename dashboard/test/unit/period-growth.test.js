import { describe, it, expect } from 'vitest';
import { growthOverPeriod } from '../../src/utils/periodGrowth.js';

// The growth of the costs over the period of the Trends tab, in percent, from the cost of its
// first month to the cost of its last
describe('growthOverPeriod', () => {
  it('grows from a positive first month', () => {
    expect(growthOverPeriod(100, 150)).toBe(50);
    expect(growthOverPeriod(980, 1250.4)).toBeCloseTo(27.59, 2);
  });

  it('shrinks from a positive first month', () => {
    expect(growthOverPeriod(200, 150)).toBe(-25);
  });

  it('is nil from a first month equal to the last', () => {
    expect(growthOverPeriod(980, 980)).toBe(0);
  });

  // It would be infinite (#65)
  it('cannot be computed from a first month at 0 €', () => {
    expect(growthOverPeriod(0, 1250.4)).toBeNull();
    expect(growthOverPeriod(0, 0)).toBeNull();
  });

  // Credits larger than the costs: it would have the wrong sign (#65)
  it('cannot be computed from a negative first month', () => {
    expect(growthOverPeriod(-120.5, 1250.4)).toBeNull();
  });
});
