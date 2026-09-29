import { BY_MONTH_A, BY_MONTH_B, pairMonths } from '../utils/monthComparison.js';
import { MonthAnswersMessage, useMonthAnswers } from './MonthAnswers.jsx';
import { sortRows } from './SortableHeader.jsx';
import { Variation } from './Variation.jsx';

// The services in the order of the comparison's sort, by the values of its columns, and of the
// same value in its column, in their own order: by month A, the most expensive first, then by
// month B, which the services keep until the user sorts the comparison. Sorted by month B, then
// by month A, the services of the same cost in month A keep their order of month B.
const inOrder = (services, sort, values, language) => sortRows(
  sortRows(sortRows(services, BY_MONTH_B, values, language), BY_MONTH_A, values, language),
  sort, values, language,
);

// The services of months A and B, paired by their identifier, which the server gives as
// `domain`, whatever the service: each service that either month billed, with the description
// of its most expensive bill line, month B's when month B billed it, and its cost in each
// month, 0 € in a month that did not bill it
const serviceRows = (servicesA, servicesB) => pairMonths(
  servicesA, servicesB, ({ domain }) => domain,
).map(({ key, rowA, rowB, valA, valB }) => ({
  identifier: key, description: (rowB ?? rowA).description, valA, valB,
}));

/**
 * The services of a resource type in months A and B, right under its unfolded row in a
 * comparison of the Compare tab (#192), one row each, indented, in the comparison's columns:
 * the services that the Infrastructure tab lists for each month, as it shows them, their costs
 * and the variation. They follow the comparison's sort, within their row.
 * @param {object} props
 * @param {string} props.resourceType
 * @param {function(string, ?object): object} props.resourceTypeServicesQuery - The options of
 *   the query of a resource type's services in a month, for useQuery (useCompareTab()'s)
 * @param {?object} props.monthA
 * @param {?object} props.monthB
 * @param {?object} props.sort - The sort of the comparison, by its columns (see
 *   SortableHeader.jsx): null until the user sorts it, as for a comparison that does not sort
 * @param {Object<string, function(object): *>} props.values - The value of a service in each
 *   column of the comparison, by the column's name, as sortRows() takes them, those of months A
 *   and B (totalA, totalB) included: a service has its identifier, its description, and its
 *   cost in each month, valA and valB
 * @param {number} props.columnCount - The comparison's number of columns
 * @returns {JSX.Element|JSX.Element[]} A single row, across the comparison's columns, that says
 *   that the services load, until both months answered, or that they could not load, when one
 *   failed; else a row for each service
 */
const ResourceTypeServices = ({
  resourceType, resourceTypeServicesQuery, monthA, monthB, sort, values, columnCount,
  fmt, language, t,
}) => {
  const { status, dataA, dataB } = useMonthAnswers(
    (month) => resourceTypeServicesQuery(resourceType, month), monthA, monthB,
  );
  // Until both months' answers arrive, or when one failed, rather than a month at 0 €, in line
  // with the services
  if (status !== 'answered') {
    return (
      <tr className="border-b">
        <td colSpan={columnCount} className="py-2 pr-3 pl-12 text-sm">
          <MonthAnswersMessage status={status} failed={t('servicesFailed')} t={t} />
        </td>
      </tr>
    );
  }
  return inOrder(serviceRows(dataA ?? [], dataB ?? []), sort, values, language).map(({
    identifier, description, valA, valB,
  }) => (
    <tr key={identifier} className="border-b text-gray-600">
      {/* A cell that asks the table for no width of its own (max-w-0): the description is cut
          to the column of the rows' labels, whatever the page's width, rather than widen the
          table, and the identifier wraps to it, at its hyphens first */}
      <td className="max-w-0 py-2 pr-3 pl-12">
        <div className="font-mono text-xs break-words">{identifier}</div>
        <div className="truncate text-xs text-gray-500" title={description}>
          {description}
        </div>
      </td>
      <td className="py-2 px-3 text-right">{fmt(valA)}€</td>
      <td className="py-2 px-3 text-right">{fmt(valB)}€</td>
      <td className="py-2 px-3 text-right">
        <Variation from={valA} to={valB} language={language} t={t} />
      </td>
    </tr>
  ));
};

export { ResourceTypeServices };
