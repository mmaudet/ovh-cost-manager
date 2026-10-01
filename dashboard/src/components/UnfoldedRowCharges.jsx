import { MonthAnswersMessage, useMonthAnswers } from './MonthAnswers.jsx';
import { ComparedCharges, DETAIL_PADDING } from './UnfoldingRow.jsx';

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
 *   column of the comparison, by the column's name, as ComparedCharges takes them
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

export { UnfoldedRowCharges };
