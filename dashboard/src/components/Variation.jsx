import { comparedVariation } from '../utils/variation.js';

// The sizes of a variation: in a table cell, or the headline one between the totals of the
// months compared
const SIZES = {
  cell: 'px-2 py-1 rounded text-xs font-medium',
  headline: 'px-4 py-2 rounded-full text-lg font-bold',
};

// The colours of each tone of a variation
const TONES = {
  increase: 'bg-red-100 text-red-700',
  decrease: 'bg-green-100 text-green-700',
  neutral: 'bg-gray-100 text-gray-700',
};

// The variation from one amount to another between the months compared (comparedMonths, see
// comparedMonthsOf()), as every table and the headline of the Compare tab show it: in percent, in
// the number format of the language, red when it grows, green when it shrinks, and grey when it
// rounds to 0 (#87). When none is computed, from 0 € or less (#65) or with the month in progress
// (#216), "—", with a tooltip that says why (comparedVariation()).
const Variation = ({ from, to, comparedMonths, language, t, size = 'cell' }) => {
  const variation = comparedVariation(comparedMonths, from, to, language);
  if (variation.why) {
    return (
      <span className={`${SIZES[size]} text-gray-400`} title={t(variation.why)}>
        —
      </span>
    );
  }
  return <span className={`${SIZES[size]} ${TONES[variation.tone]}`}>{variation.text}</span>;
};

export { Variation };
