import { localeOf } from './format.js';

// The variation from one amount to another, in percent: from month A to month B in the
// Compare tab, or from the first month of a period to its last in the Trends tab. Null when
// the first amount is 0 € or less, which leaves none to compute (#65): it would be infinite
// from 0 €, and of the wrong sign from an amount whose credits exceed its costs.
const variationPercent = (from, to) => (from > 0 ? ((to - from) / from) * 100 : null);

// A variation in percent as the page shows it (#87): its text, with one decimal in the number
// format of the language, and its tone, which the colour of the text follows. Both go by the
// variation as written, rounded: an increase reads +20,0 % and shows in red, a decrease reads
// -16,7 % in green, and a variation that rounds to 0, either way, reads 0,0 %, unsigned and
// neutral. Null for a variation that cannot be computed, which each place shows its way (#65).
const variationDisplay = (percent, language = 'fr') => {
  if (percent === null) return null;
  const parts = new Intl.NumberFormat(localeOf(language), {
    style: 'percent',
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
    signDisplay: 'exceptZero',
  }).formatToParts(percent / 100);
  const sign = parts.find(({ type }) => type === 'plusSign' || type === 'minusSign')?.type;
  return {
    text: parts.map(({ value }) => value).join(''),
    tone: { plusSign: 'increase', minusSign: 'decrease' }[sign] ?? 'neutral',
  };
};

export { variationPercent, variationDisplay };
