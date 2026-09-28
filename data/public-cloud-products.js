/**
 * The product of a Public Cloud project's bill line: the card of the Public Cloud tab that
 * counts it, read from its description as OVH words it. Each line has one product, so that
 * the cards add up to the cloud total of a month (#145). The first rule that a line meets
 * gives its product: a savings plan names the flavor it pays for, and a bucket may be named
 * like a product. This module has no side effect.
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
  ['objectStorage', (text) => /\bbucket\b/i.test(text) && /^stockage/i.test(text)
    || /^stockage d.objects?\b/i.test(text)
    || /^bande passante\b.*\bstockage\b/i.test(text)
    || /public cloud archive/i.test(text)
    || /^stockage cold archive/i.test(text)],
  ['registry', (text) => /registry|harbor/i.test(text)],
  ['kubernetes', (text) => /kubernetes|kube|k8s/i.test(text)],
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
 *   volumeBackups, databases, loadBalancers, floatingIps, gateways, ai, credits, or other
 */
function publicCloudProductOf(description) {
  const text = String(description ?? '').trim();
  return RULES.find(([, meets]) => meets(text))?.[0] ?? 'other';
}

module.exports = { CARD_PRODUCTS, publicCloudProductOf };
