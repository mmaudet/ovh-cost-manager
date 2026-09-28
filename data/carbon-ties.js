/**
 * How the lines of a month's carbon footprint tie to the bill lines that pay for that month's
 * use (#155), account by account: the month of use of a bill line is the month before its
 * bill's for the lines of a Public Cloud project, the month of its bill for the others (see
 * CONTEXT.md). A footprint line then shows what its bill lines cost, and its carbon intensity.
 * This module has no side effect.
 */

const { readInstanceLine, readVolumeLine } = require('./public-cloud-lines');

// The type of the footprint lines of dedicated servers, as OVHcloud's file names it
const SERVER = 'BAREMETAL';

// The datacenters whose regions do not start with their name. A region's datacenter is
// otherwise its leading letters, in capitals: gra11 is in GRA, rbx-a in RBX.
const DATACENTER_OF_PREFIX = { de: 'LIM', uk: 'ERI' };

// A region named by its continent, its direction and its city, such as eu-west-par or
// ca-east-tor: its datacenter is its city, in capitals
const CONTINENT_DIRECTION_CITY = /^[a-z]{2}-[a-z]+-([a-z]+)/;

// The datacenter of a footprint line that names none: it ties by its name alone
const ANY_DATACENTER = 'ALL';

// An encrypted volume type, which the file counts as its base type: high-speed-gen2-luks is a
// high-speed-gen2 volume
const ENCRYPTED = /-luks$/;

/**
 * The datacenter of a region, as OVHcloud's file names it.
 * @param {?string} region - As a bill line or the inventory names it: gra11, rbx-a, GRA7…
 * @returns {?string} GRA, RBX…, null without a region
 */
function datacenterOf(region) {
  const name = String(region ?? '').toLowerCase();
  const city = name.match(CONTINENT_DIRECTION_CITY)?.[1];
  if (city) return city.toUpperCase();
  const prefix = name.match(/^[a-z]+/)?.[0];
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
    const volume = readVolumeLine(billLine.description);
    if (volume) {
      return {
        type: 'PCI-BLOCK-STORAGE',
        name: volume.type.toLowerCase().replace(ENCRYPTED, ''),
        datacenter: datacenterOf(volume.region),
      };
    }
    return null;
  }
  if (billLine.resource_type === 'dedicated_server') {
    return { type: SERVER, serverDomain: billLine.domain };
  }
  return null;
}

// A footprint line of a dedicated server that the file does not name, as it gives them
// before July 2026: it ties to the month's dedicated servers as a group
const isUnnamedServer = (line) => line.type === SERVER && !line.server_domain;

// What a footprint line and a bill line that pays for it both name: a type and, in lower
// case, a name
const nameKey = (type, name) => `${type} ${String(name ?? '').toLowerCase()}`;

const round = (value, decimals) => Math.round(value * 10 ** decimals) / 10 ** decimals;

// What a bill line costs in the covered cost and in the cost that it is a share of: nothing
// for a credit or a discount, a line of a negative price, as a credit pays for no service in
// particular
const beforeCredits = (billLine) => Math.max(billLine.total_price, 0);

// A row of the list: a footprint, what its bill lines cost, null when none ties to it, and its
// carbon intensity, in kg CO2eq per unit of the currency
function rowOf(fields, footprint, cost) {
  return {
    ...fields,
    footprint: round(footprint, 2),
    cost: cost === null ? null : round(cost, 2),
    intensity: cost ? round(footprint / cost, 4) : null,
  };
}

