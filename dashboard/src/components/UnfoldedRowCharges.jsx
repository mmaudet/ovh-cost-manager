import { comparisonValues, pairMonths, valuesAsShown } from '../utils/monthComparison.js';
import { MonthAnswersMessage, useMonthAnswers } from './MonthAnswers.jsx';
import { DETAIL_PADDING, DetailRow, sortUnfolded } from './UnfoldingRow.jsx';

/**
 * The value of a charge in each column that sorts a comparison (#146), which sort the charges of
 * an unfolded row as they sort the rows (#195, #248): the charge itself, in the column that names
 * the rows, its cost in months A and B, and the variation.
 * @param {string} column - The name of the column that names the rows, such as 'product' in a
 *   project's comparison, or 'type' in the infrastructure comparison
 * @returns {Object<string, function(object): *>} The value of a charge, as ComparedCharges pairs
 *   it, by the column's name (comparisonValues())
 */
const chargeValues = (column) => comparisonValues(column, (row) => row.charge);

/**
 * The charges of months A and B under an unfolded row of a comparison, one row each, indented, in
 * the comparison's columns: each charge that either month gives, paired by charge, its cost in
 * each month, 0 € in a month that did not bill it, and the variation. Those of a product of a
 * Public Cloud project, which come with the products (#195), and those of the Logs Data Platform
 * row of the infrastructure comparison, which UnfoldedRowCharges asks for (#248). They follow the
 * comparison's sort, within their row, and come by month A, the most expensive first, then by
 * month B, until the user sorts it (sortUnfolded()). A charge's cost that projected lines make,
 * that of the month in progress while the page projects it, is marked so, as a charge that the
 * month has not billed yet (#219).
 * @param {object} props
 * @param {{ charge: string, total: number, projected: (number|undefined) }[]} props.chargesA -
 *   The charges of month A, as the server gives them, the most expensive first, with their
 *   projected parts for the month in progress at its projected cost
 * @param {{ charge: string, total: number, projected: (number|undefined) }[]} props.chargesB -
 *   Those of month B
 * @param {?object} props.sort - The sort of the comparison, by its columns (see
 *   SortableHeader.jsx): null until the user sorts it
 * @param {Object<string, function(object): *>} props.values - The value of a charge in each
 *   column of the comparison, by the column's name, as chargeValues() gives them. The charges
 *   sort by them as the comparison shows them (valuesAsShown())
 * @param {{ includesMonthInProgress: boolean, projected: boolean }} props.comparedMonths - What
 *   the comparison knows of months A and B (comparedMonthsOf()), which the variations of the
 *   charges and their sort read (#216)
 * @returns {JSX.Element[]} A row for each charge
 */
const ComparedCharges = ({
  chargesA, chargesB, sort, values, comparedMonths, fmt, language, t,
}) => sortUnfolded(
  pairMonths(chargesA, chargesB, ({ charge }) => charge)
    .map(({
      key, valA, valB, projectedA, projectedB,
    }) => ({
      charge: key, valA, valB, projectedA, projectedB,
    })),
  sort, valuesAsShown(comparedMonths, values), language,
).map(({
  charge, valA, valB, projectedA, projectedB,
}) => (
  <DetailRow
    key={charge} valA={valA} valB={valB} projectedA={projectedA} projectedB={projectedB}
    comparedMonths={comparedMonths} fmt={fmt} language={language} t={t}
  >
    {/* A long charge, such as an instance's monthly plan, which names the instance, wraps to the
        column of the rows' labels */}
    <div className="text-xs break-words">{charge}</div>
  </DetailRow>
));

/**
 * The charges of an unfolded row of a comparison of the Compare tab in months A and B, right
 * under the row, which it asks for once unfolded: those of the Logs Data Platform services
 * (#248), which the Infrastructure tab lists for each month, the services together, rather than
 * the services of the row of their resource type. ComparedCharges shows them as a product's
 * charges, which come with the products (#195): paired by charge, 0 € in a month that did not
 * bill one, in the comparison's sort within their row, and, while the page projects the month in
 * progress, those that projected lines make marked « projeté » (#219).
 * @param {object} props
 * @param {function(?object): object} props.chargesQueryOf - The options of the query of the
 *   row's charges in a month, for useQuery: useCompareTab()'s logsDataPlatformChargesQuery(),
 *   whose answer gives them, `charges`
 * @param {?object} props.monthA
 * @param {?object} props.monthB
 * @param {{ includesMonthInProgress: boolean, projected: boolean }} props.comparedMonths - What
 *   the comparison knows of months A and B (comparedMonthsOf()), which the variations of the
 *   charges and their sort read (#216)
 * @param {?object} props.sort - The sort of the comparison, by its columns (see
 *   SortableHeader.jsx): null until the user sorts it
 * @param {Object<string, function(object): *>} props.values - The value of a charge in each
 *   column of the comparison, by the column's name, as chargeValues() gives them
 * @param {number} props.columnCount - The comparison's number of columns
 * @returns {JSX.Element|JSX.Element[]} A single row, across the comparison's columns, that says
 *   that the charges load, until both months answered, or that they could not load, when one
 *   failed; else a row for each charge
 */
const UnfoldedRowCharges = ({
  chargesQueryOf, monthA, monthB, comparedMonths, sort, values, columnCount, fmt, language, t,
}) => {
  const { status, dataA, dataB } = useMonthAnswers(chargesQueryOf, monthA, monthB);
  // Until both months' answers arrive, or when one failed, rather than a month at 0 €, in line
  // with the charges
  if (status !== 'answered') {
    return (
      <tr className="border-b">
        <td colSpan={columnCount} className={`${DETAIL_PADDING} text-sm`}>
          <MonthAnswersMessage status={status} failed={t('chargesFailed')} t={t} />
        </td>
      </tr>
    );
  }
  return (
    <ComparedCharges
      chargesA={dataA?.charges ?? []} chargesB={dataB?.charges ?? []} sort={sort}
      values={values} comparedMonths={comparedMonths} fmt={fmt} language={language} t={t}
    />
  );
};

export { ComparedCharges, UnfoldedRowCharges, chargeValues };
