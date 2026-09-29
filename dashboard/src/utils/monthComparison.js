// The comparisons of months A and B of the Compare tab: how they pair what each month gave,
// such as the products of a Public Cloud project (#181) or the services of a resource type
// (#192), and the order that their rows keep until the user sorts them (#146).

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

export { BY_MONTH_A, BY_MONTH_B, pairMonths };
