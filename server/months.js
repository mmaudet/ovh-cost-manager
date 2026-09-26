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
    to: `${yearMonth}-${String(lastDay).padStart(2, '0')}`
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
  const [year, month] = endMonth.split('-').map(Number);
  // Date.UTC carries a month before January over to the years before
  const first = new Date(Date.UTC(year, month - months, 1));
  const firstMonth = String(first.getUTCMonth() + 1).padStart(2, '0');
  return {
    from: `${first.getUTCFullYear()}-${firstMonth}-01`,
    to: monthBounds(endMonth).to
  };
}

const MONTH_REGEX = /^\d{4}-\d{2}$/;
const MONTHS_REGEX = /^\d+$/;
// The longest trend: the longest period that the Trends tab offers, 20 years
const MAX_TREND_MONTHS = 240;

/**
 * The window that a request to a trend route asks for: `months` months, from 1
 * to 240, 6 by default, that end on the `end` month (YYYY-MM). Without an end
 * month, the month of the latest bill, so that no trend depends on the real
 * date; with no bill either, no window, from and to null, which no bill falls
 * in. Any other number of months, or an end month that is not one, is
 * refused, as the dates of the other routes are.
 * @param {{months?: string, end?: string}} query - The query parameters
 * @param {string} [latestBilledMonth] - The month of the latest bill, YYYY-MM
 * @returns {{valid: boolean, error?: string, from?: ?string, to?: ?string}}
 */
function trendWindowFromQuery(query, latestBilledMonth) {
  const months = query.months || '6';
  const count = Number(months);
  if (!MONTHS_REGEX.test(months) || count < 1 || count > MAX_TREND_MONTHS) {
    return {
      valid: false,
      error: `Invalid 'months' value: ${months}. `
        + `Expected an integer from 1 to ${MAX_TREND_MONTHS}`,
    };
  }

  const end = query.end || latestBilledMonth;

  if (!end) {
    return { valid: true, from: null, to: null };
  }
  if (!MONTH_REGEX.test(end)) {
    return { valid: false, error: `Invalid 'end' month format: ${end}. Expected YYYY-MM` };
  }
  if (isNaN(new Date(end).getTime())) {
    return { valid: false, error: `Invalid 'end' month: ${end}` };
  }

  return { valid: true, ...trendWindow(end, count) };
}

module.exports = { monthBounds, trendWindow, trendWindowFromQuery };
