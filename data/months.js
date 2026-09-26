/**
 * The calendar months of a window of dates, from the month of its first day to
 * the month of its last day, both included, as YYYY-MM: the months that a
 * trend over that window lists, each one, billed or not (#65). 2026-07-01 to
 * 2026-09-30 covers 2026-07, 2026-08 and 2026-09. No window, from and to
 * null, covers no months.
 *
 * Counted on the digits of the dates rather than with Date, so that no
 * timezone can shift a month.
 * @param {?string} from - The first day, YYYY-MM-DD
 * @param {?string} to - The last day, YYYY-MM-DD
 * @returns {string[]}
 */
function monthsOfWindow(from, to) {
  if (!from || !to) return [];
  const [firstYear, firstMonth] = from.split('-').map(Number);
  const [lastYear, lastMonth] = to.split('-').map(Number);
  const months = [];
  // Each month as the number of months since year 0, for the months after
  // December to fall in the next year
  for (let index = firstYear * 12 + firstMonth - 1; index <= lastYear * 12 + lastMonth - 1;
    index += 1) {
    const month = String((index % 12) + 1).padStart(2, '0');
    months.push(`${Math.floor(index / 12)}-${month}`);
  }
  return months;
}

module.exports = { monthsOfWindow };
