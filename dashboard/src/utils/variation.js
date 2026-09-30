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

/**
 * Whether the months compared (comparedMonthsOf() in monthComparison.js) hold the month in
 * progress at what it billed so far: no variation of it is computed then, rather than compare a
 * partial month with a complete one (#216). At its projected cost, they are (#217).
 * @param {{ includesMonthInProgress: boolean, projected?: boolean }} comparedMonths
 * @returns {boolean}
 */
const comparesPartialMonth = ({ includesMonthInProgress, projected = false }) => (
  includesMonthInProgress && !projected
);

/**
 * The variation between the months compared (comparedMonthsOf() in monthComparison.js), as
 * the Compare tab's tables, the "vs previous month" KPI and the Trends tab's growth over the
 * period show it, or why they show "—": the month in progress at what it billed so far, which it
 * would compare, partial, with a complete month (#216), or an amount to compare with at 0 € or
 * less (#65), which each place words its own way. The month in progress at its projected cost
 * compares as a complete month (#217).
 * @param {{ includesMonthInProgress: boolean, projected?: boolean }} comparedMonths
 * @param {number} from - The amount of the first month
 * @param {number} to - The amount of the second
 * @param {string} language - The page's, 'fr' or 'en'
 * @param {object} [options]
 * @param {string} [options.notComputable] - The translation key of the tooltip that says why no
 *   variation from 0 € or less is computed: that of the Compare tab's, from month A, by default
 * @returns {{ text: string, tone: string } | { why: string }} Its text and tone
 *   (variationDisplay()), or the translation key of the tooltip that says why there are none
 */
const comparedVariation = (
  comparedMonths, from, to, language, { notComputable = 'variationNotComputable' } = {},
) => {
  if (comparesPartialMonth(comparedMonths)) return { why: 'variationMonthInProgress' };
  return variationDisplay(variationPercent(from, to), language) ?? { why: notComputable };
};

export { variationPercent, variationDisplay, comparesPartialMonth, comparedVariation };
