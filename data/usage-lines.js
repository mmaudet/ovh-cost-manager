/**
 * The bill lines that a Public Cloud project's usage of a month makes, for an account whose cost
 * source is its Public Cloud usage (CONTEXT.md): its bills, which a third party issues, are given
 * neither by the API nor by the control panel. OVH's GET /cloud/project/{id}/usage/history/{id}
 * answers a project's usage of a month, the current one included, with the parts of
 * usage/current (data/cloud-usage.js) and its total, at public prices before tax and before any
 * discount or Public Cloud credit.
 *
 * The import stores these lines as those of a usage bill (usageBillOf()): one per account and
 * month, dated on the first day of the month after its usage, as OVH bills a Public Cloud
 * project's month, so that the month of use of its lines is that of a bill line, and the readers
 * of the bills read them alike, those of the bills and of the Public Cloud products included.
 * Each line is worded as the bill line of its charge, which the classification and the products
 * read (data/classify.js, data/public-cloud-products.js, data/public-cloud-lines.js,
 * data/ai-endpoints.js): an hourly flavor in a region, a monthly instance, the additional disks
 * of a type in a region, a bucket, a database plan… The parts of a charge add up on its line,
 * as a bill gives them: an hourly flavor's instances, a region's disks of a type.
 *
 * Every part of the answer counts, as in data/cloud-usage.js, so that the lines of a month add up
 * to the total that OVH gives it: what no part names counts on a line of its own. This module has
 * no side effect.
 */

const { shiftMonth } = require('./months');

// An amount of the answer: a number, or an order.Price, whose value is the number
const amountOf = (price) => (typeof price === 'number' ? price : Number(price?.value) || 0);

// A quantity of the answer, a cloud.usage quantity whose value is the number, or a number
const quantityOf = (quantity) => (
  typeof quantity === 'number' ? quantity : Number(quantity?.value) || 0
);

// An amount to the millionth of the currency, the precision of the answer: the parts of a line
// add up without the noise of floating-point sums
const toMillionths = (amount) => Math.round(amount * 1e6) / 1e6;

// A region as the bills write it, in lower case: gra9, sbg5
const regionOf = (region) => String(region ?? '').trim().toLowerCase();

// The region of a line after a separator, as the bills write it, or nothing without one
const inRegion = (region, separator = ' - ') => (
  regionOf(region) ? `${separator}${regionOf(region)}` : ''
);

// A flavor without the suffix of its billing, as the hourly instances beyond a savings plan
// name it: b3-8.over-quota is b3-8
const flavorOf = (reference) => String(reference ?? '').split('.')[0];

// A part's line: its description, quantity and cost
const line = (description, quantity, total) => ({ description, quantity, total });

// The lines of the instances of a flavor used by the hour in a region: one for the flavor and
// region, as "Consommation à l'heure pour les instances r3-16 gra11"
const hourlyInstanceLines = (items) => (items || []).map((item) => line(
  `Consommation à l'heure pour les instances ${flavorOf(item.reference)}`
    + inRegion(item.region, ' '),
  quantityOf(item.quantity), amountOf(item.totalPrice),
));

// The lines of the instances on a monthly plan: one per instance, as "Forfait mensuel pour une
// instance b2-30 (id <uuid>, region gra7) - 01 mois", or one for the flavor and region when the
// answer details none
const monthlyInstanceLines = (items) => (items || []).flatMap((item) => {
  const flavor = flavorOf(item.reference);
  const region = regionOf(item.region);
  const details = item.details || [];
  if (details.length === 0) {
    return [line(`Forfait mensuel pour une instance ${flavor} (region ${region}) - 01 mois`, 1,
      amountOf(item.totalPrice))];
  }
  return details.map((detail) => line(
    `Forfait mensuel pour une instance ${flavor} (id ${detail.instanceId || detail.resourceId}, `
      + `region ${region}) - 01 mois`,
    1, amountOf(detail.totalPrice),
  ));
});

// The lines of the options of instances, hourly or monthly, by option and region
const instanceOptionLines = (items, billing) => (items || []).map((item) => line(
  `${billing} de l'option ${item.reference ?? item.type ?? ''} des instances`
    + `${inRegion(item.region)}`,
  quantityOf(item.quantity), amountOf(item.totalPrice),
));

