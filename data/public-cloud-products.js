/**
 * The product of a Public Cloud project's bill line: the card of the Public Cloud tab that
 * counts it, read from its description as OVH words it. Each line has one product, so that
 * the cards add up to the cloud total of a month (#145). The first rule that a line meets
 * gives its product: a savings plan names the flavor it pays for, and a bucket may be named
 * like a product. And the charge of the line, what it pays for within its product (#195). This
 * module has no side effect.
 */

const { readInstanceLine, readVolumeLine } = require('./public-cloud-lines');

// The products that have a card of their own, in the order the rules test them, and those
// that the other services card gathers
const RULES = [
  ['savingsPlans', (text) => /^savings plan/i.test(text)],
  ['instances', (text) => readInstanceLine(text) !== null],
  ['volumes', (text) => readVolumeLine(text) !== null],
  ['snapshots', (text) => /^snapshots public cloud/i.test(text)],
  ['volumeBackups', (text) => /^sauvegarde de disques/i.test(text)],
  // The buckets' storage and bandwidth, the Swift containers' and the archives'
  ['objectStorage', (text) => (/^stockage/i.test(text) && /\bbucket\b/i.test(text))
    || /^stockage d.objects?\b/i.test(text)
    || /^bande passante\b.*\bstockage\b/i.test(text)
    || /public cloud archive/i.test(text)
    || /^stockage cold archive/i.test(text)],
  ['registry', (text) => /registry|harbor/i.test(text)],
  ['kubernetes', (text) => /kube|k8s/i.test(text)],
  ['databases', (text) => /databases?\b/i.test(text)],
  ['loadBalancers', (text) => /load ?balancer|octavia/i.test(text)],
  ['floatingIps', (text) => /floating ip/i.test(text)],
  ['gateways', (text) => /gateway/i.test(text)],
  ['ai', (text) => /\bai (notebooks?|training|deploy|endpoints?)\b/i.test(text)],
  // The Public Cloud credit that a project's bill uses, a negative amount
  ['credits', (text) => /^utilisation du cr[eé]dit/i.test(text)],
];

// The products that have a card of their own, as the stats name them
const CARD_PRODUCTS = ['instances', 'kubernetes', 'objectStorage', 'volumes', 'snapshots',
  'savingsPlans', 'registry'];

/**
 * The product of a Public Cloud bill line.
 * @param {?string} description - The bill line's description
 * @returns {string} One of the card products, or a product of the other services:
 *   volumeBackups, databases, loadBalancers, floatingIps, gateways, ai or other; or credits,
 *   the Public Cloud credit that a bill used, which pays for no product
 */
function publicCloudProductOf(description) {
  const text = String(description ?? '').trim();
  return RULES.find(([, meets]) => meets(text))?.[0] ?? 'other';
}

// The period in brackets that ends a description on some accounts' bills, such as
// « (01/08/2026-31/08/2026) »: brackets at its end that hold a date. Those that end a prorata's
// description, which name its instance and region, hold none.
const PERIOD = /\s*\([^()]*\d{1,2}\/\d{1,2}\/\d{4}[^()]*\)$/;

/**
 * The charge of a Public Cloud bill line (see CONTEXT.md): what it pays for, as its description
 * names it without the period that ends it in brackets on some accounts' bills, so that the lines
 * of one charge name it alike whatever the month they cover. The other accounts' descriptions
 * carry none: each is its line's charge. Some bills write the apostrophe curly, « l’heure », as
 * others write it straight: the charge writes it straight, so that one charge reads alike on
 * every bill.
 * @param {?string} description - The bill line's description
 * @returns {string}
 */
function chargeOf(description) {
  return String(description ?? '').trim().replace(PERIOD, '').replace(/’/g, "'");
}

const toCents = (amount) => Math.round(amount * 100) / 100;

// A product's charges, from what its lines add up to by charge: each to the cent, those at 0 €
// left out, as the products at 0 € are, the most expensive first, then by charge
const chargeList = (totals) => [...totals]
  .map(([charge, total]) => ({ charge, total: toCents(total) }))
  .filter(({ total }) => total !== 0)
  .sort((a, b) => b.total - a.total || a.charge.localeCompare(b.charge));

/**
 * What Public Cloud bill lines add up to, by product.
 * @param {{description: ?string, domain: ?string, total_price: number}[]} lines
 * @param {string[]} [apart] - Products that the caller shows on their own, left out of `others`
 * @returns {{figuresOf: function(string): {total: number, services: number, descriptions: number,
 *   charges: {charge: string, total: number}[]}, others: {total: number, products: {product:
 *   string, total: number}[]}, credits: number}} Each product's cost, the number of services and
 *   of descriptions that bill it, and its charges, each with what its lines add up to (see
 *   chargeList()); the products that no card of their own counts, nor `apart`, that cost
 *   anything, the most expensive first, and their total; and the credit that the lines used
 */
function productFigures(lines, apart = CARD_PRODUCTS) {
  const byProduct = new Map();
  for (const line of lines) {
    const product = publicCloudProductOf(line.description);
    if (!byProduct.has(product)) {
      byProduct.set(product, {
        total: 0, services: new Set(), descriptions: new Set(), charges: new Map(),
      });
    }
    const figures = byProduct.get(product);
    figures.total += line.total_price || 0;
    figures.services.add(line.domain);
    figures.descriptions.add(line.description);
    const charge = chargeOf(line.description);
    figures.charges.set(charge, (figures.charges.get(charge) ?? 0) + (line.total_price || 0));
  }
  const figuresOf = (product) => ({
    total: toCents(byProduct.get(product)?.total || 0),
    services: byProduct.get(product)?.services.size || 0,
    descriptions: byProduct.get(product)?.descriptions.size || 0,
    charges: chargeList(byProduct.get(product)?.charges ?? []),
  });
  const products = [...byProduct.keys()]
    .filter((product) => !apart.includes(product) && product !== 'credits')
    .map((product) => ({ product, total: figuresOf(product).total }))
    .filter(({ total }) => total !== 0)
    .sort((a, b) => b.total - a.total || a.product.localeCompare(b.product));
  return {
    figuresOf,
    others: { total: toCents(products.reduce((sum, { total }) => sum + total, 0)), products },
    credits: figuresOf('credits').total,
  };
}

module.exports = { CARD_PRODUCTS, chargeOf, productFigures, publicCloudProductOf };
