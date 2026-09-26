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

module.exports = { monthBounds, trendWindow };