// The lines of the savings plans: one per plan, as "Savings plan (id : savings-plan-1xb3-8)
// pour 1 instance(s) b3-8 - Durée : 1M", without its term, which the answer does not give
const savingsPlanLines = (items) => (items || []).flatMap((item) => {
  const flavor = item.flavor ?? item.reference ?? '';
  const details = item.details || [];
  if (details.length === 0) {
    return [line(`Savings plan pour des instances ${flavor}`, 1, amountOf(item.totalPrice))];
  }
  return details.map((detail) => line(
    `Savings plan (id : ${detail.planName ?? detail.id}) pour ${detail.size ?? 1} instance(s) `
      + flavor,
    detail.size ?? 1, amountOf(detail.totalPrice),
  ));
});

// The lines of the storage of the buckets: one per bucket and region, as "Stockage Standard -
// Bucket assets sur la région gra", their bandwidth included; the archive's apart
const storageLines = (items) => (items || []).map((item) => line(
  `${item.type === 'pca' ? 'Stockage Public Cloud Archive' : 'Stockage Standard'} - Bucket `
    + `${item.bucketName ?? ''} sur la région ${regionOf(item.region)}`,
  quantityOf(item.stored?.quantity), amountOf(item.totalPrice),
));

// A line per item of a part, its description given by the item
const itemLines = (items, describe) => (items || []).map((item) => line(
  describe(item), quantityOf(item.quantity), amountOf(item.totalPrice),
));

// What a component of an AI Endpoints model counts, by the end of its name: its input or output
// tokens, which their bill lines name in their charge (data/ai-endpoints.js)
const TOKEN_COMPONENT = /^(.+)-(input|output)_tokens$/;

// The description of an AI Endpoints model's component: "Nombre de tokens d'entrée pour le
// modèle AI Endpoints gpt-oss-20b" for its input tokens, or else a line that names the model
function aiEndpointsDescription(name) {
  const tokens = String(name ?? '').match(TOKEN_COMPONENT);
  if (!tokens) return `Consommation du modèle AI Endpoints ${name}`;
  const [, model, counts] = tokens;
  return `Nombre de tokens ${counts === 'input' ? "d'entrée" : 'de sortie'} pour le modèle AI `
    + `Endpoints ${model}`;
}

// The description of a component of a typed resource (resourcesUsage), by its type, as the bills
// word its charge: what these words make of it is what the products read
const TYPED_DESCRIPTIONS = {
  'ai-endpoints': ({ name }) => aiEndpointsDescription(name),
  'volume-backup': ({ region }) => `Sauvegarde de disques${inRegion(region)}`,
  publicip: ({ region }) => `Public Cloud Public IP${inRegion(region)}`,
  floatingip: ({ region }) => `Public Cloud Floating IP${inRegion(region)}`,
  'octavia-loadbalancer': ({ name, region }) => `Octavia Loadbalancer ${name}${inRegion(region)}`,
  gateway: ({ name, region }) => `Public Cloud Gateway ${name}${inRegion(region)}`,
  databases: ({ name, region }) => `Public Cloud Databases ${name}${inRegion(region, ' à ')}`,
  registry: ({ name }) => `Managed Private Registry - ${name}`,
  harbor: ({ name }) => `Managed Private Registry - ${name}`,
  kubernetes: ({ name }) => `Managed Kubernetes Service - ${name}`,
  'ai-notebook': ({ name }) => `Public Cloud AI Notebooks ${name}`,
  'ai-training': ({ name }) => `Public Cloud AI Training ${name}`,
  'ai-deploy': ({ name }) => `Public Cloud AI Deploy ${name}`,
};

// The description of a component of a type that no wording names: the type, which the products
// may still read, the component and its region
const otherTypedDescription = (type, { name, region }) => `Public Cloud ${type}`
  + `${name && name !== type ? ` ${name}` : ''}${inRegion(region)}`;

// The lines of the typed resources: one per component, in the region of its resource, or the
// type's own when it details none
const typedLines = (typedResources) => (typedResources || []).flatMap((typed) => {
  const type = typed.type || 'other';
  const describe = TYPED_DESCRIPTIONS[type]
    ?? ((component) => otherTypedDescription(type, component));
  const components = (typed.resources || []).flatMap((resource) => (resource.components || [])
    .map((component) => ({ ...component, region: resource.region })));
  if (components.length === 0) {
    return [line(describe({ name: type, region: '' }), 0, amountOf(typed.totalPrice))];
  }
  return components.map((component) => line(
    describe(component), quantityOf(component.quantity), amountOf(component.totalPrice),
  ));
});

