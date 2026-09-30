import { describe, it, expect } from 'vitest';
import { translations } from '../../src/i18n/translations.js';
import { formatCurrency } from '../../src/utils/format.js';
import { lineParts, trendAmount } from '../../src/utils/trendLines.js';
import { NNBSP } from '../support/amounts.js';

// How the line charts of the Trends tab draw the month in progress (#216), and what their
// tooltips say of it (#217): the drawing itself cannot be read in jsdom

// The translations and the amount format of the page in a language, as the shell gives them
const tIn = (language) => (key) => translations[language][key];
const fmtIn = (language) => (value) => formatCurrency(value, language);

// Three months of a trend, September the month in progress
const threeMonths = [
  { yearMonth: '2026-07', cost: 980 },
  { yearMonth: '2026-08', cost: 1042 },
  { yearMonth: '2026-09', cost: 980.4 },
];
// The values of a part of a series in each month of a trend
const valuesOf = (part, rows) => rows.map(part);

describe('lineParts', () => {
  it('joins the complete months with the solid part, and the month in progress with the dashed one',
    () => {
      const parts = lineParts(threeMonths, '2026-09');

      expect(valuesOf(parts.solid('cost'), threeMonths)).toEqual([980, 1042, null]);
      // From the month before it
      expect(valuesOf(parts.dashed('cost'), threeMonths)).toEqual([null, 1042, 980.4]);
    });

  it('draws every month solid while none is in progress', () => {
    const parts = lineParts(threeMonths, null);

    expect(valuesOf(parts.solid('cost'), threeMonths)).toEqual([980, 1042, 980.4]);
    expect(valuesOf(parts.dashed('cost'), threeMonths)).toEqual([null, null, null]);
  });

  // Over the month in progress alone, as over a period of one month
  it('gives the dashed part the month in progress alone when it is the only month', () => {
    const september = [threeMonths[2]];
    const parts = lineParts(september, '2026-09');

    expect(valuesOf(parts.solid('cost'), september)).toEqual([null]);
    expect(valuesOf(parts.dashed('cost'), september)).toEqual([980.4]);
  });

  it('reads the key of the series it is given', () => {
    const byResourceType = [
      { yearMonth: '2026-08', dedicated_server: 270 },
      { yearMonth: '2026-09', dedicated_server: 0 },
    ];
    const parts = lineParts(byResourceType, '2026-09');

    expect(valuesOf(parts.dashed('dedicated_server'), byResourceType)).toEqual([270, 0]);
  });
});

describe('trendAmount', () => {
  const complete = { inProgress: false, projected: false };

  it('gives the amount of a complete month', () => {
    expect(trendAmount(1042, 0, complete, fmtIn('fr'), tIn('fr'))).toBe(`1${NNBSP}042,00€`);
  });

  // The amount that the chart draws, as the month has billed it so far
  it('gives what the month in progress billed, while the trends do not project it', () => {
    const billedSoFar = { inProgress: true, projected: false };

    expect(trendAmount(980.4, 0, billedSoFar, fmtIn('fr'), tIn('fr'))).toBe('facturé 980,40€');
    expect(trendAmount(980.4, 0, billedSoFar, fmtIn('en'), tIn('en'))).toBe('billed 980.40€');
  });

  // The chart draws its projected cost: 980.40 € billed, and 270 € of projected lines
  it('gives what the month in progress billed and its projected cost, while they project it',
    () => {
      const projected = { inProgress: true, projected: true };

      expect(trendAmount(1250.4, 270, projected, fmtIn('fr'), tIn('fr')))
        .toBe(`facturé 980,40€, projeté 1${NNBSP}250,40€`);
      expect(trendAmount(1250.4, 270, projected, fmtIn('en'), tIn('en')))
        .toBe('billed 980.40€, projected 1,250.40€');
    });
});
