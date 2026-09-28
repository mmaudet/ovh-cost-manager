/**
 * How the lines of a month's carbon footprint tie to the bill lines that pay for that month's
 * use (#155), account by account: the month of use of a bill line is the month before its
 * bill's for the lines of a Public Cloud project, the month of its bill for the others (see
 * CONTEXT.md). A footprint line then shows what its bill lines cost, and its intensity, the
 * footprint that each euro of it carries. This module has no side effect.
 */

const { readInstanceLine } = require('./instance-lines');

// The datacenters whose regions do not start with their name. A region's datacenter is
// otherwise its leading letters, in capitals: gra11 is in GRA, rbx-a in RBX.
const DATACENTER_OF_PREFIX = { de: 'LIM', uk: 'ERI' };

// The datacenter of a footprint line that names none: it ties by its name alone
const ANY_DATACENTER = 'ALL';

// An additional disk's line, a volume of a Public Cloud project: its region and its type
const VOLUME = /^Disques supplémentaires à (\S+) de type (\S+)/i;

/**
 * The datacenter of a region, as OVHcloud's file names it.
 * @param {?string} region - As a bill line or the inventory names it: gra11, rbx-a, GRA7…
 * @returns {?string} GRA, RBX…, null without a region
 */
function datacenterOf(region) {
  const prefix = String(region ?? '').toLowerCase().match(/^[a-z]+/)?.[0];
  if (!prefix) return null;
  return DATACENTER_OF_PREFIX[prefix] ?? prefix.toUpperCase();
}

/**
 * What a bill line pays for, as a footprint line names it: a Public Cloud instance flavor,
 * with `.monthly` for a monthly plan or its prorata, or a volume type, each in its datacenter,
 * or a dedicated server. A prorata that names no region takes its instance's, when the
 * inventory knows the instance.
 * @param {object} billLine - Its description, domain, project_id and resource_type
 * @param {Map<string, string>} instanceRegions - The region of each instance of the inventory
 * @returns {?{type: string, name: (string|undefined), datacenter: (?string|undefined),
 *   serverDomain: (string|undefined)}} Null for any other line, a savings plan's included
 */
function paidFor(billLine, instanceRegions) {
  if (billLine.project_id) {
    const instance = readInstanceLine(billLine.description);
    if (instance?.flavor) {
      const region = instance.region ?? instanceRegions.get(instance.instanceId) ?? null;
      return {
        type: 'PCI-COMPUTE',
        name: `${instance.flavor}${instance.monthly ? '.monthly' : ''}`.toLowerCase(),
        datacenter: datacenterOf(region),
      };
    }
    const volume = String(billLine.description ?? '').match(VOLUME);
    if (volume) {
      return {
        type: 'PCI-BLOCK-STORAGE', name: volume[2].toLowerCase(), datacenter: datacenterOf(volume[1]),
      };
    }
    return null;
  }
  if (billLine.resource_type === 'dedicated_server') {
    return { type: 'BAREMETAL', serverDomain: billLine.domain };
  }
  return null;
}

// A footprint line of a dedicated server that the file does not name, as it gives them
// before July 2026: it ties to the month's dedicated servers as a group
const isUnnamedServer = (line) => line.type === 'BAREMETAL' && !line.server_domain;

// A footprint line's location-based footprint, in kg CO2eq
const footprintOf = (line) => line.manufacturing + line.electricity_location
  + line.operations_location;

const round = (value, decimals) => Math.round(value * 10 ** decimals) / 10 ** decimals;

// A row of the list: a footprint, what its bill lines cost, null when none ties to it, and its
// intensity, in kg CO2eq per unit of the currency
function rowOf(fields, footprint, cost) {
  return {
    ...fields,
    footprint: round(footprint, 2),
    cost: cost === null ? null : round(cost, 2),
    intensity: cost ? round(footprint / cost, 4) : null,
  };
}

/**
 * Ties a month's footprint lines to the bill lines of its month of use, account by account.
 * @param {object[]} footprintLines - The month's lines, as the carbon_footprint_lines table
 *   holds them
 * @param {object[]} billLines - The bill lines of the month of use: those of a Public Cloud
 *   project on the next month's bills, the others on the month's, with the account of their
 *   bill and their total_price
 * @param {Map<string, string>} instanceRegions - The region of each instance of the inventory
 * @returns {object[]} A row per footprint line, its type, name, range, datacenter and
 *   serverDomain, and one row per account for the dedicated servers that the file does not
 *   name, with their number in unnamedServers; each with its account, footprint, cost and
 *   intensity, the largest footprint first
 */
function tieFootprint(footprintLines, billLines, instanceRegions) {
  const rows = [];
  for (const account of new Set(footprintLines.map(line => line.account))) {
    const lines = footprintLines.filter(line => line.account === account);
    const named = lines.filter(line => !isUnnamedServer(line));
    const unnamed = lines.filter(isUnnamedServer);
    const costs = new Map();
    let unnamedCost = null;

    // The footprint line that a bill line pays for: the one of its datacenter, or else the one
    // that names none, or else, for a line that names no region, the only one of its name
    const tiedTo = (paid) => {
      if (paid.type === 'BAREMETAL') {
        return named.find(line => line.type === 'BAREMETAL'
          && line.server_domain === paid.serverDomain);
      }
      const sameName = named.filter(line => line.type === paid.type
        && String(line.name ?? '').toLowerCase() === paid.name);
      return sameName.find(line => line.datacenter === paid.datacenter)
        ?? sameName.find(line => line.datacenter === ANY_DATACENTER)
        ?? (paid.datacenter === null && sameName.length === 1 ? sameName[0] : undefined);
    };

    for (const billLine of billLines.filter(line => line.account === account)) {
      const paid = paidFor(billLine, instanceRegions);
      if (!paid) continue;
      const line = tiedTo(paid);
      if (line) {
        costs.set(line, (costs.get(line) ?? 0) + billLine.total_price);
      } else if (paid.type === 'BAREMETAL' && unnamed.length > 0) {
        unnamedCost = (unnamedCost ?? 0) + billLine.total_price;
      }
    }

    for (const line of named) {
      rows.push(rowOf({
        type: line.type, name: line.name, range: line.product_range,
        datacenter: line.datacenter, serverDomain: line.server_domain, unnamedServers: null,
        account,
      }, footprintOf(line), costs.get(line) ?? null));
    }
    if (unnamed.length > 0) {
      rows.push(rowOf({
        type: 'BAREMETAL', name: null, range: null, datacenter: null, serverDomain: null,
        unnamedServers: unnamed.length, account,
      }, unnamed.reduce((sum, line) => sum + footprintOf(line), 0), unnamedCost));
    }
  }
  return rows.sort((a, b) => b.footprint - a.footprint);
}

module.exports = { datacenterOf, tieFootprint };
