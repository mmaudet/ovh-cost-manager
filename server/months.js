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

module.exports = { monthBounds };
