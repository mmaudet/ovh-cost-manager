// The line charts of the Trends tab and the month in progress (#216): each series draws the
// segment to it dashed and its point hollow, whether the page projects it or not, and their
// tooltips give what it billed and, while the trends project it, its projected cost (#217).

/**
 * The two parts that draw each series of a line chart of the Trends tab: a solid line through
 * the complete months, and a dashed one through the month in progress and the months next to it,
 * as the values of the chart's rows for a line, null where the part does not go.
 * @param {{ yearMonth: string }[]} rows - The chart's months, in order
 * @param {?string} monthInProgress - The month in progress, YYYY-MM, when the chart covers it;
 *   null otherwise, when every month is solid
 * @returns {{ solid: function(string): function(object): ?number,
 *   dashed: function(string): function(object): ?number }} For the key of a series in the rows,
 *   the value of a row in each part
 */
export function lineParts(rows, monthInProgress) {
  const index = rows.findIndex(({ yearMonth }) => yearMonth === monthInProgress);
  // The month in progress and the months next to it, which the dashed part joins
  const dashedMonths = new Set(index < 0
    ? []
    : rows.slice(Math.max(index - 1, 0), index + 2).map(({ yearMonth }) => yearMonth));
  return {
    solid: (key) => (row) => (row.yearMonth === monthInProgress ? null : row[key]),
    dashed: (key) => (row) => (dashedMonths.has(row.yearMonth) ? row[key] : null),
  };
}

/**
 * The amount of a series in a month as the tooltips of the Trends tab's line charts give it: that
 * of a complete month; for the month in progress, what it billed so far, and while the trends
 * project it, its projected cost, which the chart draws then.
 * @param {number} amount - What the chart draws for the series in the month
 * @param {number} projectedPart - The part of it that projected lines make, 0 for none
 * @param {{ inProgress: boolean, projected: boolean }} month - Whether the month is the month in
 *   progress, and whether the trends project it
 * @param {function(number): string} fmt - The amount format of the page
 * @param {function(string): string} t
 * @returns {string} 1 042,00€, facturé 980,40€, facturé 980,40€, projeté 1 250,40€…
 */
export const trendAmount = (amount, projectedPart, { inProgress, projected }, fmt, t) => {
  if (!inProgress) return `${fmt(amount)}€`;
  const billed = `${t('billed')} ${fmt(amount - projectedPart)}€`;
  return projected ? `${billed}, ${t('projected')} ${fmt(amount)}€` : billed;
};
