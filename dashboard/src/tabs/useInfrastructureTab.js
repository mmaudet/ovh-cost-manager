// The Infrastructure tab's state and data queries, in a hook that the dashboard shell calls
// on every render: see docs/adr/0001-tab-state-lives-in-the-dashboard-shell.md
//
// The Compare tab lists the dedicated servers this hook returns as well: they load on that
// tab too, under the same key, so that it lists them before the Infrastructure tab opens
// (#35).

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  fetchInventoryServers, fetchInventoryVps, fetchInventoryStorage, fetchResourceTypeDetails,
  fetchResourceTypeDetailsByAccount,
} from '../services/api.js';
import { accountQuery } from '../utils/accounts.js';

/**
 * The inventory and the bill lines of the account shown (#123), for the Infrastructure tab.
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

  // The inventory of the account shown: the servers, VPS and storage services that exist now,
  // whatever the month
  const inventoryOf = (key, fetch, enabled) => accountQuery(selectedAccount, {
    key: [key], fetch, enabled,
  });

  const { data: inventoryServers = [] } = useQuery(inventoryOf(
    'inventoryServers', fetchInventoryServers,
    activeTab === 'infrastructure' || activeTab === 'compare',
  ));

  const { data: inventoryVps = [] } = useQuery(inventoryOf(
    'inventoryVps', fetchInventoryVps, activeTab === 'infrastructure',
  ));

  const { data: inventoryStorage = [] } = useQuery(inventoryOf(
    'inventoryStorage', fetchInventoryStorage, activeTab === 'infrastructure',
  ));

  // The bill lines of the open resource type in the month selected, whatever the tab (#56):
  // those of the account shown, or, while the lists name the account of each service, those
  // of all accounts by account, a service billed to several accounts once for each. One query
  // or the other, so that a single-account installation keeps the queries it had.
  const detailsOf = [selectedResourceType, selectedMonth?.from, selectedMonth?.to];
  const detailsEnabled = !!selectedResourceType && holdsSelectedMonth;
  const { data: resourceTypeDetails = [] } = useQuery(accountColumn
    ? {
      queryKey: ['resourceTypeDetailsByAccount', ...detailsOf],
      queryFn: () => fetchResourceTypeDetailsByAccount(
        selectedResourceType, selectedMonth.from, selectedMonth.to,
      ),
      enabled: detailsEnabled,
    }
    : accountQuery(selectedAccount, {
      key: ['resourceTypeDetails', ...detailsOf],
      fetch: (account) => fetchResourceTypeDetails(
        selectedResourceType, selectedMonth.from, selectedMonth.to, account,
      ),
      enabled: detailsEnabled,
    }));

  return {
    inventoryServers,
    inventoryVps,
    inventoryStorage,
    resourceTypeDetails,
    showAllServers,
    setShowAllServers,
  };
};

export { useInfrastructureTab };
