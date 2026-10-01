// The month in progress (CONTEXT.md, #216): the latest month with bills, while one of its recurring
// services has no bill line in it. OVHcloud bills some accounts early in the month and others late,
// and some bills of a month land once the next one has begun: until the bill of a service that
// comes every month arrives, the month's cost lacks it. The one month that can be in progress, the
// candidate month, is the month of today once the account shown has a bill in it, and the month
// before until then (chooseCandidateMonth(), #258). Pure: data/db.js reads the services that the
// bills charged (getBilledServices()), which this module tells the recurring services not billed
// yet from, when the server reads the bills, so that changing the rule needs no re-import. The
// projection of the month in progress repeats those services' bill lines of the month before,
// their projected lines (#217).

const { monthsOfWindow, shiftMonth, trendWindow } = require('./months');

// The months before the candidate month that must each have billed a service for it to be
// recurring: a yearly renewal, a one-off purchase or a service ordered since is not
const RECURRENCE_MONTHS = 3;

/**
 * The candidate month (#258), the one month that can be in progress: the month of today once the
 * account shown has a bill in it, and until then the month before, which may still lack its late
 * bills, as some bills of a month land once the next one has begun. One month only is ever in
 * progress, the latest month listed: once the month of today has a bill, it takes over, even
 * while the month before lacks a late bill.
 * @param {string} monthOfToday - YYYY-MM, as the server's local date gives it (monthOfDate() in
 *   data/months.js)
 * @param {boolean} billedInIt - Whether the account shown has a bill in the month of today: one
 *   of its bills for an account, one of the bills without an account for the Unknown account,
 *   any bill for every account
 * @returns {string} YYYY-MM
 */
function chooseCandidateMonth(monthOfToday, billedInIt) {
  return billedInIt ? monthOfToday : shiftMonth(monthOfToday, -1);
}

/**
 * The dates of the bills that tell which recurring services the candidate month has not billed
 * yet: from the first day of the third month before it, the first that a recurring service was
 * billed in, to the last day of the candidate month.
 * @param {string} candidateMonth - YYYY-MM (chooseCandidateMonth())
 * @returns {{ from: string, to: string }} YYYY-MM-DD each
 */
function recurrenceWindow(candidateMonth) {
  return trendWindow(candidateMonth, RECURRENCE_MONTHS + 1);
}

// What tells a service apart: its identifier and its account, as a bill line belongs to the
// account of its bill (ADR 0002). The Unknown account's is null.
const serviceKey = ({ service, account }) => JSON.stringify([service, account ?? null]);

/**
 * The recurring services (CONTEXT.md) that no bill line of the candidate month names yet: each
 * service, by its identifier and its account, that bills of each of the three months before the
 * candidate month charged, by the month of their bills, and whose identifier no account's bill of
 * the candidate month charged. A service moved from an account to another, which bills it since,
 * lacks no bill (#214). Each with its projected lines (#217): its bill lines of the month before
 * the candidate month, which the projection of the month in progress counts as they were, their
 * classification included, since they are those very lines.
 * @param {Array<{ service: string, account: ?string, month: string, lines: string[] }>} billed -
 *   The services that the bills of the recurrence window (recurrenceWindow()) charged: each once
 *   for each account and month of the bills that charged it, YYYY-MM, with the ids of the bill
 *   lines that name it there, those of the candidate month of every account (getBilledServices()
 *   in data/db.js)
 * @param {string} candidateMonth - YYYY-MM (chooseCandidateMonth())
 * @returns {Array<{ service: string, account: ?string, lines: string[] }>} In the order that
 *   `billed` gives them, each with the ids of its bill lines of the month before
 */
function recurringServicesNotBilled(billed, candidateMonth) {
  const monthBefore = shiftMonth(candidateMonth, -1);
  const { from, to } = trendWindow(monthBefore, RECURRENCE_MONTHS);
  const monthsBefore = monthsOfWindow(from, to);
  // The identifiers of the services that the candidate month billed, whatever the account
  const billedInIt = new Set(billed
    .filter(({ month }) => month === candidateMonth)
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

module.exports = { chooseCandidateMonth, recurrenceWindow, recurringServicesNotBilled };
