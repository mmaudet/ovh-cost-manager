// The Web Cloud tab's state and data queries, in a hook that the dashboard shell calls on
// every render: see docs/adr/0001-tab-state-lives-in-the-dashboard-shell.md

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTableSorts } from '../components/SortableHeader.jsx';
import { fetchWebCloudSummary, fetchWebCloudItems } from '../services/api.js';
import { accountQuery } from '../utils/accounts.js';
import { webCloudPeriodEndingOn } from '../utils/webCloudPeriod.js';

// The services of the account shown (#122): selectedAccount, the shell's, is null for all
// accounts, and undefined while the page does not know it yet, which the queries wait for.
// They wait too until the months of the account shown hold the month selected,
// holdsSelectedMonth, as the shell checks it: not while they load, nor when the account lacks
// the month, until the shell selects its latest month (#115). The 12 months that end on a
// month the account lacks would never show (#120).
const useWebCloudTab = ({ selectedMonth, holdsSelectedMonth, activeTab, selectedAccount }) => {
  const [showAllWebCloud, setShowAllWebCloud] = useState(null); // category key, null when closed
  // The sort order of the table of each family, by family key (#146), which its panel and its
  // "show all" modal share
  const sortingOf = useTableSorts();

  const webCloudPeriod = webCloudPeriodEndingOn(selectedMonth);
  // The queries run once the tab is open, on a month that the account shown has
  const enabled = holdsSelectedMonth && activeTab === 'webcloud';

  const {
    data: webCloudSummary, isPending: summaryPending, isError: summaryFailed,
  } = useQuery(accountQuery(selectedAccount, {
    key: ['webCloudSummary', webCloudPeriod?.from, webCloudPeriod?.to],
    fetch: (account) => fetchWebCloudSummary(webCloudPeriod.from, webCloudPeriod.to, account),
    enabled,
  }));

  const {
    data: webCloudItems = [], isPending: itemsPending, isError: itemsFailed,
  } = useQuery(accountQuery(selectedAccount, {
    key: ['webCloudItems', webCloudPeriod?.from, webCloudPeriod?.to],
    fetch: (account) => fetchWebCloudItems(webCloudPeriod.from, webCloudPeriod.to, account),
    enabled,
  }));

  return {
    webCloudPeriod,
    webCloudSummary,
    webCloudItems,
    // Until both queries have answered, the tab shows that it is loading, and once either
    // failed, that it could not load, rather than zero services or that none was billed (#62)
    loadingWebCloud: summaryPending || itemsPending,
    failedWebCloud: summaryFailed || itemsFailed,
    showAllWebCloud,
    setShowAllWebCloud,
    sortingOf,
  };
};

export { useWebCloudTab };
