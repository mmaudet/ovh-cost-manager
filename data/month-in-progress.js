// The month in progress (CONTEXT.md, #216): the month of today, while a recurring service has no
// bill line in it. OVHcloud bills some accounts early in the month and others late: until the
// bill of a service that comes every month arrives, the month's cost lacks it. Pure: data/db.js
// selects the services that the bills charged, and this module reads the rule from them when the
// server reads the bills, so that changing it needs no re-import.

const { shiftMonth } = require('./months');

// The months before the month of today that must each have billed a service for it to be
// recurring: a yearly renewal, a one-off purchase or a service ordered since is not
const RECURRENCE_MONTHS = 3;

/**
 * The month of a date, YYYY-MM, in the server's local time: for the date of today, the month of
 * today, which the rule reads.
 * @param {Date} date
 * @returns {string}
 */
function monthOfDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * The months whose bills the rule reads for the month of today: the three months before it, and
 * itself.
 * @param {string} monthOfToday - YYYY-MM
 * @returns {string[]} YYYY-MM each, the earliest first
 */
function monthsRead(monthOfToday) {
  return Array.from({ length: RECURRENCE_MONTHS + 1 },
    (_, index) => shiftMonth(monthOfToday, index - RECURRENCE_MONTHS));
}

// What tells a service apart: its identifier and its account, as a bill line belongs to the
// account of its bill (ADR 0002). The Unknown account's is null.
const serviceKey = ({ service, account }) => JSON.stringify([service, account ?? null]);

/**
 * The recurring services of the month of today (CONTEXT.md): the services, by identifier and
 * account, that the bills of each of the three months before it charged, by the month of their
 * bills.
 * @param {Array<{ service: string, account: ?string, month: string }>} billed - The services
 *   that the bills of the months read (monthsRead()) charged: each service that a bill line
 *   names, with the NIC handle of its bill's account, null for the Unknown account, and the month
 *   of its bill, YYYY-MM, once or more
 * @param {string} monthOfToday - YYYY-MM
 * @returns {Array<{ service: string, account: ?string }>} In the order that `billed` gives them
 */
function recurringServices(billed, monthOfToday) {
  const monthsBefore = monthsRead(monthOfToday).slice(0, RECURRENCE_MONTHS);
  // Each service, and the months that billed it
  const services = new Map();
  for (const { service, account = null, month } of billed) {
    const key = serviceKey({ service, account });
    if (!services.has(key)) services.set(key, { service, account, months: new Set() });
    services.get(key).months.add(month);
  }
  return [...services.values()]
    .filter(({ months }) => monthsBefore.every((month) => months.has(month)))
    .map(({ service, account }) => ({ service, account }));
}

/**
 * Whether the month of today is in progress: whether a recurring service has no bill line in it,
 * of its own account. Among the services that `billed` gives: those of one account, or those of
 * every account, where any account's keeps the month in progress.
 * @param {Array<{ service: string, account: ?string, month: string }>} billed - See
 *   recurringServices()
 * @param {string} monthOfToday - YYYY-MM
 * @returns {boolean}
 */
function isInProgress(billed, monthOfToday) {
  const billedInIt = new Set(billed.filter(({ month }) => month === monthOfToday).map(serviceKey));
  return recurringServices(billed, monthOfToday)
    .some((service) => !billedInIt.has(serviceKey(service)));
}

module.exports = { monthOfDate, monthsRead, recurringServices, isInProgress };
