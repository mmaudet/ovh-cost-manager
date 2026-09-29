// The Overview tab's state and data queries, in a hook that the dashboard shell calls on
// every render: see docs/adr/0001-tab-state-lives-in-the-dashboard-shell.md
//
// Most of what the tab shows, the shell requests at page start, for the account selected in
// the header, and passes on: the KPI cards, the header, the Markdown report or other tabs
// read it as well. So do the costs by project and the GPU costs, once for each project. The
// budget stays in the shell too, since the month-end forecast card reads it.
//
// The tab queries only what its lists show when they name the account of each project, with all
// accounts shown (#118): their projects once for each account that billed them, which the list of
// projects of the Public Cloud tab reads too, through the shell (#180). Everything else lists
// each project once, as before.

import { useQuery } from '@tanstack/react-query';
import { useTableSorts } from '../components/SortableHeader.jsx';
import { gpuProjectsByAccountQuery, projectsByAccountQuery } from './projectsByAccountQueries.js';

// The breakdown by project sorts by amount, the most expensive first, until the user sorts it
// by another column (#146)
const BY_AMOUNT = { column: 'total', kind: 'number', direction: 'desc' };

// selectedMonth: the month of the header, which the months of the account shown hold when
// holdsSelectedMonth says so, as the shell checks it. accountColumn: the Account column of
// the lists (accountColumnOf()), null when they name no account.
const useOverviewTab = ({ selectedMonth, holdsSelectedMonth, accountColumn }) => {
  // The sort order of its tables, by table (#146)
  const sortingOf = useTableSorts({ projects: BY_AMOUNT });

  // The projects of the month by account, for all accounts, while the lists name the account
  // of each: the breakdown by project, which the Public Cloud tab's list of projects reads too,
  // and the GPU costs by project. As the shell's queries of the month, they wait until the
  // months of the account shown hold it.
  const enabled = accountColumn !== null && holdsSelectedMonth;
  const { data: projectsByAccountOfMonth, isError: projectsByAccountFailed } = useQuery(
    projectsByAccountQuery(selectedMonth, enabled),
  );
  const { data: gpuProjectsByAccount = [] } = useQuery(
    gpuProjectsByAccountQuery(selectedMonth, enabled),
  );

  return {
    sortingOf,
    projectsByAccount: projectsByAccountOfMonth ?? [],
    // Whether those of the month have loaded, which the Public Cloud tab's list waits for,
    // rather than show that nothing was billed (#180)
    projectsByAccountLoaded: projectsByAccountOfMonth !== undefined,
    // Whether they could not load, which the list says (#180)
    projectsByAccountFailed,
    gpuProjectsByAccount,
  };
};

export { useOverviewTab };
