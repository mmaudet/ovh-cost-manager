// The queries of the lists that name the account of each project, with all accounts shown
// (#118): each project once for each account that billed it, with that account. The
// Overview's lists and the Compare tab's comparison by project (#119) ask for them, a month
// each, under keys built here only, so that two tabs that ask for the same month share its
// answer (ADR 0001). The comparison by project asks here for those of the account shown too,
// while the lists name no account.

import {
  fetchByProject, fetchGpuProjectsByAccount, fetchProjectsByAccount,
} from '../services/api.js';
import { listQuery } from '../utils/accounts.js';

// The query of the projects of a month by account, for listQuery(), from the name of its key
// and the function that requests them: its key names the month, and no account, as its request
// asks for all accounts
const byAccountOf = (name, requestProjects) => (month) => ({
  key: [name, month?.from, month?.to],
  fetch: () => requestProjects(month.from, month.to),
});
const projectsByAccount = byAccountOf('projectsByAccount', fetchProjectsByAccount);
const gpuProjectsByAccount = byAccountOf('gpuProjectsByAccount', fetchGpuProjectsByAccount);

/**
 * The options of the query of the costs of each project by account over a month, for
 * useQuery: those of the Overview's breakdown by project, which runs only while the lists name
 * the account of each project (listQuery()).
 * @param {?object} accountColumn - The Account column of the lists (accountColumnOf()), null
 *   when they name no account
 * @param {?{ from: string, to: string }} month - The month, null while there is none yet
 * @param {boolean} enabled - Whether the query may run besides
 * @returns {{ queryKey: Array, queryFn: function(): Promise<object[]>, enabled: boolean }}
 */
export const projectsByAccountQuery = (accountColumn, month, enabled) => listQuery(
  accountColumn, { byAccount: projectsByAccount(month), enabled },
);

/**
 * The options of the query of the GPU costs of each project by account over a month, for
 * useQuery: those of the Overview's GPU costs by project, which runs only while the lists
 * name the account of each project (listQuery()).
 * @param {?object} accountColumn - The Account column of the lists (accountColumnOf()), null
 *   when they name no account
 * @param {?{ from: string, to: string }} month - The month, null while there is none yet
 * @param {boolean} enabled - Whether the query may run besides
 * @returns {{ queryKey: Array, queryFn: function(): Promise<object[]>, enabled: boolean }}
 */
export const gpuProjectsByAccountQuery = (accountColumn, month, enabled) => listQuery(
  accountColumn, { byAccount: gpuProjectsByAccount(month), enabled },
);

/**
 * The options of the query of the costs of each project over a month, for useQuery, as the
 * lists show them (listQuery()): those of the account shown, each project once, under the key
 * of the costs by project that the shell loads for its selected month; or, while the lists
 * name the account of each project, with all accounts shown, those of all accounts by account,
 * under the key of the Overview's breakdown by project (#119). The Compare tab's comparison by
 * project asks for them so.
 * @param {?string|undefined} account - The account shown: null for all accounts, undefined
 *   while the page does not know it, which the query waits for
 * @param {?object} accountColumn - The Account column of the lists (accountColumnOf()), null
 *   when they name no account
 * @param {?{ from: string, to: string }} month - The month, null while there is none yet
 * @param {boolean} enabled - Whether the query may run besides
 * @returns {{ queryKey: Array, queryFn: function(): Promise<object[]>, enabled: boolean }}
 */
export const projectsQuery = (account, accountColumn, month, enabled) => listQuery(
  accountColumn, {
    byAccount: projectsByAccount(month),
    ofAccountShown: {
      account,
      key: ['byProject', month?.from, month?.to],
      fetch: (shown) => fetchByProject(month.from, month.to, shown),
    },
    enabled,
  },
);
