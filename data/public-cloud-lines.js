/**
 * The instance and volume lines of a Public Cloud project's bills, as OVH words them:
 *
 * - a monthly plan names its flavor, its instance and its region: "Forfait mensuel pour une
 *   instance b2-30 (id <uuid>, region gra7) - 01 mois";
 * - so does its prorata, for the month the plan starts, most often with its region:
 *   "Prorata de la facturation mensuelle d'une instance s1-8 (id <uuid>, region gra5)";
 * - the hourly instances of a flavor are billed on one line, most often per region:
 *   "Consommation à l'heure pour les instances r3-16 gra11".
 *
 * - the additional disks of a type are billed on one line per region: "Disques
 *   supplémentaires à gra9 de type high-speed".
 *
 * The per-instance costs pick the instance lines with instanceLineCondition() and read them
 * with readInstanceLine(), the per-volume costs read the volume lines with readVolumeLine(),
 * and so do the ties of the carbon footprint (#155). This module has no side effect.
 */

// How the description of each kind of instance line starts, with `_` for the apostrophe,
// which OVH may write straight or curly: `_` is any one character in a LIKE pattern, and in
// the regular expressions below. A monthly plan's line and its prorata's, then an hourly
// line.
const MONTHLY_STARTS = [
  'Forfait mensuel pour une instance',
  'Prorata de la facturation mensuelle d_une instance',
];
const HOURLY_STARTS = ['Consommation à l_heure pour les instances'];

// The regular expression of the descriptions that start one of these ways
const startingWith = (starts) => new RegExp(`^(?:${starts
  .map(start => start.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/_/g, '.'))
  .join('|')})`, 'i');

const MONTHLY = startingWith(MONTHLY_STARTS);
const HOURLY = startingWith(HOURLY_STARTS);

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

/**
 * The condition that keeps the instance lines of a query's bill lines, to join with AND to
 * its WHERE clause, with its parameters, as the conditions of data/sql-conditions.js.
 * @param {string} column - The column of the query that holds the lines' descriptions
 * @returns {{sql: string, params: string[]}}
 */
function instanceLineCondition(column) {
  const starts = [...MONTHLY_STARTS, ...HOURLY_STARTS];
  return {
    sql: `(${starts.map(() => `${column} LIKE ?`).join(' OR ')})`,
    params: starts.map(start => `${start}%`),
  };
}

// An additional disks' line: its region, and the type of its volumes
const VOLUME = /^Disques supplémentaires à\s+(\S+)\s+de type\s+(.+)$/i;

/**
 * Reads a volume bill line, of the additional disks of a type in a region.
 * @param {?string} description - The bill line's description
 * @returns {?{region: string, type: string}} As the line words them, null for any other line
 */
function readVolumeLine(description) {
  const volume = String(description ?? '').match(VOLUME);
  return volume ? { region: volume[1], type: volume[2].trim() } : null;
}

module.exports = { instanceLineCondition, readInstanceLine, readVolumeLine };
