// The queries of a resource type's services over a month (#123): its bill lines by service,
// which the Infrastructure tab lists under its open resource type, and the Compare tab under a
// row that it unfolds (#192). Both tabs ask for them under keys built here only, so that they
// share a month's answer (ADR 0001). The keys and the requests keep the name of the route,
// resource-type-details.

import {
  fetchResourceTypeDetails, fetchResourceTypeDetailsByAccount,
} from '../services/api.js';
import { accountQuery } from '../utils/accounts.js';

/**
 * The options of the query of a resource type's services over a month, for the account shown,
 * for useQuery: each service once, its key naming the account after the rest, or none for all
 * accounts (accountQuery()).
 * @param {?string|undefined} account - The account shown: null for all accounts, undefined
 *   while the page does not know it, which the query waits for
 * @param {?string} resourceType - The resource type, null while there is none
 * @param {?{ from: string, to: string }} month - The month, null while there is none yet
 * @param {boolean} enabled - Whether the query may run besides
 * @returns {{ queryKey: Array, queryFn: function(): Promise<object[]>, enabled: boolean }}
 */
export const resourceTypeServicesQuery = (account, resourceType, month, enabled) => accountQuery(
  account, {
    key: ['resourceTypeDetails', resourceType, month?.from, month?.to],
    fetch: (shown) => fetchResourceTypeDetails(resourceType, month.from, month.to, shown),
    enabled,
  },
);

/**
 * The options of the query of a resource type's services over a month for all accounts, by
 * account, for useQuery: each service once for each account that billed it, with that account,
 * for the lists that name the account of each service (#123). Its key names no account, as its
 * request asks for all of them.
 * @param {?string} resourceType - The resource type, null while there is none
 * @param {?{ from: string, to: string }} month - The month, null while there is none yet
 * @param {boolean} enabled - Whether the query may run
 * @returns {{ queryKey: Array, queryFn: function(): Promise<object[]>, enabled: boolean }}
 */
export const resourceTypeServicesByAccountQuery = (resourceType, month, enabled) => ({
  queryKey: ['resourceTypeDetailsByAccount', resourceType, month?.from, month?.to],
  queryFn: () => fetchResourceTypeDetailsByAccount(resourceType, month.from, month.to),
  enabled,
});
