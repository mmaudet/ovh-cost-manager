// The query of a resource type's bill lines by service over a month, for the account shown
// (#123): the services that the Infrastructure tab lists under its open resource type, and that
// the Compare tab lists under a row it unfolds (#192). Both tabs ask for them under the key
// built here only, so that they share a month's answer (ADR 0001).

import { fetchResourceTypeDetails } from '../services/api.js';
import { accountQuery } from '../utils/accounts.js';

/**
 * The options of the query of a resource type's services over a month, for useQuery: its key
 * names the account after the rest, or none for all accounts (accountQuery()).
 * @param {?string|undefined} account - The account shown: null for all accounts, undefined
 *   while the page does not know it, which the query waits for
 * @param {?string} resourceType - The resource type, null while there is none
 * @param {?{ from: string, to: string }} month - The month, null while there is none yet
 * @param {boolean} enabled - Whether the query may run besides
 * @returns {{ queryKey: Array, queryFn: function(): Promise<object[]>, enabled: boolean }}
 */
export const resourceTypeDetailsQuery = (account, resourceType, month, enabled) => accountQuery(
  account, {
    key: ['resourceTypeDetails', resourceType, month?.from, month?.to],
    fetch: (shown) => fetchResourceTypeDetails(resourceType, month.from, month.to, shown),
    enabled,
  },
);
