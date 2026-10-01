/**
 * What the tests of the month in progress share (CONTEXT.md): the months list's mark (#216), the
 * projection of the trends (#217) and of the Compare tab (#218, #219), and the turn of the month,
 * when the month before is the candidate month until the month of today has a bill (#258). The
 * server tells the month of today from its local date, so the bills are dated from the real date,
 * the month of today and the four months before, as the Infrastructure tab's tests date the
 * services about to expire.
 */

const {
  LYON, PARIS, UNKNOWN_ACCOUNT, bill,
} = require('./accounts');
const { monthBounds, shiftMonth } = require('../../data/months');

// The month of today, YYYY-MM, and the day of today, YYYY-MM-DD, from the local date, as the
// server tells them
const today = new Date();
const MONTH_OF_TODAY = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
const DAY_OF_TODAY = `${MONTH_OF_TODAY}-${String(today.getDate()).padStart(2, '0')}`;
// The four months before it, the latest first: the three months before a month make its
// recurring services, and the fourth those of the month before (#258)
const [MONTH_BEFORE, TWO_MONTHS_BEFORE, THREE_MONTHS_BEFORE, FOUR_MONTHS_BEFORE] = [1, 2, 3, 4]
  .map((months) => shiftMonth(MONTH_OF_TODAY, -months));
// And the three months before it, the earliest first
const MONTHS_BEFORE = [THREE_MONTHS_BEFORE, TWO_MONTHS_BEFORE, MONTH_BEFORE];

// The month of today and the month before, as the Compare tab asks for them (#218, #219): their
// first and last days, and the period of a request of each, and of both
const MONTH_IN_PROGRESS = monthBounds(MONTH_OF_TODAY);
const COMPLETE_MONTH = monthBounds(MONTH_BEFORE);
const periodOf = ({ from, to }) => `from=${from}&to=${to}`;
const OF_TODAY = periodOf(MONTH_IN_PROGRESS);
const OF_MONTH_BEFORE = periodOf(COMPLETE_MONTH);
const OF_BOTH_MONTHS = periodOf({ from: COMPLETE_MONTH.from, to: MONTH_IN_PROGRESS.to });

// The accounts of the tests of the Compare tab's routes that seed several (#218, #219), each as
// what the name of a test says of it and the value of the account parameter: the Lyon
// subsidiary and the Unknown account, which their seeds bill late for a recurring service, and
// Paris, whose bills of the month of today came; and all accounts, which no parameter names
const LYON_BILLED_LATE = ['an account billed late', LYON];
const PARIS_BILLED = ['an account whose bills of the month of today came', PARIS];
const UNKNOWN_BILLED_LATE = ['the Unknown account, billed late', UNKNOWN_ACCOUNT];
const ALL_ACCOUNTS = ['all accounts', undefined];

/**
 * A bill of an account, dated on a day, and its lines: one for each service that it charges.
 * @param {object} db - The data layer (data/db.js)
 * @param {string} id - The bill's id, which starts the ids of its lines
 * @param {?string} account - The NIC handle of its account, null for the Unknown account
 * @param {string} date - YYYY-MM-DD
 * @param {Array<[string, string, number, object=]>} charges - Each service that it charges: its
 *   identifier, its resource type and the amount; a Public Cloud project's identifier is its id.
 *   And, when its line says more than its service, what it says: its `description`, the service
 *   and « 1 mois » by default, and its `serviceType`, Other by default (#218).
 */
function billOf(db, id, account, date, charges) {
  bill(db, id, date, account);
  db.details.insertMany(charges.map(([service, resourceType, price, line = {}], index) => ({
    id: `${id}-${index + 1}`, bill_id: id,
    project_id: resourceType === 'cloud_project' ? service : null,
    domain: service, description: line.description ?? `${service} - 1 mois`, quantity: 1,
    unit_price: price, total_price: price, service_type: line.serviceType ?? 'Other',
    resource_type: resourceType,
  })));
}

module.exports = {
  MONTH_OF_TODAY, DAY_OF_TODAY, MONTH_BEFORE, TWO_MONTHS_BEFORE, THREE_MONTHS_BEFORE,
  FOUR_MONTHS_BEFORE, MONTHS_BEFORE, MONTH_IN_PROGRESS, COMPLETE_MONTH, OF_TODAY, OF_MONTH_BEFORE,
  OF_BOTH_MONTHS, LYON_BILLED_LATE, PARIS_BILLED, UNKNOWN_BILLED_LATE, ALL_ACCOUNTS, billOf,
};
