/**
 * What the tests of the carbon footprint (#147) share: a footprint line as the import stores
 * it, a dedicated server of an invented account by default.
 */

/**
 * A footprint line of a month, as data/db.js's carbon.replaceMonths() stores it.
 * @param {object} line
 * @param {string} line.month - YYYY-MM
 * @param {number} line.manufacturing - Its manufacturing emissions, in kg CO2eq
 * @param {number[]} line.electricity - Its electricity emissions, location-based and
 *   market-based
 * @param {number[]} line.operations - Its operations emissions, location-based and
 *   market-based
 * @returns {object}
 */
function footprintLine({ month, manufacturing, electricity, operations, ...described }) {
  const [electricityLocation, electricityMarket] = electricity;
  const [operationsLocation, operationsMarket] = operations;
  return {
    month,
    type: 'BAREMETAL',
    datacenter: 'GRA',
    product_range: 'advance gen4',
    name: 'advance-2',
    server_domain: 'ns1234567.ip-10-0-0.eu',
    ...described,
    manufacturing,
    electricity_location: electricityLocation,
    electricity_market: electricityMarket,
    operations_location: operationsLocation,
    operations_market: operationsMarket,
  };
}

module.exports = { footprintLine };
