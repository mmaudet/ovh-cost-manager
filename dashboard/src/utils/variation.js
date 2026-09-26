// The variation from one amount to another, in percent: from month A to month B in the
// Compare tab, or from the first month of a period to its last in the Trends tab. Null when
// the first amount is 0 € or less, which leaves none to compute (#65): it would be infinite
// from 0 €, and of the wrong sign from an amount whose credits exceed its costs.
const variationPercent = (from, to) => (from > 0 ? ((to - from) / from) * 100 : null);

export { variationPercent };
