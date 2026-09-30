// The month in progress (CONTEXT.md, #216): the month of today, while a recurring service has no
// bill line in it. OVHcloud bills some accounts early in the month and others late: until the
// bill of a service that comes every month arrives, the month's cost lacks it. Pure: data/db.js
// reads the services that the bills charged (getBilledServices()), which this module tells the
// recurring services not billed yet from, when the server reads the bills, so that changing the
// rule needs no re-import. The projection of the month in progress repeats those services' bill
// lines of the month before, their projected lines (#217).

const { monthsOfWindow, shiftMonth, trendWindow } = require('./months');

// The months before the month of today that must each have billed a service for it to be
// recurring: a yearly renewal, a one-off purchase or a service ordered since is not
const RECURRENCE_MONTHS = 3;

/**
 * The dates of the bills that tell which recurring services the month of today has not billed
 * yet: from the first day of the third month before it, the first that a recurring service was
 * billed in, to the last day of the month of today.
 * @param {string} monthOfToday - YYYY-MM
 * @returns {{ from: string, to: string }} YYYY-MM-DD each
 */
function recurrenceWindow(monthOfToday) {
  return trendWindow(monthOfToday, RECURRENCE_MONTHS + 1);
}

// What tells a service apart: its identifier and its account, as a bill line belongs to the
// account of its bill (ADR 0002). The Unknown account's is null.
const serviceKey = ({ service, account }) => JSON.stringify([service, account ?? null]);

/**
 * The recurring services (CONTEXT.md) that no bill line of the month of today names yet: each
 * service, by its identifier and its account, that bills of each of the three months before the
 * month of today charged, by the month of their bills, and whose identifier no account's bill of
 * the month of today charged. A service moved from an account to another, which bills it since,
 * lacks no bill (#214). Each with its projected lines (#217): its bill lines of the month before,
 * which the projection of the month in progress counts as they were, their classification
 * included, since they are those very lines.
 * @param {Array<{ service: string, account: ?string, month: string, lines: string[] }>} billed -
 *   The services that the bills of the recurrence window (recurrenceWindow()) charged: each once
 *   for each account and month of the bills that charged it, YYYY-MM, with the ids of the bill
 *   lines that name it there, those of the month of today of every account (getBilledServices()
 *   in data/db.js)
 * @param {string} monthOfToday - YYYY-MM
 * @returns {Array<{ service: string, account: ?string, lines: string[] }>} In the order that
 *   `billed` gives them, each with the ids of its bill lines of the month before
 */
function recurringServicesNotBilled(billed, monthOfToday) {
  const monthBefore = shiftMonth(monthOfToday, -1);
  const { from, to } = trendWindow(monthBefore, RECURRENCE_MONTHS);
  const monthsBefore = monthsOfWindow(from, to);
  // The identifiers of the services that the month of today billed, whatever the account
  const billedInIt = new Set(billed
    .filter(({ month }) => month === monthOfToday)
    .map(({ service }) => service));
  // Each service, the months that billed it, and its bill lines of the month before
  const services = new Map();
  for (const { service, account = null, month, lines } of billed) {
    const key = serviceKey({ service, account });
    if (!services.has(key)) services.set(key, { service, account, months: new Set(), lines: [] });
    const entry = services.get(key);
    entry.months.add(month);
    if (month === monthBefore) entry.lines = lines;
  }
  return [...services.values()]
    .filter(({ service, months }) => !billedInIt.has(service)
      && monthsBefore.every((month) => months.has(month)))
    .map(({ service, account, lines }) => ({ service, account, lines }));
}

module.exports = { recurrenceWindow, recurringServicesNotBilled };
