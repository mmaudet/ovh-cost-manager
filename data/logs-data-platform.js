/**
 * The charges of the Logs Data Platform services (see CONTEXT.md), and what their bill lines add
 * up to by charge (#247), which the Infrastructure tab lists for the month it shows. OVHcloud
 * bills a Logs Data Platform service, `ldp-` and a code, under its « DBAAS-LOGS » heading, on a
 * line per charge: the rental of its account, « Logs - Account rental for 1 month », which covers
 * the month of its bill, and what it consumed in the month before, such as the hot storage of its
 * streams, « Logs - Streams - Hot Storage 1 to 100 GB ».
 *
 * data/db.js selects the lines of a period, which logsDataPlatformLineCondition() narrows down to
 * those of these services, and chargeFigures() adds them up, when the server reads the bills: no
 * re-import. This module has no side effect.
 */

const { chargeOf, toCents } = require('./charges');
const { LOGS_DATA_PLATFORM } = require('./classify');

/**
 * The condition that narrows a query's bill lines down to those of the Logs Data Platform
 * services, to join with AND to its WHERE clause, with its parameters, as the conditions of
 * data/sql-conditions.js: those of the resource type that the classification gives them, which
 * the lines that the imports before #246 stored as storage took when the database opened.
 * @param {string} column - The column of the query that holds the lines' resource types
 * @returns {{sql: string, params: string[]}}
 */
function logsDataPlatformLineCondition(column) {
  return { sql: `${column} = ?`, params: [LOGS_DATA_PLATFORM.resourceType] };
}

/**
 * What the bill lines of Logs Data Platform services add up to, by charge (chargeOf()): the lines
 * of one charge add up to one row, whatever their service, their account, or the period that
 * their description ends with on some accounts' bills.
 * @param {{description: ?string, total_price: ?number}[]} lines
 * @returns {{total: number, charges: {charge: string, total: number}[]}} Each charge that costs
 *   anything, more than 0 €, with what its lines add up to, to the cent, the most expensive
 *   first, then by charge; those that cost nothing, or less, left out, such as the free tier of
 *   the hot storage, as a product's charges are (data/public-cloud-products.js). What the charges
 *   cost in all: the sum of their costs, to the cent, so that they add up to it, as the models'
 *   do in modelFigures() (data/ai-endpoints.js).
 */
function chargeFigures(lines) {
  const byCharge = new Map();
  for (const line of lines) {
    const charge = chargeOf(line.description);
    byCharge.set(charge, (byCharge.get(charge) ?? 0) + (line.total_price || 0));
  }
  const charges = [...byCharge]
    .map(([charge, total]) => ({ charge, total: toCents(total) }))
    .filter(({ total }) => total > 0)
    .sort((a, b) => b.total - a.total || a.charge.localeCompare(b.charge));
  return { total: toCents(charges.reduce((sum, { total }) => sum + total, 0)), charges };
}

module.exports = { chargeFigures, logsDataPlatformLineCondition };
