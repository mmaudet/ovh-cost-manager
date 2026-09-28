/**
 * The instance lines of a Public Cloud project's bills, as OVH words them:
 *
 * - a monthly plan names its flavor, its instance and its region: "Forfait mensuel pour une
 *   instance b2-30 (id <uuid>, region gra7) - 01 mois";
 * - so does its prorata, for the month the plan starts, most often with its region:
 *   "Prorata de la facturation mensuelle d'une instance s1-8 (id <uuid>, region gra5)";
 * - the hourly instances of a flavor are billed on one line, most often per region:
 *   "Consommation à l'heure pour les instances r3-16 gra11".
 *
 * The per-instance costs read them with readInstanceLine(), and so will the ties of the
 * carbon footprint (#147). This module has no side effect.
 */

// The start of a monthly plan's line and of its prorata's
const MONTHLY = /^(?:Forfait mensuel pour une instance|Prorata de la facturation mensuelle d.une instance)/i;

// The start of an hourly line
const HOURLY = /^Consommation à l.heure pour les instances/i;

// A region as OVH names it (gra11, rbx-a, eu-west-par): a prorata may carry the placeholder
// "#REGION#" instead, which names none
const REGION = /^[a-z0-9-]+$/i;

/**
 * Reads an instance bill line.
 * @param {?string} description - The bill line's description
 * @returns {?{flavor: ?string, region: ?string, monthly: boolean, instanceId: ?string}} The
 *   flavor that the line names and its region, as the line words them, or null when it names
 *   none; whether it is a monthly plan or its prorata; and the id of the instance it names, a
 *   monthly plan's or its prorata's. Null for any other line, a savings plan's included.
 */
function readInstanceLine(description) {
  const text = description || '';

  const monthly = text.match(MONTHLY);
  if (monthly) {
    const region = text.match(/,\s*region ([^)\s]+)\)/i)?.[1];
    return {
      flavor: text.slice(monthly[0].length).match(/^\s*([^\s(]+)/)?.[1] ?? null,
      region: region && REGION.test(region) ? region : null,
      monthly: true,
      instanceId: text.match(/\(id ([0-9a-f-]{36})/i)?.[1] ?? null,
    };
  }

  const hourly = text.match(HOURLY);
  if (hourly) {
    // "<flavor> <region>", or the flavor alone: a flavor's words, if it has several, are
    // those before the region
    const words = text.slice(hourly[0].length).trim().split(/\s+/).filter(Boolean);
    return {
      flavor: words.length > 1 ? words.slice(0, -1).join('-') : (words[0] ?? null),
      region: words.length > 1 ? words[words.length - 1] : null,
      monthly: false,
      instanceId: null,
    };
  }

  return null;
}

module.exports = { readInstanceLine };