// The description of what no part of the answer names, as when OVH adds a kind of resource
const OTHER_USAGE = 'Autres consommations Public Cloud';

/**
 * The bill lines of a project's usage of a month, as usage/history/{id} answers it: one per
 * charge, its parts added up, the descriptions in order. Their costs add up to the total that
 * OVH gives the usage, to the cent: what the parts leave of it is a line of its own.
 * @param {object} usage - The answer, cloud.usage.UsageHistoryDetail
 * @returns {{description: string, quantity: number, unit_price: number,
 *   total_price: number}[]}
 */
function usageLines(usage) {
  const hourly = usage.hourlyUsage || {};
  const monthly = usage.monthlyUsage || {};
  const parts = [
    ...hourlyInstanceLines(hourly.instance),
    ...instanceOptionLines(hourly.instanceOption, "Consommation à l'heure"),
    ...itemLines(hourly.instanceBandwidth,
      (item) => `Trafic sortant des instances Public Cloud${inRegion(item.region)}`),
    ...itemLines(hourly.volume,
      (item) => `Disques supplémentaires à ${regionOf(item.region)} de type ${item.type}`),
    ...itemLines(hourly.snapshot, (item) => `Snapshots Public Cloud${inRegion(item.region)}`),
    ...storageLines(hourly.storage),
    ...itemLines(hourly.managedKubernetesService,
      (item) => `Managed Kubernetes Service - ${item.reference ?? item.type ?? item.flavor}`),
    ...itemLines(hourly.rancher,
      (item) => `Managed Rancher Service - ${item.reference ?? item.type ?? item.flavor}`),
    ...itemLines([...(hourly.quantum?.notebook || []), ...(hourly.quantum?.processingUnit || [])],
      (item) => `Public Cloud Quantum ${item.reference ?? item.type ?? item.flavor}`),
    ...monthlyInstanceLines(monthly.instance),
    ...instanceOptionLines(monthly.instanceOption, 'Forfait mensuel'),
    ...itemLines(monthly.certification,
      (item) => `Certification Public Cloud ${item.reference ?? item.type ?? ''}`),
    ...savingsPlanLines(monthly.savingsPlan),
    ...typedLines(usage.resourcesUsage),
  ];

  // The parts of each charge added up on its line
  const byDescription = new Map();
  for (const part of parts) {
    const charge = byDescription.get(part.description) ?? { quantity: 0, total: 0 };
    byDescription.set(part.description, {
      quantity: charge.quantity + part.quantity, total: charge.total + part.total,
    });
  }

  // What the total that OVH gives holds beyond the parts, from half a cent: OVH rounds a type's
  // total, which may then exceed its components' by a millionth, as an AI Endpoints model's do
  if (usage.totalPrice != null) {
    const counted = [...byDescription.values()].reduce((sum, { total }) => sum + total, 0);
    const rest = toMillionths(amountOf(usage.totalPrice) - counted);
    if (rest >= 0.005) byDescription.set(OTHER_USAGE, { quantity: 0, total: rest });
  }

  return [...byDescription]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([description, { quantity, total }]) => ({
      description,
      quantity: toMillionths(quantity),
      unit_price: quantity ? toMillionths(total / quantity) : 0,
      total_price: toMillionths(total),
    }));
}

/**
 * The month whose usage an answer gives, from the start of its period, whose date is read from
 * its digits, as the import reads that of the current usage (#54).
 * @param {object} usage - The answer, with its period
 * @returns {?string} YYYY-MM; null when it gives no period
 */
function usageMonth(usage) {
  return usage?.period?.from?.slice(0, 7) || null;
}

/**
 * The usage bill of an account's month (CONTEXT.md): the bill that the import stores the lines of
 * its projects' usage of the month on, which no OVH bill gives. It is dated on the first day of
 * the next month, as OVH bills a Public Cloud project's month: its lines' month of use is the
 * month of the usage.
 * @param {string} nic - The NIC handle of the account
 * @param {string} month - The month of the usage, YYYY-MM
 * @returns {{id: string, date: string}} Its id, which no OVH bill takes, and its date
 */
function usageBillOf(nic, month) {
  return { id: `usage-${nic}-${month}`, date: `${shiftMonth(month, 1)}-01` };
}

module.exports = { usageBillOf, usageLines, usageMonth };
