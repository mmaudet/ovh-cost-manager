import { formatMonthLabel } from '../utils/format.js';
import {
  amountsOf, comparisonValues, pairMonths, valuesAsShown,
} from '../utils/monthComparison.js';
import { publicCloudProductLabel } from '../utils/publicCloudProducts.js';
import { MonthAnswersMessage, useMonthAnswers } from './MonthAnswers.jsx';
import { ComparedAmount } from './ProjectedAmount.jsx';
import { SortableHeader, sortRows } from './SortableHeader.jsx';
import { DetailRow, LABEL_PADDING, UnfoldingRow, sortUnfolded } from './UnfoldingRow.jsx';
import { Variation } from './Variation.jsx';

// What the server answers for a month whose bills charged the project nothing
const NOTHING_BILLED = { total: 0, products: [], credits: 0 };

/**
 * The Public Cloud credit that the bills of a month used, which pays for no product, as the
 * comparison reads the amounts of its rows (amountsOf()): what it adds up to, and what projected
 * lines make of it, 0 for none, for the month in progress at its projected cost (#219).
 * @param {{ credits: number, projectedCredits: (number|undefined) }} answer - What the server
 *   answers for the month's products
 * @returns {{ total: number, projected: number }}
 */
const creditOf = ({ credits, projectedCredits }) => amountsOf({
  total: credits, projected: projectedCredits,
});

// The value of a product in each column that sorts the comparison (#146): its name as the table
// gives it, its cost in months A and B, and the variation from one to the other
const productValues = (t) => comparisonValues(
  'product', (row) => publicCloudProductLabel(row.product, t),
);

// The value of a charge in the same columns, which sort the charges of each product as they sort
// the products (#195): the charge itself, its cost in months A and B, and the variation
const CHARGE_VALUES = comparisonValues('product', (row) => row.charge);

// The rows of the comparison, from what the server answers for the products of months A and B,
// each the most expensive first: those of month A, in its order, then those of month B only, in
// theirs, each with its cost and its charges in both months, 0 € and none in a month whose bills
// did not charge it, and what projected lines make of each cost, as pairMonths() gives it (#219)
const productRows = (answerA, answerB) => pairMonths(
  answerA.products, answerB.products, ({ product }) => product,
).map(({
  key, rowA, rowB, valA, valB, projectedA, projectedB,
}) => ({
  product: key, chargesA: rowA?.charges ?? [], chargesB: rowB?.charges ?? [], valA, valB,
  projectedA, projectedB,
}));

/**
 * The charges of a product in months A and B, right under its unfolded row in the comparison of
 * a project's products (#195), one row each, indented, in the comparison's columns: each charge
 * that the bills of either month charged the project, paired by charge, its cost in each month,
 * 0 € in a month whose bills did not charge it, and the variation. They follow the comparison's
 * sort, within their row, and come by month A, the most expensive first, then by month B, until
 * the user sorts it (sortUnfolded()). A charge's cost that projected lines make, that of the
 * month in progress while the page projects it, is marked so, as a charge that the month has not
 * billed yet (#219).
 * @param {object} props
 * @param {{ charge: string, total: number, projected: (number|undefined) }[]} props.chargesA -
 *   The product's charges in month A, as the server gives them, the most expensive first, with
 *   their projected parts for the month in progress at its projected cost
 * @param {{ charge: string, total: number, projected: (number|undefined) }[]} props.chargesB -
 *   Those of month B
 * @param {?object} props.sort - The sort of the comparison, by its columns (see
 *   SortableHeader.jsx): null until the user sorts it
 * @param {{ includesMonthInProgress: boolean, projected: boolean }} props.comparedMonths - What
 *   the comparison knows of months A and B (comparedMonthsOf()), which the variations of the
 *   charges and their sort read (#216)
 * @returns {JSX.Element[]} A row for each charge
 */
const ProductCharges = ({
  chargesA, chargesB, sort, comparedMonths, fmt, language, t,
}) => sortUnfolded(
  pairMonths(chargesA, chargesB, ({ charge }) => charge)
    .map(({
      key, valA, valB, projectedA, projectedB,
    }) => ({
      charge: key, valA, valB, projectedA, projectedB,
    })),
  sort, valuesAsShown(comparedMonths, CHARGE_VALUES), language,
).map(({
  charge, valA, valB, projectedA, projectedB,
}) => (
  <DetailRow
    key={charge} valA={valA} valB={valB} projectedA={projectedA} projectedB={projectedB}
    comparedMonths={comparedMonths} fmt={fmt} language={language} t={t}
  >
    {/* A long charge, such as an instance's monthly plan, which names the instance, wraps to the
        column of the products */}
    <div className="text-xs break-words">{charge}</div>
  </DetailRow>
));

