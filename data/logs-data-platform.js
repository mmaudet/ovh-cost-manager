/**
 * The charges of the Logs Data Platform services (see CONTEXT.md), and what their bill lines add
 * up to by charge and in all (#247), which the Infrastructure tab lists for the month it shows.
 * OVHcloud bills a Logs Data Platform service, `ldp-` and a code, under its « DBAAS-LOGS »
 * heading, on a line per charge: the rental of its account, « Logs - Account rental for 1 month »,
 * which covers the month of its bill, and what it consumed in the month before, such as the hot
 * storage of its streams, « Logs - Streams - Hot Storage 1 to 100 GB ».
 *
 * data/db.js selects the lines of a period, those of the resource type that the classification
 * gives these services, and chargeFigures() adds them up, when the server reads the bills: no
 * re-import. This module has no side effect.
 */

const { chargesOf, sumOf } = require('./charges');

/**
 * What the bill lines of Logs Data Platform services add up to, by charge (chargesOf()): the
 * lines of one charge add up to one row, whatever their service, their account, or the period
 * that their description ends with on some accounts' bills.
 * @param {{description: ?string, total_price: ?number}[]} lines
 * @returns {{total: number, charges: {charge: string, total: number}[]}} Each charge with what
 *   its lines add up to, to the cent, the most expensive first, then by charge: those at 0 € left
 *   out, such as the free tier of the hot storage, and those that a refund brings below 0 € kept,
 *   as a product's charges are. What the charges cost in all: the sum of their costs, to the cent,
 *   so that they add up to it, the month's Logs Data Platform cost, as its resource type gives it.
 */
function chargeFigures(lines) {
  const charges = chargesOf(lines);
  return { total: sumOf(charges, ({ total }) => total), charges };
}

module.exports = { chargeFigures };
