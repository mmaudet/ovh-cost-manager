import { useQuery } from '@tanstack/react-query';
import { formatMonthLabel } from '../utils/format.js';
import { publicCloudProductLabel } from '../utils/publicCloudProducts.js';
import { variationPercent } from '../utils/variation.js';
import { SortableHeader, sortRows } from './SortableHeader.jsx';
import { Variation } from './Variation.jsx';

// What the server answers for a month whose bills charged the project nothing
const NOTHING_BILLED = { total: 0, products: [], credits: 0 };

// The value of a product in each column that sorts the comparison (#146): its name as the table
// gives it, its cost in months A and B, and the variation from one to the other, none from 0 €
// or less
const productValues = (t) => ({
  product: (row) => publicCloudProductLabel(row.product, t),
  totalA: (row) => row.valA,
  totalB: (row) => row.valB,
  variation: (row) => variationPercent(row.valA, row.valB),
});

// The rows of the comparison, from the products of months A and B, each the most expensive
// first: those of month A, in its order, then those of month B only, in theirs, each with its
// cost in both months, 0 € in a month whose bills did not charge it
const productRows = (billedA, billedB) => {
  const costsA = new Map(billedA.products.map(({ product, total }) => [product, total]));
  const costsB = new Map(billedB.products.map(({ product, total }) => [product, total]));
  return [...new Set([...costsA.keys(), ...costsB.keys()])].map((product) => ({
    product, valA: costsA.get(product) ?? 0, valB: costsB.get(product) ?? 0,
  }));
};

/**
 * The comparison of a Public Cloud project's products in months A and B, from the bills of each
 * month (#181), for the account shown: every product that they charged the project, whose costs
 * add up, with the credit that the bills used, to the project's cost in the comparison by
 * project. The credit shows apart, after the products, as it pays for none. The products keep
 * the order of their months until the user sorts them (sorting, which the Compare tab's hook
 * holds for each project: see SortableHeader.jsx). It says that it loads until the answers of
 * both months arrive, and that it could not load when one failed.
 * @param {object} props
 * @param {function(?object): object} props.productsQueryOf - The options of the query of the
 *   project's products in a month, for useQuery (useCompareTab()'s projectProductsQuery())
 * @param {?object} props.monthA
 * @param {?object} props.monthB
 * @param {{ sort: ?object, onSort: function(object) }} props.sorting
 * @returns {JSX.Element}
 */
export default function ProjectProductComparison({
  productsQueryOf, monthA, monthB, sorting, fmt, language, t,
}) {
  const answerA = useQuery(productsQueryOf(monthA));
  const answerB = useQuery(productsQueryOf(monthB));
  // Until both months' answers arrive, rather than a month at 0 € or no product at all
  if (answerA.isLoading || answerB.isLoading) {
    return <div className="text-gray-500 text-sm">{t('loading')}</div>;
  }
  // A month whose answer failed, rather than a month at 0 € (#181)
  if (answerA.isError || answerB.isError) {
    return <div className="text-red-500 text-sm">{t('projectProductsFailed')}</div>;
  }
  const billedA = answerA.data ?? NOTHING_BILLED;
  const billedB = answerB.data ?? NOTHING_BILLED;
  const rows = productRows(billedA, billedB);
  // Whether the bills of either month used a credit
  const credited = billedA.credits !== 0 || billedB.credits !== 0;

  if (rows.length === 0 && !credited) {
    return <div className="text-gray-400 text-sm">{t('noProjectData')}</div>;
  }

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b text-left bg-gray-50">
          <SortableHeader
            column="product" kind="text" sorting={sorting} t={t}
            className="p-3 font-medium rounded-tl-lg"
          >
            {t('product')}
          </SortableHeader>
          <SortableHeader
            column="totalA" kind="number" sorting={sorting} t={t}
            className="p-3 font-medium text-right"
          >
            {formatMonthLabel(monthA?.value, language)}
          </SortableHeader>
          <SortableHeader
            column="totalB" kind="number" sorting={sorting} t={t}
            className="p-3 font-medium text-right"
          >
            {formatMonthLabel(monthB?.value, language)}
          </SortableHeader>
          <SortableHeader
            column="variation" kind="number" sorting={sorting} t={t}
            className="p-3 font-medium text-right rounded-tr-lg"
          >
            {t('variation')}
          </SortableHeader>
        </tr>
      </thead>
      <tbody>
        {sortRows(
          rows, sorting.sort, productValues(t), language,
        ).map(({ product, valA, valB }) => (
          <tr key={product} className="border-b hover:bg-gray-50 transition-colors">
            <td className="p-3 font-medium">{publicCloudProductLabel(product, t)}</td>
            <td className="p-3 text-right font-medium">{fmt(valA)}€</td>
            <td className="p-3 text-right text-gray-500">{fmt(valB)}€</td>
            <td className="p-3 text-right">
              <Variation from={valA} to={valB} language={language} t={t} />
            </td>
          </tr>
        ))}
      </tbody>
      {/* The credit that the bills used, which pays for no product: after them, whatever
          their order */}
      {credited && (
        <tfoot>
          <tr className="border-b text-gray-500">
            <td className="p-3">{t('cloudCreditUsed')}</td>
            <td className="p-3 text-right">{fmt(billedA.credits)}€</td>
            <td className="p-3 text-right">{fmt(billedB.credits)}€</td>
            {/* No variation of a credit to compute (#65) */}
            <td className="p-3" />
          </tr>
        </tfoot>
      )}
    </table>
  );
}
