import { useQuery } from '@tanstack/react-query';
import { variationPercent } from '../utils/variation.js';
import { sortRows } from './SortableHeader.jsx';
import { Variation } from './Variation.jsx';

// The value of a service in each column of the comparison that it details, which sorts the
// services as it sorts the rows (#146): its identifier in the column of the rows' labels, its
// cost in months A and B, and the variation from one to the other, none from 0 € or less
const SERVICE_VALUES = {
  type: (service) => service.identifier,
  totalA: (service) => service.valA,
  totalB: (service) => service.valB,
  variation: (service) => variationPercent(service.valA, service.valB),
};

// The most expensive in month A, or in month B, first
const BY_MONTH_A = { column: 'totalA', kind: 'number', direction: 'desc' };
const BY_MONTH_B = { column: 'totalB', kind: 'number', direction: 'desc' };

// The services in the order of the comparison's sort, and of the same value in its column, in
// their own order: by month A, the most expensive first, then by month B, which the services
// keep until the user sorts the comparison. Sorted by month B, then by month A, the services of
// the same cost in month A keep their order of month B.
const inOrder = (services, sort, language) => sortRows(
  sortRows(sortRows(services, BY_MONTH_B, SERVICE_VALUES, language),
    BY_MONTH_A, SERVICE_VALUES, language),
  sort, SERVICE_VALUES, language,
);

// The services of months A and B, paired by their identifier, which the server gives as
// `domain`, whatever the service: each service that either month billed, with the description
// of its most expensive bill line, month B's when month B billed it, and its cost in each
// month, 0 € in a month that did not bill it
const serviceRows = (servicesA, servicesB) => {
  const ofMonthA = new Map(servicesA.map((service) => [service.domain, service]));
  const ofMonthB = new Map(servicesB.map((service) => [service.domain, service]));
  return [...new Set([...ofMonthA.keys(), ...ofMonthB.keys()])].map((identifier) => ({
    identifier,
    description: (ofMonthB.get(identifier) ?? ofMonthA.get(identifier)).description,
    valA: ofMonthA.get(identifier)?.total ?? 0,
    valB: ofMonthB.get(identifier)?.total ?? 0,
  }));
};

// What an unfolded row says in place of its services, across the four columns of the
// comparison, in line with the services
const MessageRow = ({ className, children }) => (
  <tr className="border-b">
    <td colSpan={4} className={`py-2 pr-3 pl-12 text-sm ${className}`}>{children}</td>
  </tr>
);

/**
 * The services of a resource type in months A and B, right under its unfolded row in a
 * comparison of the Compare tab (#192), one row each, indented, in the row's columns: the
 * services that the Infrastructure tab lists for each month, as it shows them, their costs and
 * the variation. They follow the comparison's sort, within their row.
 * @param {object} props
 * @param {string} props.resourceType
 * @param {function(string, ?object): object} props.resourceTypeServicesQuery - The options of
 *   the query of a resource type's services in a month, for useQuery (useCompareTab()'s)
 * @param {?object} props.monthA
 * @param {?object} props.monthB
 * @param {?object} props.sort - The sort of the comparison, by its columns (see
 *   SortableHeader.jsx): null until the user sorts it, as for a comparison that does not sort
 * @returns {JSX.Element[]}
 */
const ResourceTypeServices = ({
  resourceType, resourceTypeServicesQuery, monthA, monthB, sort, fmt, language, t,
}) => {
  const answerA = useQuery(resourceTypeServicesQuery(resourceType, monthA));
  const answerB = useQuery(resourceTypeServicesQuery(resourceType, monthB));
  // Until both months' answers arrive, rather than a month at 0 €
  if (answerA.isLoading || answerB.isLoading) {
    return <MessageRow className="text-gray-500">{t('loading')}</MessageRow>;
  }
  // A month whose answer failed, rather than a month at 0 €
  if (answerA.isError || answerB.isError) {
    return <MessageRow className="text-red-500">{t('servicesFailed')}</MessageRow>;
  }
  return inOrder(serviceRows(answerA.data ?? [], answerB.data ?? []), sort, language).map(({
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
