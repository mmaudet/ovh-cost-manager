// The growth of the costs over the period of the Trends tab, in percent, from the cost of its
// first month to the cost of its last. Null when the first month costs 0 € or less, which
// leaves no growth to compute (#65): it would be infinite from 0 €, and of the wrong sign
// from a month whose credits exceed its costs.
const growthOverPeriod = (first, last) => (first > 0 ? ((last - first) / first) * 100 : null);

export { growthOverPeriod };
