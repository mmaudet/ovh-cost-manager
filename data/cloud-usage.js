/**
 * The current consumption of a Public Cloud project, as OVH's
 * GET /cloud/project/{id}/usage/current answers it (cloud.usage.UsageCurrent), in the rows
 * that the import stores in project_consumption: one per resource and cloud resource kind.
 * And its month-end forecast, the total that usage/forecast answers
 * (cloud.usage.UsageForecast), which the import stores in project_forecasts (#224).
 *
 * Every part of the answer counts, so that the rows of a project add up to the total that
 * OVH gives it (#145): the hourly and monthly resources, and the typed resources of the
 * newer products, such as the container registry. What no part names, as when OVH adds a
 * kind of resource, counts as `other`. Without side effects.
 *
 * Checked on 29 September 2026 against a real answer, for a project with eleven products: its
 * rows added up to OVH's total, with nothing left for `other` and nothing counted twice.
 */

// An amount of the answer: a number, or an order.Price, whose value is the number
const amountOf = (price) => (typeof price === 'number' ? price : Number(price?.value) || 0);

// A row of the kind, from what the answer tells of its resource
const rowOf = (kind, { id, name, quantity, totalPrice, region }) => ({
  resource_type: kind,
  resource_id: id || '',
  resource_name: name || '',
  quantity: quantity?.value || 0,
  unit: quantity?.unit || '',
  total_price: amountOf(totalPrice),
  region: region || '',
});

// The parts whose items detail their resources, by kind: where the answer gives them, and
// the resource that a detail names. The name of an item is its flavor, plan or volume type.
const DETAILED_PARTS = [
  ['instance', (u) => u.hourlyUsage?.instance, (d) => d.instanceId || d.resourceId],
  ['instance_option', (u) => u.hourlyUsage?.instanceOption, (d) => d.instanceId],
  ['volume', (u) => u.hourlyUsage?.volume, (d) => d.volumeId || d.resourceId],
  ['kubernetes', (u) => u.hourlyUsage?.managedKubernetesService, (d) => d.id || d.resourceId],
  ['rancher', (u) => u.hourlyUsage?.rancher, (d) => d.rancherId || d.resourceId],
  ['quantum', (u) => [
    ...(u.hourlyUsage?.quantum?.notebook || []),
    ...(u.hourlyUsage?.quantum?.processingUnit || []),
  ], (d) => d.id || d.resourceId],
  ['instance_monthly', (u) => u.monthlyUsage?.instance, (d) => d.instanceId || d.resourceId],
  ['instance_option_monthly', (u) => u.monthlyUsage?.instanceOption, (d) => d.instanceId],
  ['certification_monthly', (u) => u.monthlyUsage?.certification, () => ''],
  ['savings_plan', (u) => u.monthlyUsage?.savingsPlan, (d) => d.id],
];

// The parts whose items are their own resource, by kind, and the name of that resource, its
// id too
const WHOLE_PARTS = [
  ['instance_bandwidth', (u) => u.hourlyUsage?.instanceBandwidth, () => ''],
  ['snapshot', (u) => u.hourlyUsage?.snapshot, () => ''],
  ['storage', (u) => u.hourlyUsage?.storage, (item) => item.bucketName],
];

// The kinds that OVH gives for the whole month rather than as they are used, which a
// month-end forecast counts once
const MONTHLY_KINDS = [
  'instance_monthly', 'instance_option_monthly', 'certification_monthly', 'savings_plan',
];

// The rows of the items of a detailed part: one per detail, or the item's own when it
// details nothing
function detailedRows(kind, items, idOf) {
  return (items || []).flatMap((item) => {
    const name = item.reference ?? item.type ?? item.flavor;
    const details = item.details || [];
    if (details.length === 0) return [rowOf(kind, { ...item, name })];
    return details.map((detail) => rowOf(kind, {
      id: idOf(detail), name, quantity: detail.quantity, totalPrice: detail.totalPrice,
      region: item.region,
    }));
  });
}

// The rows of the typed resources: one per component, of the resource's type, in the region
// of its resource
function typedRows(typedResources) {
  return (typedResources || []).flatMap(({ type, totalPrice, resources }) => {
    const components = (resources || []).flatMap((resource) => (resource.components || [])
      .map((component) => ({ ...component, region: resource.region })));
    if (components.length === 0) return [rowOf(type || 'other', { totalPrice })];
    return components.map((component) => rowOf(type || 'other', {
      id: component.id || component.resourceId, name: component.name,
      quantity: component.quantity, totalPrice: component.totalPrice, region: component.region,
    }));
  });
}

/**
 * The rows of a project's current consumption, from what usage/current answers.
 * @param {object} usage - The answer, cloud.usage.UsageCurrent
 * @returns {{resource_type: string, resource_id: string, resource_name: string,
 *   quantity: number, unit: string, total_price: number, region: string}[]}
 */
function usageRows(usage) {
  const rows = [
    ...DETAILED_PARTS.flatMap(([kind, itemsOf, idOf]) => detailedRows(kind, itemsOf(usage), idOf)),
    ...WHOLE_PARTS.flatMap(([kind, itemsOf, nameOf]) => (itemsOf(usage) || [])
      .map((item) => rowOf(kind, { ...item, id: nameOf(item), name: nameOf(item) }))),
    ...typedRows(usage.resourcesUsage),
  ];
  // What the total that OVH gives holds beyond the parts, to the cent
  const rest = -beyondTotal(usage, rows);
  if (rest > 0) rows.push(rowOf('other', { totalPrice: rest }));
  return rows;
}

/**
 * What the rows of a project's usage count beyond the total that OVH gives it, to the cent:
 * 0 when they count no more, or when OVH gives no total. More would mean that two parts of
 * the answer count the same resource, which no answer has shown so far.
 * @param {object} usage - The answer, cloud.usage.UsageCurrent
 * @param {{total_price: number}[]} rows - Its rows, as usageRows() gives them
 * @returns {number} Negative when the total holds more than the rows
 */
function beyondTotal(usage, rows) {
  if (usage.totalPrice == null) return 0;
  const counted = rows.reduce((sum, row) => sum + row.total_price, 0);
  return Math.round((counted - amountOf(usage.totalPrice)) * 100) / 100;
}

/**
 * What OVH forecasts a project to cost in the month, from what
 * GET /cloud/project/{id}/usage/forecast answers (cloud.usage.UsageForecast, #224): its
 * totalPrice, an order.Price. The answer has the parts of the current usage, run to the end of
 * the month; OVH's Public Cloud page estimates the next bill from them, the month's use with
 * the renewal of the monthly plans.
 * @param {?object} forecast - The answer, cloud.usage.UsageForecast
 * @returns {?number} The amount, null when the answer gives none
 */
function forecastTotal(forecast) {
  return forecast?.totalPrice == null ? null : amountOf(forecast.totalPrice);
}

module.exports = { MONTHLY_KINDS, beyondTotal, forecastTotal, usageRows };
