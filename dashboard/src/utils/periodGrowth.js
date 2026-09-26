import { variationPercent } from './variation.js';

// The growth of the costs over the period of the Trends tab, in percent, from the cost of its
// first month to the cost of its last: their variation, null when the first month costs 0 €
// or less, which leaves no growth to compute (#65).
const growthOverPeriod = (first, last) => variationPercent(first, last);

export { growthOverPeriod };
