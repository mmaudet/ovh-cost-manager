// The chart of the service types of the Compare tab and the month in progress (#218): what it
// draws of a service type in month A or B, a bar and, stacked on it, lighter and dashed, what
// projected lines add to it, while the page projects the month in progress.

/**
 * The bars of a service type in a month of the Compare tab's chart, which reach its cost in the
 * month, its projected cost for the month in progress while the page projects it: a bar of what
 * the month billed, and stacked on it what projected lines add. Projected lines that take from
 * the type's cost, such as the Public Cloud credit that a project's lines of the month before used
 * (#219), leave nothing to stack: the bar is then the projected cost, below what the month billed,
 * as a part below 0 stacked on it would be drawn over its top, reading as billed what it takes.
 * @param {?{ value: number, projected: (number|undefined) }} serviceType - The type in the month,
 *   as /api/analysis/by-service gives it: its cost, and what projected lines make of it for the
 *   month in progress at its projected cost; none for a type that the month did not bill
 * @returns {{ bar: number, stacked: number, projected: number }} The heights of the bar and of
 *   what stacks on it, 0 for nothing, which add up to the type's cost; and what projected lines
 *   make of that cost, 0 for none, which the tooltip gives
 */
export const serviceTypeBars = (serviceType) => {
  const cost = serviceType?.value || 0;
  const projected = serviceType?.projected || 0;
  const stacked = Math.max(projected, 0);
  return { bar: cost - stacked, stacked, projected };
};
