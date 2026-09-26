// The months of the bills: the first and last day of a month, and the months that a trend
// covers. trendWindow() and monthsOfWindow() count months the same way: on the digits of
// the dates, as a number of months since year 0, rather than with Date, so that no
// timezone can shift a month.

// A YYYY-MM month, or the month of a YYYY-MM-DD date, as a number of months since year 0:
// the month after December falls in the next year
function monthIndex(yearMonth) {
  const [year, month] = yearMonth.split('-').map(Number);
  return year * 12 + month - 1;
}

// The YYYY-MM month of a number of months since year 0
function monthAt(index) {
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
}

/**
 * First and last day of a 'YYYY-MM' month, as the YYYY-MM-DD dates the API
 * filters bills on.
 * @param {string} yearMonth - e.g. '2026-02'
 * @returns {{from: string, to: string}}
 */
function monthBounds(yearMonth) {
  const [year, month] = yearMonth.split('-').map(Number);
  // Day 0 of the next month is the last day of this one. Read in UTC: a local
  // midnight turned into an ISO string falls on the day before east of UTC.
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return {
    from: `${yearMonth}-01`,
    to: `${yearMonth}-${String(lastDay).padStart(2, '0')}`,
  };
}

/**
 * First and last day of the calendar months that a trend over `months` months
 * ending on a 'YYYY-MM' month covers, that month included: 3 months that end
 * on September run from July to September.
 * @param {string} endMonth - e.g. '2026-09'
 * @param {number} months - e.g. 3
 * @returns {{from: string, to: string}}
 */
function trendWindow(endMonth, months) {
  return {
    from: `${monthAt(monthIndex(endMonth) - months + 1)}-01`,
    to: monthBounds(endMonth).to,
  };
}

/**
 * The calendar months of a window of dates, from the month of its first day to
 * the month of its last day, both included, as YYYY-MM: the months that a
 * trend with a bill over that window gives, billed or not (#65). 2026-07-01 to
 * 2026-09-30 covers 2026-07, 2026-08 and 2026-09. No window, from and to
 * null, covers no months.
 * @param {?string} from - The first day, YYYY-MM-DD
 * @param {?string} to - The last day, YYYY-MM-DD
 * @returns {string[]}
 */
function monthsOfWindow(from, to) {
  if (!from || !to) return [];
  const months = [];
  for (let index = monthIndex(from); index <= monthIndex(to); index += 1) {
    months.push(monthAt(index));
  }
  return months;
}

module.exports = { monthBounds, trendWindow, monthsOfWindow };