/**
 * The comparison of a Public Cloud project's products in months A and B, from the bills of each
 * month (#181), for the account shown: every product that they charged the project, whose costs
 * add up, with the credit that the bills used, to the project's cost in the comparison by
 * project. The credit shows apart, after the products, as it pays for none. The products keep
 * the order of their months until the user sorts them (sorting, which the Compare tab's hook
 * holds for each project: see SortableHeader.jsx). Each product unfolds into its charges (#195),
 * which come with the products: unfolding one asks for nothing. The credit does not unfold. It
 * says that it loads until the answers of both months arrive, and that it could not load when
 * one failed. The month in progress at its projected cost, while the page projects it, marks
 * the costs of its products, charges and credit that projected lines make (#219).
 * @param {object} props
 * @param {function(?object): object} props.productsQueryOf - The options of the query of the
 *   project's products in a month, for useQuery (useCompareTab()'s projectProductsQuery())
 * @param {?object} props.monthA
 * @param {?object} props.monthB
 * @param {{ includesMonthInProgress: boolean, projected: boolean }} props.comparedMonths - What
 *   the comparison knows of months A and B (comparedMonthsOf()), which the variations of the
 *   products and charges and their sort read (#216)
 * @param {{ sort: ?object, onSort: function(object) }} props.sorting
 * @param {function(string): { unfolded: boolean, onToggle: function() }} props.unfoldingOf -
 *   Whether a product is unfolded, by its name, and what folds or unfolds it, which the Compare
 *   tab's hook holds for each project (see useUnfoldedRows())
 * @returns {JSX.Element}
 */
export default function ProjectProductComparison({
  productsQueryOf, monthA, monthB, comparedMonths, sorting, unfoldingOf, fmt, language, t,
}) {
  const { status, dataA, dataB } = useMonthAnswers(productsQueryOf, monthA, monthB);
  // Until both months' answers arrive, rather than a month at 0 € or no product at all, or
  // when one failed, rather than a month at 0 € (#181): in place of the table
  if (status !== 'answered') {
    return (
      <div className="text-sm">
        <MonthAnswersMessage status={status} failed={t('projectProductsFailed')} t={t} />
      </div>
    );
  }
  // What the server answers for each month, at its projected cost for the month in progress
  // while the page projects it (#219)
  const answerA = dataA ?? NOTHING_BILLED;
  const answerB = dataB ?? NOTHING_BILLED;
  const rows = productRows(answerA, answerB);
  const creditA = creditOf(answerA);
  const creditB = creditOf(answerB);
  // Whether the bills of either month used a credit, or projected lines use one
  const credited = creditA.total !== 0 || creditB.total !== 0;

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
          rows, sorting.sort, valuesAsShown(comparedMonths, productValues(t)), language,
        ).map(({
          product, chargesA, chargesB, valA, valB, projectedA, projectedB,
        }) => {
          const label = publicCloudProductLabel(product, t);
          return (
            <UnfoldingRow
              key={product}
              // A product unfolds once either month gives it charges, as every product that
              // costs anything has
              unfolding={chargesA.length > 0 || chargesB.length > 0 ? unfoldingOf(product) : null}
              chevronLabel={`${t('chargesOf')} ${label}`}
              label={label}
              detail={(
                <ProductCharges
                  chargesA={chargesA} chargesB={chargesB} sort={sorting.sort}
                  comparedMonths={comparedMonths} fmt={fmt} language={language} t={t}
                />
              )}
            >
              <td className="p-3 text-right font-medium">
                <ComparedAmount amount={valA} projectedPart={projectedA} fmt={fmt} t={t} />
              </td>
              <td className="p-3 text-right text-gray-500">
                <ComparedAmount amount={valB} projectedPart={projectedB} fmt={fmt} t={t} />
              </td>
              <td className="p-3 text-right">
                <Variation
                  from={valA} to={valB} comparedMonths={comparedMonths}
                  language={language} t={t}
                />
              </td>
            </UnfoldingRow>
          );
        })}
      </tbody>
      {/* The credit that the bills used, which pays for no product: after them, whatever
          their order, its label in line with theirs, which leave room for their chevrons. That
          of the month in progress at its projected cost is projected with the project's other
          lines of the month before, marked so (#219). */}
      {credited && (
        <tfoot>
          <tr className="border-b text-gray-500">
            <td className={LABEL_PADDING}>{t('cloudCreditUsed')}</td>
            <td className="p-3 text-right">
              <ComparedAmount
                amount={creditA.total} projectedPart={creditA.projected} fmt={fmt} t={t}
              />
            </td>
            <td className="p-3 text-right">
              <ComparedAmount
                amount={creditB.total} projectedPart={creditB.projected} fmt={fmt} t={t}
              />
            </td>
            {/* No variation of a credit to compute (#65) */}
            <td className="p-3" />
          </tr>
        </tfoot>
      )}
    </table>
  );
}
