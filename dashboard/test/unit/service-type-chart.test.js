import { describe, it, expect } from 'vitest';
import { serviceTypeBars } from '../../src/utils/serviceTypeChart.js';

// What the Compare tab's chart of the service types draws of a type in a month (#218): the drawing
// itself cannot be read in jsdom. The bar and what stacks on it always reach the type's cost, its
// projected cost for the month in progress while the page projects it.
describe('serviceTypeBars', () => {
  it('draws what a complete month billed, with nothing stacked on it', () => {
    expect(serviceTypeBars({ name: 'Compute', value: 690 }))
      .toEqual({ bar: 690, stacked: 0, projected: 0 });
  });

  // Billed 530.40 €, and 270 € of a server's line of the month before
  it('stacks a projected part on what the month in progress billed, up to its projected cost',
    () => {
      expect(serviceTypeBars({ name: 'Compute', value: 800.4, projected: 270 }))
        .toEqual({ bar: 530.4, stacked: 270, projected: 270 });
    });

  // Billed 200 €, and the credit of -20 € that a project's lines of the month before used (#219):
  // a bar of 180 €, rather than one of 200 € whose top 20 € the part would be drawn over, which
  // would read as 180 € billed and 20 € projected
  it('draws the projected cost as the bar, with nothing stacked, when its part is below 0', () => {
    expect(serviceTypeBars({ name: 'Other', value: 180, projected: -20 }))
      .toEqual({ bar: 180, stacked: 0, projected: -20 });
  });

  // As a type of month A that month B did not bill, which the chart draws at 0 €
  it('draws nothing of a type that the month did not bill', () => {
    expect(serviceTypeBars(undefined)).toEqual({ bar: 0, stacked: 0, projected: 0 });
  });
});
