/**
 * What the tests of the month in progress share (CONTEXT.md): the months list's mark (#216) and
 * the projection of the trends (#217). The server tells the month of today from its local date,
 * so the bills are dated from the real date, the month of today and the three months before, as
 * the Infrastructure tab's tests date the services about to expire.
 */

const { bill } = require('./accounts');
const { shiftMonth } = require('../../data/months');

// The month of today, YYYY-MM, and the day of today, YYYY-MM-DD, from the local date, as the
// server tells them
const today = new Date();
const MONTH_OF_TODAY = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
const DAY_OF_TODAY = `${MONTH_OF_TODAY}-${String(today.getDate()).padStart(2, '0')}`;
// The three months before it, the latest first
const [MONTH_BEFORE, TWO_MONTHS_BEFORE, THREE_MONTHS_BEFORE] = [1, 2, 3]
  .map((months) => shiftMonth(MONTH_OF_TODAY, -months));
// And the earliest first
const MONTHS_BEFORE = [THREE_MONTHS_BEFORE, TWO_MONTHS_BEFORE, MONTH_BEFORE];

/**
 * A bill of an account, dated on a day, and its lines: one for each service that it charges.
 * @param {object} db - The data layer (data/db.js)
 * @param {string} id - The bill's id, which starts the ids of its lines
 * @param {?string} account - The NIC handle of its account, null for the Unknown account
 * @param {string} date - YYYY-MM-DD
 * @param {Array<[string, string, number]>} charges - Each service that it charges: its
 *   identifier, its resource type and the amount; a Public Cloud project's identifier is its id
 */
function billOf(db, id, account, date, charges) {
  bill(db, id, date, account);
  db.details.insertMany(charges.map(([service, resourceType, price], index) => ({
    id: `${id}-${index + 1}`, bill_id: id,
    project_id: resourceType === 'cloud_project' ? service : null,
    domain: service, description: `${service} - 1 mois`, quantity: 1, unit_price: price,
    total_price: price, service_type: 'Other', resource_type: resourceType,
  })));
}

module.exports = {
  MONTH_OF_TODAY, DAY_OF_TODAY, MONTH_BEFORE, TWO_MONTHS_BEFORE, THREE_MONTHS_BEFORE,
  MONTHS_BEFORE, billOf,
};
