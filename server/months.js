// The window that a trend route reads from its query. The months it counts with are those
// of data/months.js, which the data layer shares.
const { trendWindow } = require('../data/months');

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

module.exports = { trendWindowFromQuery };