/**
 * Ties a month's footprint lines to the bill lines of its month of use, account by account. A
 * bill line ties to the footprint line of its name in its datacenter, or else to the one of
 * its name that names no datacenter (ALL), or else, when it names no region, to the only one
 * of its name. A bill line in a datacenter that the month's file never names, such as a 3AZ
 * region's, is in a region that OVHcloud does not cover: it ties to nothing, not even to ALL.
 * Nor does an instance line without a region whose flavor the file gives in several
 * datacenters: nothing tells which one it is.
 * @param {object[]} footprintLines - The month's lines, as the carbon_footprint_lines table
 *   holds them, each with its location-based `footprint`
 * @param {object[]} billLines - The bill lines of the month of use, of the accounts that the
 *   footprint lines are of and of any other: those of a Public Cloud project on the next
 *   month's bills, the others on the month's, with the account of their bill and their
 *   total_price
 * @param {Map<string, string>} instanceRegions - The region of each instance of the inventory
 * @returns {{lines: object[], coveredCost: number, coveredShare: ?number}} A row per footprint
 *   line, its type, name, range, datacenter and serverDomain, and one row per account for the
 *   dedicated servers that the file does not name, with their number in unnamedServers; each
 *   with its account, footprint, cost and intensity, the largest footprint first. And the
 *   covered cost (see CONTEXT.md, #157): what the bill lines that tie to them cost before
 *   their credits and discounts, which the cost of each row counts, to the hundredth; and the
 *   covered share, of what all the bill lines cost before theirs, to the ten-thousandth, null
 *   without a footprint line or when the bill lines cost nothing.
 */
function tieFootprint(footprintLines, billLines, instanceRegions) {
  const rows = [];
  let coveredCost = 0;
  for (const account of new Set(footprintLines.map(line => line.account))) {
    const lines = footprintLines.filter(line => line.account === account);
    const named = lines.filter(line => !isUnnamedServer(line));
    const unnamed = lines.filter(isUnnamedServer);
    // The datacenters that the month's file names: the regions that OVHcloud covers
    const covered = new Set(lines.map(line => line.datacenter)
      .filter(datacenter => datacenter && datacenter !== ANY_DATACENTER));
    const costs = new Map();
    let unnamedCost = null;
    // The named lines by what they name, looked up for each bill line: a dedicated server by
    // its domain, the first line that names it, and the others by their type and name
    const byServer = new Map();
    for (const line of named) {
      if (line.type === SERVER && !byServer.has(line.server_domain)) {
        byServer.set(line.server_domain, line);
      }
    }
    const byName = Map.groupBy(named, line => nameKey(line.type, line.name));

    // The footprint line that a bill line pays for, if any
    const tiedTo = (paid) => {
      if (paid.type === SERVER) return byServer.get(paid.serverDomain);
      const sameName = byName.get(nameKey(paid.type, paid.name)) ?? [];
      if (paid.datacenter === null) return sameName.length === 1 ? sameName[0] : undefined;
      if (!covered.has(paid.datacenter)) return undefined;
      return sameName.find(line => line.datacenter === paid.datacenter)
        ?? sameName.find(line => line.datacenter === ANY_DATACENTER);
    };

    for (const billLine of billLines.filter(line => line.account === account)) {
      const paid = paidFor(billLine, instanceRegions);
      if (!paid) continue;
      const line = tiedTo(paid);
      if (line) {
        costs.set(line, (costs.get(line) ?? 0) + billLine.total_price);
      } else if (paid.type === SERVER && unnamed.length > 0) {
        unnamedCost = (unnamedCost ?? 0) + billLine.total_price;
      } else {
        continue;
      }
      coveredCost += beforeCredits(billLine);
    }

    for (const line of named) {
      rows.push(rowOf({
        type: line.type, name: line.name, range: line.product_range,
        datacenter: line.datacenter, serverDomain: line.server_domain, unnamedServers: null,
        account,
      }, line.footprint, costs.get(line) ?? null));
    }
    if (unnamed.length > 0) {
      rows.push(rowOf({
        type: SERVER, name: null, range: null, datacenter: null, serverDomain: null,
        unnamedServers: unnamed.length, account,
      }, unnamed.reduce((sum, line) => sum + line.footprint, 0), unnamedCost));
    }
  }
  const cost = billLines.reduce((sum, billLine) => sum + beforeCredits(billLine), 0);
  return {
    lines: rows.sort((a, b) => b.footprint - a.footprint),
    coveredCost: round(coveredCost, 2),
    coveredShare: rows.length > 0 && cost > 0 ? round(coveredCost / cost, 4) : null,
  };
}

module.exports = { tieFootprint };
