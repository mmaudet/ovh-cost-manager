// The query of a resource type's services over a month (#123): its bill lines by service,
// which the Infrastructure tab lists under its open resource type, and the Compare tab under a
// row that it unfolds (#192). Both tabs ask for them here only, which decides how and under
// which key, so that they share a month's answer (ADR 0001). The keys and the requests keep the
// name of the route, resource-type-details.

import {
  fetchResourceTypeDetails, fetchResourceTypeDetailsByAccount,
} from '../services/api.js';
import { accountQuery } from '../utils/accounts.js';

// The query of the services of the account shown, each service once: its key names the
// account after the rest, or none for all accounts (accountQuery())
const ofAccountShown = (account, resourceType, month, enabled) => accountQuery(account, {
  key: ['resourceTypeDetails', resourceType, month?.from, month?.to],
  fetch: (shown) => fetchResourceTypeDetails(resourceType, month.from, month.to, shown),
  enabled,
});

// The query of the services of all accounts by account, each service once for each account
// that billed it, with that account: its key names no account, as its request asks for all
const byAccount = (resourceType, month, enabled) => ({
  queryKey: ['resourceTypeDetailsByAccount', resourceType, month?.from, month?.to],
  queryFn: () => fetchResourceTypeDetailsByAccount(resourceType, month.from, month.to),
  enabled,
});

/**
 * The options of the query of a resource type's services over a month, for useQuery, as the
 * lists show them: the services of the account shown, or, while the lists name the account of
 * each service, with all accounts shown, those of all accounts by account, a service billed to
 * several accounts once for each (#123, #194).
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
) => (accountColumn
  ? byAccount(resourceType, month, enabled)
  : ofAccountShown(account, resourceType, month, enabled));
