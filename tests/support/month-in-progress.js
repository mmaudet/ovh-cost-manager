/**
 * What the tests of the month in progress share (CONTEXT.md): the months list's mark (#216), the
 * projection of the trends (#217) and of the Compare tab (#218, #219), and the turn of the month,
 * when the month before is the candidate month until the month of today has a bill (#258), with
 * the seed of its accounts. The server tells the month of today from its local date, so the bills
 * are dated from the real date, the month of today and the four months before, as the
 * Infrastructure tab's tests date the services about to expire.
 */

const {
  LYON, PARIS, UNKNOWN_ACCOUNT, bill, project,
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
// And the four, the earliest first, which the seeds of the turn of the month bill (#258): the
// month before, and the three months before it, whose bills make its recurring services
const FOUR_MONTHS_UP_TO_MONTH_BEFORE = [FOUR_MONTHS_BEFORE, ...MONTHS_BEFORE];

// The month of today and the month before, as the Compare tab asks for them (#218, #219): their
// first and last days, and the period of a request of each, and of both. Either can be the month
// in progress (#258).
const PERIOD_OF_TODAY = monthBounds(MONTH_OF_TODAY);
const PERIOD_OF_MONTH_BEFORE = monthBounds(MONTH_BEFORE);
const periodOf = ({ from, to }) => `from=${from}&to=${to}`;
const OF_TODAY = periodOf(PERIOD_OF_TODAY);
const OF_MONTH_BEFORE = periodOf(PERIOD_OF_MONTH_BEFORE);
const OF_BOTH_MONTHS = periodOf({ from: PERIOD_OF_MONTH_BEFORE.from, to: PERIOD_OF_TODAY.to });

// A VPS, which the seeds of the month in progress bill early in the month, on its second day
const VPS = 'vps-0a1b2c3d.vps.ovh.net';

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

/**
 * Seeds several accounts at the turn of the month (#258), whose months of today begin apart, each
 * with its own first bill: the Lyon subsidiary and the Unknown account, each billed on the first
 * day of each month and late in the month for its dedicated server, whose bills of the month of
 * today have not come, and whose month before still lacks the bill of its server; and Paris, whose
 * bill of the month of today came, and charged each of its services. The months before the month
 * of today are the four up to the month before. Every NIC handle, identifier and amount is made up.
 * @param {object} db - The data layer (data/db.js)
 */
function seedAccountsAtTurnOfMonth(db) {
  db.accounts.upsert({ nic: LYON, currency: 'EUR', name: 'Lyon subsidiary' });
  db.accounts.upsert({ nic: PARIS, currency: 'EUR' });
  project(db, 'project-lyon', 'Lyon', LYON);
  project(db, 'project-paris', 'Paris', PARIS);
  [...FOUR_MONTHS_UP_TO_MONTH_BEFORE, MONTH_OF_TODAY].forEach((yearMonth, index) => {
    billOf(db, `FR2${index}01`, PARIS, `${yearMonth}-01`, [
      ['project-paris', 'cloud_project', 400],
    ]);
    if (yearMonth === MONTH_OF_TODAY) return;
    billOf(db, `FR1${index}01`, LYON, `${yearMonth}-01`, [['project-lyon', 'cloud_project', 600]]);
    billOf(db, `FR0${index}01`, null, `${yearMonth}-01`, [['example.com', 'domain', 15]]);
    if (yearMonth === MONTH_BEFORE) return;
    billOf(db, `FR1${index}02`, LYON, `${yearMonth}-25`, [
      ['ns3000001.ip-203-0-113.eu', 'dedicated_server', 200],
    ]);
    billOf(db, `FR0${index}02`, null, `${yearMonth}-25`, [
      ['ns3000004.ip-203-0-113.eu', 'dedicated_server', 80],
    ]);
  });
}

module.exports = {
  MONTH_OF_TODAY, DAY_OF_TODAY, MONTH_BEFORE, TWO_MONTHS_BEFORE, THREE_MONTHS_BEFORE,
  FOUR_MONTHS_BEFORE, MONTHS_BEFORE, FOUR_MONTHS_UP_TO_MONTH_BEFORE, PERIOD_OF_TODAY,
  PERIOD_OF_MONTH_BEFORE, OF_TODAY, OF_MONTH_BEFORE, OF_BOTH_MONTHS, VPS, LYON_BILLED_LATE,
  PARIS_BILLED, UNKNOWN_BILLED_LATE, ALL_ACCOUNTS, billOf, seedAccountsAtTurnOfMonth,
};
