/**
 * The file of the carbon footprint that OVHcloud's carbon calculator generates for an account
 * (#147): the months that the import asks it for, and the lines that OCM reads from it. This
 * module has no side effect.
 */

const { shiftMonth } = require('./months');

// How many months the carbon calculator gives: the last 24, never the current month
const FOOTPRINT_MONTHS = 24;

// The columns of the file that OCM reads, by the field of a footprint line they fill, as
// OVHcloud named them in September 2026. OCM reads them by name and ignores the others.
const COLUMNS = {
  type: 'type',
  datacenter: 'datacenter',
  product_range: 'range',
  name: 'name',
  server_domain: 'server_domain',
  month: 'date',
  manufacturing: 'manufacturing_emissions_kg_co2eq',
  electricity_location: 'location_based_electricity_emissions_kg_co2eq',
  electricity_market: 'market_based_electricity_emissions_kg_co2eq',
  operations_location: 'location_based_operational_emissions_kg_co2eq',
  operations_market: 'market_based_operational_emissions_kg_co2eq',
};

// The fields of the emissions, in kg CO2eq: the manufacturing's, of which OVHcloud gives one
// figure, and the electricity's and the operations', each location-based and market-based
const EMISSIONS = [
  'manufacturing', 'electricity_location', 'electricity_market', 'operations_location',
  'operations_market',
];

// The descriptive fields that a line may leave empty: a dedicated server named by nothing but
// its range, before July 2026, or a Public Cloud line, which names no server
const OPTIONAL = ['datacenter', 'product_range', 'name', 'server_domain'];

/**
 * The months that the import asks the carbon calculator for: the 24 that end with the last
 * full month, the month before today's.
 * @param {Date} today
 * @returns {{first: string, last: string}} The first and the last, YYYY-MM
 */
function footprintMonths(today) {
  const last = shiftMonth(today.toISOString().slice(0, 7), -1);
  return { first: shiftMonth(last, 1 - FOOTPRINT_MONTHS), last };
}

// The rows of a CSV text, each the list of its fields. A field may be quoted, with "" for a
// quote, and hold commas and line breaks then. Lines may end with CRLF; blank lines hold no
// row.
function csvRows(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  const source = text.replace(/^﻿/, '');
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (quoted) {
      if (char === '"' && source[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && source[i + 1] === '\n') i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter(fields => fields.length > 1 || fields[0].trim() !== '');
}

/**
 * Reads the lines of a carbon footprint file.
 * @param {string} text - The file, as the link of the carbon calculator's task gives it
 * @returns {object[]} Each line: its month (YYYY-MM), type, datacenter, product_range, name
 *   and server_domain, as the file gives them, null when it leaves them empty, and its
 *   emissions in kg CO2eq (EMISSIONS)
 * @throws {Error} When the file lacks a column that OCM reads, or a line's month or emission
 *   is not one: OCM never guesses what the file holds
 */
function readFootprintFile(text) {
  const [header = [], ...rows] = csvRows(text);
  const names = header.map(name => name.trim());
  const missing = Object.values(COLUMNS).filter(column => !names.includes(column));
  if (missing.length > 0) {
    throw new Error(`The carbon footprint file has no column ${missing.join(', ')}`);
  }

  return rows.map((row, index) => {
    const lineNumber = index + 2;
    const line = {};
    for (const [field, column] of Object.entries(COLUMNS)) {
      line[field] = (row[names.indexOf(column)] ?? '').trim();
    }
    if (!/^\d{4}-\d{2}$/.test(line.month)) {
      throw new Error(`Line ${lineNumber} of the carbon footprint file has no month: ${line.month}`);
    }
    for (const field of EMISSIONS) {
      const value = Number(line[field]);
      if (line[field] === '' || !Number.isFinite(value)) {
        throw new Error(`Line ${lineNumber} of the carbon footprint file has no figure `
          + `in ${COLUMNS[field]}: ${line[field]}`);
      }
      line[field] = value;
    }
    for (const field of OPTIONAL) {
      if (line[field] === '') line[field] = null;
    }
    return line;
  });
}

module.exports = { footprintMonths, readFootprintFile };
