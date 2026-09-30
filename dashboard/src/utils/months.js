// The months list of the page: the months billed to the account shown in the header, as
// /api/months lists them, the latest first (#115)

import { formatMonthLabel } from './format.js';

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

/**
 * Whether a month is the month in progress (#216), as the months list marks it. The list's mark
 * counts, not the month's own: the page keeps a month that it picked from an earlier list while
 * the lists loaded since hold it, and the list that the end of an import refreshes no longer
 * marks the month once the import stored the bill of each recurring service.
 * @param {{ value: string, inProgress?: boolean }[]} months - The months list
 * @param {?{ value: string }} month - A month, as a months list gives it; null or undefined
 *   before one is picked
 * @returns {boolean}
 */
export const isInProgress = (months, month) => months.some(
  ({ value, inProgress }) => inProgress === true && value === month?.value,
);

/**
 * The name of a month of the months list in the month selectors (#216): its long name and its
 * year in the language, as formatMonthLabel() writes them, which the month in progress follows
 * with « (en cours) », so that no one reads it as a complete month.
 * @param {{ value: string, inProgress?: boolean }} month - A month as the list gives it
 * @param {string} language - The page's, 'fr' or 'en'
 * @param {function(string): string} t
 * @returns {string} Septembre 2026 (en cours), September 2026 (in progress), Août 2026…
 */
export const monthLabel = (month, language, t) => {
  const name = formatMonthLabel(month.value, language);
  return month.inProgress ? `${name} (${t('monthInProgress')})` : name;
};
