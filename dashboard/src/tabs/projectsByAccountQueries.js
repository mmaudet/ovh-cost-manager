// The queries of the lists that name the account of each project, with all accounts shown
// (#118): each project once for each account that billed it, with that account. The
// Overview's lists and the Compare tab's comparison by project (#119) ask for them, a month
// each, under keys built here only, so that two tabs that ask for the same month share its
// answer (ADR 0001).

import { fetchGpuProjectsByAccount, fetchProjectsByAccount } from '../services/api.js';

// The options of such a query, for useQuery, from the name of its key and the function that
// requests its answer: its key names the month, and no account, as its request asks for all
// accounts
const projectsByAccountOf = (name, requestProjects) => (month, enabled) => ({
  queryKey: [name, month?.from, month?.to],
  queryFn: () => requestProjects(month.from, month.to),
  enabled,
});

/**
 * The options of the query of the costs of each project by account over a month, for
 * useQuery: those of the Overview's breakdown by project and of the Compare tab's comparison
 * by project, while they name the account of each project.
 * @param {?{ from: string, to: string }} month - The month, null while there is none yet
 * @param {boolean} enabled - Whether the query may run
 * @returns {{ queryKey: Array, queryFn: function(): Promise<object[]>, enabled: boolean }}
 */
export const projectsByAccountQuery =
  projectsByAccountOf('projectsByAccount', fetchProjectsByAccount);

/**
 * The options of the query of the GPU costs of each project by account over a month, for
 * useQuery: those of the Overview's GPU costs by project, while they name the account of
 * each project.
 * @param {?{ from: string, to: string }} month - The month, null while there is none yet
 * @param {boolean} enabled - Whether the query may run
 * @returns {{ queryKey: Array, queryFn: function(): Promise<object[]>, enabled: boolean }}
 */
export const gpuProjectsByAccountQuery =
  projectsByAccountOf('gpuProjectsByAccount', fetchGpuProjectsByAccount);
