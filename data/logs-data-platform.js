/**
 * The charges of the Logs Data Platform services (see CONTEXT.md), and what their bill lines add
 * up to by charge and in all (#247), which the Infrastructure tab lists for the month it shows,
 * and the Compare tab's row of their resource type unfolds into, month A against month B (#248).
 * OVHcloud bills a Logs Data Platform service, `ldp-` and a code, under its « DBAAS-LOGS »
 * heading, on a line per charge: the rental of its account, « Logs - Account rental for 1 month »,
 * which covers the month of its bill, and what it consumed in the month before, such as the hot
 * storage of its streams, « Logs - Streams - Hot Storage 1 to 100 GB ».
 *
 * data/db.js selects the lines of a period, those of the resource type that the classification
 * gives these services, the projected lines of the month in progress included on request, and
 * chargeFigures() adds them up, when the server reads the bills: no re-import. This module has no
 * side effect.
 */

const { chargesOf, sumOf } = require('./charges');

/**
 * What the bill lines of Logs Data Platform services add up to, by charge (chargesOf()): the
 * lines of one charge add up to one row, whatever their service, their account, or the period
 * that their description ends with on some accounts' bills.
 *
 * With the projected option, the lines are those that a query of the costs adds up with the
 * projected lines of the month in progress (linesOfPeriod() in data/db.js), each with its
 * projected part, `projected`: its whole cost for a projected line, 0 for a bill line (#248).
 * Each charge then gives its projected part, as chargesOf() gives it, and so does what they cost
 * in all: the sum of their parts, to the cent, so that they add up to it, as their costs add up
 * to the total. Without it, neither gives one, as before.
 * @param {{description: ?string, total_price: ?number, projected: (number|undefined)}[]} lines
 * @param {object} [options]
 * @param {boolean} [options.projected] - Whether the figures give their projected parts
 * @returns {{total: number, projected: (number|undefined), charges: {charge: string,
 *   total: number, projected: (number|undefined)}[]}} Each charge with what its lines add up to,
 *   to the cent, the most expensive first, then by charge: those at 0 € left out, such as the
 *   free tier of the hot storage, and those that a refund brings below 0 € kept, as a product's
 *   charges are. What the charges cost in all: the sum of their costs, to the cent, so that they
 *   add up to it, the month's Logs Data Platform cost, as its resource type gives it.
 */
function chargeFigures(lines, { projected = false } = {}) {
  const charges = chargesOf(lines, { projected });
  return {
    total: sumOf(charges, ({ total }) => total),
    ...(projected ? { projected: sumOf(charges, (charge) => charge.projected) } : {}),
    charges,
  };
}

module.exports = { chargeFigures };
