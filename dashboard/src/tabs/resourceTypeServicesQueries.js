// The query of a resource type's services over a month (#123): its bill lines by service,
// which the Infrastructure tab lists under its open resource type, and the Compare tab under a
// row that it unfolds (#192). Both tabs ask for them here only, which decides how and under
// which key, so that they share a month's answer (ADR 0001). The keys and the requests keep the
// name of the route, resource-type-details.

import {
  fetchResourceTypeDetails, fetchResourceTypeDetailsByAccount,
} from '../services/api.js';
import { listQuery } from '../utils/accounts.js';

/**
 * The options of the query of a resource type's services over a month, for useQuery, as the
 * lists show them (listQuery()): the services of the account shown, each service once, under a
 * key that names that account after the rest, or none for all accounts; or, while the lists
 * name the account of each service, with all accounts shown, those of all accounts by account,
 * a service billed to several accounts once for each (#123, #194).
 * @param {?string|undefined} account - The account shown: null for all accounts, undefined
 *   while the page does not know it, which the query waits for
 * @param {?object} accountColumn - The Account column of the lists (accountColumnOf()), null
 *   when they name no account
 * @param {?string} resourceType - The resource type, null while there is none
 * @param {?{ from: string, to: string }} month - The month, null while there is none yet
 * @param {boolean} enabled - Whether the query may run besides
 * @returns {{ queryKey: Array, queryFn: function(): Promise<object[]>, enabled: boolean }}
 */
export const resourceTypeServicesQuery = (
  account, accountColumn, resourceType, month, enabled,
) => listQuery(accountColumn, {
  byAccount: {
    key: ['resourceTypeDetailsByAccount', resourceType, month?.from, month?.to],
    fetch: () => fetchResourceTypeDetailsByAccount(resourceType, month.from, month.to),
  },
  ofAccountShown: {
    account,
    key: ['resourceTypeDetails', resourceType, month?.from, month?.to],
    fetch: (shown) => fetchResourceTypeDetails(resourceType, month.from, month.to, shown),
  },
  enabled,
});
