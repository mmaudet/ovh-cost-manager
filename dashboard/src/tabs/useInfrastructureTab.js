// The Infrastructure tab's state and data queries, in a hook that the dashboard shell calls
// on every render: see docs/adr/0001-tab-state-lives-in-the-dashboard-shell.md

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTableSorts } from '../components/SortableHeader.jsx';
import {
  fetchInventoryServers, fetchInventoryVps, fetchInventoryStorage, fetchLogsDataPlatform,
} from '../services/api.js';
import { accountQuery } from '../utils/accounts.js';
import { resourceTypeServicesQuery } from './resourceTypeServicesQueries.js';

// The table of the Logs Data Platform charges sorts by cost, the most expensive first, until the
// user sorts it by another column (#146, #247)
const BY_COST = { column: 'total', kind: 'number', direction: 'desc' };

/**
 * The inventory and the bill lines of the account shown (#123), for the Infrastructure tab, and
 * the query of the charges of its Logs Data Platform services in the month selected, which the
 * table of the charges runs (#247).
 * @param {object} shell - What the shell holds for the whole page (ADR 0001)
 * @param {?object} shell.selectedMonth - The month of the header
 * @param {boolean} shell.holdsSelectedMonth - Whether the months of the account shown hold
 *   it, as the shell checks it: the bill lines of that month wait until they do, not while
 *   they load, nor when the account lacks the month, until the shell selects its latest
 *   month (#115, #120)
 * @param {string} shell.activeTab
 * @param {?string} shell.selectedResourceType - The resource type whose bill lines are open
 * @param {?string|undefined} shell.selectedAccount - The account shown: null for all
 *   accounts, undefined while the page does not know it yet, which the queries wait for
 * @param {?object} shell.accountColumn - The Account column of the lists
 *   (accountColumnOf()), null when they name no account
 * @returns {object} What the shell spreads over the tab and its modal
 */
const useInfrastructureTab = ({
  selectedMonth, holdsSelectedMonth, activeTab, selectedResourceType, selectedAccount,
  accountColumn,
}) => {
  const [showAllServers, setShowAllServers] = useState(false);
  // The sort order of its tables, by table (#146): that of the servers is shared by their
  // panel and their "show all" modal
  const sortingOf = useTableSorts({ logsDataPlatform: BY_COST });

  // The inventory of the account shown: the servers, VPS and storage services that exist now,
  // whatever the month, which the tab lists once open. The Compare tab no longer lists the
  // servers, whose row unfolds into those that months A and B billed (#194).
  const inventoryOf = (key, fetch, enabled) => accountQuery(selectedAccount, {
    key: [key], fetch, enabled,
  });

  const { data: inventoryServers = [] } = useQuery(inventoryOf(
    'inventoryServers', fetchInventoryServers, activeTab === 'infrastructure',
  ));

  const { data: inventoryVps = [] } = useQuery(inventoryOf(
    'inventoryVps', fetchInventoryVps, activeTab === 'infrastructure',
  ));

  const { data: inventoryStorage = [] } = useQuery(inventoryOf(
    'inventoryStorage', fetchInventoryStorage, activeTab === 'infrastructure',
  ));

  // The bill lines of the open resource type in the month selected, by service, whatever the
  // tab (#56), as the Compare tab asks for the services of a row it unfolds, under the same key
  // (#192, #194): the services of the account shown, or, while the lists name the account of
  // each service, those of all accounts by account, a service billed to several accounts once
  // for each. One query or the other, so that a single-account installation keeps the queries
  // it had.
  const servicesEnabled = !!selectedResourceType && holdsSelectedMonth;
  const { data: resourceTypeDetails = [] } = useQuery(resourceTypeServicesQuery(
    selectedAccount, accountColumn, selectedResourceType, selectedMonth, servicesEnabled,
  ));

  // The options of the query of the charges of the Logs Data Platform services in the month
  // selected (#247), for useQuery: the services together, as the figures of the month, those of
  // the account shown, and all accounts' added up when all are shown, whatever the Account
  // column of the lists, as the table names no account. What the month billed, never projected.
  // The table runs it once the tab shows it, as the Compare tab's rows run theirs once unfolded:
  // the page opens with the queries it had. On the tab only, as the inventory, for a month of
  // the months list.
  const logsDataPlatformQuery = accountQuery(selectedAccount, {
    key: ['logsDataPlatform', selectedMonth?.from, selectedMonth?.to],
    fetch: (account) => fetchLogsDataPlatform(selectedMonth.from, selectedMonth.to, account),
    enabled: holdsSelectedMonth && activeTab === 'infrastructure',
  });

  return {
    sortingOf,
    inventoryServers,
    inventoryVps,
    inventoryStorage,
    resourceTypeDetails,
    logsDataPlatformQuery,
    showAllServers,
    setShowAllServers,
  };
};

export { useInfrastructureTab };
