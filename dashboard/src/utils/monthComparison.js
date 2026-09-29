// The comparisons of months A and B of the Compare tab: how they pair what each month gave,
// such as the products of a Public Cloud project (#181) or the services of a resource type
// (#192), the order that their rows keep until the user sorts them (#146), and the values that
// sort them.

import { variationPercent } from './variation.js';

// The sort by month A, the most expensive first, as the comparisons order their rows until the
// user sorts them; by month B, for rows of the same cost in month A
const BY_MONTH_A = { column: 'totalA', kind: 'number', direction: 'desc' };
const BY_MONTH_B = { column: 'totalB', kind: 'number', direction: 'desc' };

/**
 * The rows of a comparison of months A and B, from what each month gave: one for each key that
 * either month gives, those of month A first, in their order, then those of month B only, in
 * theirs, each with what each month gave for it, and its amount in each month, 0 in a month
 * that gave nothing for it.
 * @param {object[]} rowsA - What month A gave, each key once, each with its amount (total)
 * @param {object[]} rowsB - What month B gave, the same way
 * @param {function(object): *} keyOf - What makes a row of month A and one of month B the same:
 *   a text or a number, which Map compares
 * @returns {{ key: *, rowA: (object|undefined), rowB: (object|undefined), valA: number,
 *   valB: number }[]}
 */
const pairMonths = (rowsA, rowsB, keyOf) => {
  const ofMonthA = new Map(rowsA.map((row) => [keyOf(row), row]));
  const ofMonthB = new Map(rowsB.map((row) => [keyOf(row), row]));
  return [...new Set([...ofMonthA.keys(), ...ofMonthB.keys()])].map((key) => {
    const rowA = ofMonthA.get(key);
    const rowB = ofMonthB.get(key);
    return { key, rowA, rowB, valA: rowA?.total ?? 0, valB: rowB?.total ?? 0 };
  });
};

/**
 * The value of a row of a comparison of months A and B in each column that sorts it (#146), as
 * sortRows() takes them: what names it, in the column that names the rows, its amount in months A
 * and B, and the variation from one to the other, none from 0 € or less. The rows that
 * pairMonths() pairs, such as a project's products, and those that unfolded rows show, their
 * services or charges, sort by the same columns.
 * @param {string} nameColumn - The name of the column that names the rows, such as 'product'
 * @param {function(object): *} nameOf - What names a row in that column
 * @returns {Object<string, function(object): *>} The value of a row, which has its amount in
 *   each month (valA, valB), by the column's name
 */
const comparisonValues = (nameColumn, nameOf) => ({
  [nameColumn]: nameOf,
  totalA: (row) => row.valA,
  totalB: (row) => row.valB,
  variation: (row) => variationPercent(row.valA, row.valB),
});

/**
 * What makes a row of month A and one of month B the same, for pairMonths(): what it names, a
 * project or a service, and its account. The rows that the lists ask for by account, while
 * they name the account of each row, give the NIC handle of theirs, null for the Unknown
 * account: a project or a service that two accounts billed has a row for each (#119, #194).
 * The others give none, which reads as null: they pair by what they name alone.
 * @param {function(object): *} nameOf - What a row names
 * @returns {function(object): string} The key of a row
 */
const byNameAndAccount = (nameOf) => (row) => JSON.stringify([nameOf(row), row.account ?? null]);

export { BY_MONTH_A, BY_MONTH_B, byNameAndAccount, comparisonValues, pairMonths };
