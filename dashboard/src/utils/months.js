// The months list of the page: the months billed to the account shown in the header, as
// /api/months lists them, the latest first (#115)

/**
 * Whether a months list holds a month. The queries of a month wait until the months of the
 * account shown hold it, so that none asks for a month that the account lacks (#120): those
 * of the month selected in the header, and those of the months that the Compare tab
 * compares (#119).
 * @param {{ value: string }[]} months - The months list, empty while it loads
 * @param {?{ value: string }} month - A month, as such a list gives it, which its value,
 *   'YYYY-MM', names in any list; null or undefined before one is picked
 * @returns {boolean}
 */
export const holdsMonth = (months, month) => months.some(({ value }) => value === month?.value);
