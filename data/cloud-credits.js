/**
 * The credits of the Public Cloud projects, as OVH's GET /cloud/project/{id}/credit/{id} answers
 * each (cloud.Credit), and the credit that remains of them: what the credits still available
 * and still valid hold, which the Public Cloud consumes before it is billed. The import stores
 * every credit as OVH gives it (readCredit()); the server tells those that count when it reads
 * them (remainingCredit()), so that a credit that expires counts no more from that day on,
 * without a new import. Without side effects.
 */

const { toCents } = require('./charges');

// An amount of the answer: an order.Price, whose value is the number, or a number
const amountOf = (price) => (typeof price === 'number' ? price : Number(price?.value) || 0);

/**
 * A credit of a project, as the import stores it, from what OVH answers of it.
 * @param {object} answer - The answer, cloud.Credit: its id, description, total_credit,
 *   available_credit and validity
 * @returns {{credit_id: string, description: ?string, available: number, total: ?number,
 *   currency: ?string, valid_from: ?string, valid_to: ?string}}
 */
function readCredit(answer) {
  return {
    credit_id: String(answer.id),
    description: answer.description ?? null,
    available: amountOf(answer.available_credit),
    total: answer.total_credit == null ? null : amountOf(answer.total_credit),
    currency: answer.available_credit?.currencyCode ?? answer.total_credit?.currencyCode ?? null,
    valid_from: answer.validity?.from ?? null,
    valid_to: answer.validity?.to ?? null,
  };
}

// The time of a validity's end, as OVH gives it with its UTC offset; none without one, as for a
// date that cannot be read, which ends nothing
const endOf = (validTo) => {
  const time = validTo ? Date.parse(validTo) : NaN;
  return Number.isNaN(time) ? null : time;
};

/**
 * Whether a credit counts in the credit remaining: what it still holds is positive, and its
 * validity has not ended.
 * @param {{available: number, valid_to: ?string}} credit
 * @param {Date} now
 * @returns {boolean}
 */
function countsNow(credit, now) {
  const end = endOf(credit.valid_to);
  return credit.available > 0 && (end === null || end > now.getTime());
}

/**
 * The credit that remains on the Public Cloud: what the credits that count now add up to
 * (countsNow()), to the cent, how many they are and of how many projects, and when the first of
 * them ends.
 * @param {{project_id: string, available: number, currency: ?string, valid_to: ?string}[]}
 *   credits - The credits of the projects, as the import stored them
 * @param {Date} now
 * @returns {{available_total: number, currency: ?string, credit_count: number,
 *   project_count: number, expires_at: ?string}} expires_at: the end of the validity that ends
 *   first, as OVH gives it, null when none of them ends
 */
function remainingCredit(credits, now) {
  const counted = credits.filter((credit) => countsNow(credit, now));
  const ending = counted.filter(({ valid_to: validTo }) => endOf(validTo) !== null)
    .sort((a, b) => endOf(a.valid_to) - endOf(b.valid_to));
  return {
    available_total: toCents(counted.reduce((sum, { available }) => sum + available, 0)),
    currency: counted.find(({ currency }) => currency)?.currency ?? null,
    credit_count: counted.length,
    project_count: new Set(counted.map(({ project_id: projectId }) => projectId)).size,
    expires_at: ending[0]?.valid_to ?? null,
  };
}

module.exports = { countsNow, readCredit, remainingCredit };
