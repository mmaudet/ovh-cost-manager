import { describe, it, expect } from 'vitest';
import {
  comparedVariation, comparesPartialMonth, variationDisplay, variationPercent,
} from '../../src/utils/variation.js';
import { NBSP } from '../support/amounts.js';

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

// A variation as the KPI card, the Compare tab and the Trends growth show it (#87): its text,
// and its tone, which their colours follow
describe('variationDisplay', () => {
  it('writes an increase with a plus, the French way, as an increase', () => {
    expect(variationDisplay(20, 'fr')).toEqual({ text: `+20,0${NBSP}%`, tone: 'increase' });
    expect(variationDisplay(127.27, 'fr')).toEqual({ text: `+127,3${NBSP}%`, tone: 'increase' });
  });

  it('writes a decrease with a minus, the French way, as a decrease', () => {
    expect(variationDisplay(-16.67, 'fr')).toEqual({ text: `-16,7${NBSP}%`, tone: 'decrease' });
    expect(variationDisplay(-100, 'fr')).toEqual({ text: `-100,0${NBSP}%`, tone: 'decrease' });
  });

  it('writes an increase or a decrease the English way in English', () => {
    expect(variationDisplay(20, 'en')).toEqual({ text: '+20.0%', tone: 'increase' });
    expect(variationDisplay(-16.67, 'en')).toEqual({ text: '-16.7%', tone: 'decrease' });
  });

  it('writes in French by default', () => {
    expect(variationDisplay(20)).toEqual({ text: `+20,0${NBSP}%`, tone: 'increase' });
  });

  it('writes no variation, unsigned and neutral', () => {
    expect(variationDisplay(0, 'fr')).toEqual({ text: `0,0${NBSP}%`, tone: 'neutral' });
    expect(variationDisplay(0, 'en')).toEqual({ text: '0.0%', tone: 'neutral' });
  });

  // An increase below 0.05 % read "+0,0 %" in red, as an increase that does not show
  it('writes a variation that rounds to 0, either way, unsigned and neutral', () => {
    expect(variationDisplay(0.032, 'fr')).toEqual({ text: `0,0${NBSP}%`, tone: 'neutral' });
    expect(variationDisplay(-0.032, 'fr')).toEqual({ text: `0,0${NBSP}%`, tone: 'neutral' });
    expect(variationDisplay(0.049, 'en')).toEqual({ text: '0.0%', tone: 'neutral' });
    expect(variationDisplay(-0.049, 'en')).toEqual({ text: '0.0%', tone: 'neutral' });
  });

  it('shows as an increase or a decrease once it rounds to 0.1 % either way', () => {
    expect(variationDisplay(0.05, 'fr')).toEqual({ text: `+0,1${NBSP}%`, tone: 'increase' });
    expect(variationDisplay(-0.05, 'en')).toEqual({ text: '-0.1%', tone: 'decrease' });
  });

  // Each place shows it its own way: "—" in the Compare tab, for instance (#65)
  it('shows nothing of a variation that cannot be computed', () => {
    expect(variationDisplay(variationPercent(0, 120), 'fr')).toBeNull();
  });
});

// Whether the months compared hold the month in progress at what it billed so far (#216), rather
// than at its projected cost (#217)
describe('comparesPartialMonth', () => {
  it('tells the month in progress at what it billed so far', () => {
    expect(comparesPartialMonth({ monthInProgress: true, projected: false })).toBe(true);
    expect(comparesPartialMonth({ monthInProgress: true })).toBe(true);
  });

  it('tells neither the month in progress at its projected cost, nor complete months', () => {
    expect(comparesPartialMonth({ monthInProgress: true, projected: true })).toBe(false);
    expect(comparesPartialMonth({ monthInProgress: false, projected: false })).toBe(false);
  });
});

// A variation between the months compared (comparedMonthsOf()) as the Compare tab's tables
// and the "vs previous month" KPI show it: its text and its tone, or the key of the tooltip that
// says why they show "—" (#65, #216)
describe('comparedVariation', () => {
  const complete = { monthInProgress: false };
  const inProgress = { monthInProgress: true };

  it('shows the variation between two complete months, as variationDisplay() writes it', () => {
    expect(comparedVariation(complete, 1042, 1250.4, 'fr'))
      .toEqual({ text: `+20,0${NBSP}%`, tone: 'increase' });
    expect(comparedVariation(complete, 200, 150, 'en'))
      .toEqual({ text: '-25.0%', tone: 'decrease' });
  });

  // Rather than compare a partial month with a complete one
  it('shows none with the month in progress, which is why, even from 0 €', () => {
    expect(comparedVariation(inProgress, 1042, 1250.4, 'fr'))
      .toEqual({ why: 'variationMonthInProgress' });
    expect(comparedVariation(inProgress, 0, 120, 'en'))
      .toEqual({ why: 'variationMonthInProgress' });
  });

  // Its projected cost compares with a complete month (#217)
  it('shows the variation with the month in progress at its projected cost', () => {
    const projected = { monthInProgress: true, projected: true };

    expect(comparedVariation(projected, 1042, 1250.4, 'fr'))
      .toEqual({ text: `+20,0${NBSP}%`, tone: 'increase' });
    expect(comparedVariation(projected, 0, 120, 'en', {
      notComputable: 'periodGrowthNotComputable',
    })).toEqual({ why: 'periodGrowthNotComputable' });
  });

  // The Compare tab says month A, the KPI the month before
  it('shows none from 0 € or less, which each place says its own way', () => {
    expect(comparedVariation(complete, 0, 120, 'fr')).toEqual({ why: 'variationNotComputable' });
    expect(comparedVariation(complete, -15, 100, 'fr', {
      notComputable: 'vsPreviousMonthNotComputable',
    })).toEqual({ why: 'vsPreviousMonthNotComputable' });
  });
});
