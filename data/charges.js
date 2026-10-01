/**
 * The charge of a bill line (see CONTEXT.md): what it pays for, as its description names it
 * without the period it covers. And what lines add up to by charge: those of a Public Cloud
 * product, which the Compare tab unfolds the product into (#195), and those of the Logs Data
 * Platform services, which the Infrastructure tab lists (#247). The AI Endpoints models are read
 * from the charges of their lines (#193). And the amounts that these figures add up, to the cent.
 * This module has no side effect.
 */

// The period in brackets that ends a description on some accounts' bills, such as
// « (01/08/2026-31/08/2026) »: brackets at its end that hold a date. Those that end a prorata's
// description, which name its instance and region, hold none.
const PERIOD = /\s*\([^()]*\d{1,2}\/\d{1,2}\/\d{4}[^()]*\)$/;

/**
 * The charge of a bill line (see CONTEXT.md): what it pays for, as its description names it
 * without the period that ends it in brackets on some accounts' bills, so that the lines of one
 * charge name it alike whatever the month they cover. The other accounts' descriptions carry
 * none: each is its line's charge. Some bills write the apostrophe curly, « l’heure », as others
 * write it straight: the charge writes it straight, so that one charge reads alike on every bill.
 * @param {?string} description - The bill line's description
 * @returns {string}
 */
function chargeOf(description) {
  return String(description ?? '').trim().replace(PERIOD, '').replace(/’/g, "'");
}

/**
 * An amount to the cent.
 * @param {number} amount
 * @returns {number}
 */
const toCents = (amount) => Math.round(amount * 100) / 100;

/**
 * What entries add up to, to the cent: their costs or their projected parts, such as those of
 * the products of a Public Cloud project's other services (data/public-cloud-products.js).
 * @param {object[]} entries
 * @param {function(object): number} amountOf - What an entry counts, such as its cost
 * @returns {number}
 */
const sumOf = (entries, amountOf) => toCents(
  entries.reduce((sum, entry) => sum + amountOf(entry), 0),
);

/**
 * The entries that cost anything, products or charges, each with its cost (total): those at
 * 0 € left out, those below 0 €, which a refund or a credit brings there, kept, the most
 * expensive first, then by name.
 * @param {{total: number}[]} entries
 * @param {function(object): string} nameOf - The name of an entry
 * @returns {object[]}
 */
const nonZeroByCost = (entries, nameOf) => entries
  .filter(({ total }) => total !== 0)
  .sort((a, b) => b.total - a.total || nameOf(a).localeCompare(nameOf(b)));

/**
 * What bill lines add up to by charge (chargeOf()): each charge with what its lines cost, to the
 * cent, those at 0 € left out, as nonZeroByCost() orders them.
 *
 * With the projected option, the lines are those that a query of the costs adds up with the
 * projected lines of the month in progress (linesOfPeriod() in data/db.js), each with its
 * projected part, `projected`: its whole cost for a projected line, 0 for a bill line (#219).
 * Each charge then gives its projected part too, what the projected parts of its lines add up
 * to, to the cent, 0 for none. Without it, the charges give none.
 * @param {{description: ?string, total_price: ?number, projected: (number|undefined)}[]} lines
 * @param {object} [options]
 * @param {boolean} [options.projected] - Whether the charges give their projected parts
 * @returns {{charge: string, total: number, projected: (number|undefined)}[]}
 */
function chargesOf(lines, { projected = false } = {}) {
  const byCharge = new Map();
  for (const line of lines) {
    const charge = chargeOf(line.description);
    const ofCharge = byCharge.get(charge) ?? { total: 0, projected: 0 };
    byCharge.set(charge, {
      total: ofCharge.total + (line.total_price || 0),
      projected: ofCharge.projected + (line.projected || 0),
    });
  }
  return nonZeroByCost(
    [...byCharge].map(([charge, amounts]) => ({
      charge,
      total: toCents(amounts.total),
      ...(projected ? { projected: toCents(amounts.projected) } : {}),
    })),
    ({ charge }) => charge,
  );
}

module.exports = { chargeOf, chargesOf, nonZeroByCost, sumOf, toCents };
