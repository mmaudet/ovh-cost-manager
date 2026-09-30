import { accountInBrackets } from '../utils/accounts.js';
import { byNameAndAccount, pairMonths, valuesAsShown } from '../utils/monthComparison.js';
import { MonthAnswersMessage, useMonthAnswers } from './MonthAnswers.jsx';
import { DETAIL_PADDING, DetailRow, sortUnfolded } from './UnfoldingRow.jsx';

// The services of months A and B, paired by their identifier, which the server gives as
// `domain`, whatever the service, and by their account, which the server gives while the lists
// name the account of each service (#194): a service billed to two accounts has a row for each.
// Each service that either month billed, with its account, the description of its most
// expensive bill line, month B's when month B billed it, and its cost in each month, 0 € in a
// month that did not bill it.
const serviceRows = (servicesA, servicesB) => pairMonths(
  servicesA, servicesB, byNameAndAccount(({ domain }) => domain),
).map(({ key, rowA, rowB, valA, valB }) => {
  const { domain, account, description } = rowB ?? rowA;
  return { key, identifier: domain, account, description, valA, valB };
});

/**
 * The services of an unfolded row of a comparison of the Compare tab in months A and B, right
 * under the row, one row each, indented, in the comparison's columns, with their costs and the
 * variation: those of a resource type (#192), which the Infrastructure tab lists for each month,
 * as it shows them, or those of a row of the backup comparison, its Veeam VMs or its Enterprise
 * licences (#197). They follow the comparison's sort, within their row, and come by month A, the
 * most expensive first, then by month B, until the user sorts it (sortUnfolded()). While the
 * lists name the account of each service, each names its account in brackets, and a service
 * billed to several accounts has a row for each (#194).
 * @param {object} props
 * @param {function(?object): object} props.servicesQueryOf - The options of the query of the
 *   row's services in a month, for useQuery: useCompareTab()'s resourceTypeServicesQuery() or
 *   backupServicesQuery(), for the row
 * @param {?object} props.monthA
 * @param {?object} props.monthB
 * @param {{ includesMonthInProgress: boolean, projected: boolean }} props.comparedMonths - What
 *   the comparison knows of months A and B (comparedMonthsOf()), which the variations of the
 *   services and their sort read (#216)
 * @param {?object} props.sort - The sort of the comparison, by its columns (see
 *   SortableHeader.jsx): null until the user sorts it, as for a comparison that does not sort
 * @param {Object<string, function(object): *>} props.values - The value of a service in each
 *   column of the comparison, by the column's name, as comparisonValues() gives them, those of
 *   months A and B (totalA, totalB) included: a service has its identifier, its description,
 *   and its cost in each month, valA and valB. The services sort by them as the comparison shows
 *   them (valuesAsShown())
 * @param {number} props.columnCount - The comparison's number of columns
 * @param {?{ nameOf: function(?string): string }} props.accountColumn - The Account column of
 *   the lists (accountColumnOf()), null when they name no account: while it shows, each service
 *   names its account, which the query gives it then (useCompareTab())
 * @returns {JSX.Element|JSX.Element[]} A single row, across the comparison's columns, that says
 *   that the services load, until both months answered, or that they could not load, when one
 *   failed; else a row for each service
 */
const UnfoldedRowServices = ({
  servicesQueryOf, monthA, monthB, comparedMonths, sort, values, columnCount, accountColumn,
  fmt, language, t,
}) => {
  const { status, dataA, dataB } = useMonthAnswers(servicesQueryOf, monthA, monthB);
  // Until both months' answers arrive, or when one failed, rather than a month at 0 €, in line
  // with the services
  if (status !== 'answered') {
    return (
      <tr className="border-b">
        <td colSpan={columnCount} className={`${DETAIL_PADDING} text-sm`}>
          <MonthAnswersMessage status={status} failed={t('servicesFailed')} t={t} />
        </td>
      </tr>
    );
  }
  return sortUnfolded(
    serviceRows(dataA ?? [], dataB ?? []), sort, valuesAsShown(comparedMonths, values), language,
  ).map(({
    key, identifier, account, description, valA, valB,
  }) => (
    <DetailRow
      key={key} valA={valA} valB={valB} comparedMonths={comparedMonths}
      fmt={fmt} language={language} t={t}
    >
      {/* The description is cut to the column of the rows' labels, and the identifier wraps to
          it, at its hyphens first */}
      <div className="text-xs break-words">
        <span className="font-mono">{identifier}</span>
        {/* Its account while the lists name it, in brackets, as a line that names a service
            names it (#194) */}
        {accountColumn && (
          <>
            {' '}
            <span className="text-gray-400">{accountInBrackets(accountColumn, account)}</span>
          </>
        )}
      </div>
      <div className="truncate text-xs text-gray-500" title={description}>
        {description}
      </div>
    </DetailRow>
  ));
};

export { UnfoldedRowServices };
