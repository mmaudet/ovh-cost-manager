// The Infrastructure tab's state and data queries, in a hook that the dashboard shell calls
// on every render: see docs/adr/0001-tab-state-lives-in-the-dashboard-shell.md
//
// The Compare tab lists the dedicated servers this hook returns as well, but they only
// load on the Infrastructure tab: Compare shows none until that tab has been opened (#35).

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  fetchInventoryServers, fetchInventoryVps, fetchInventoryStorage, fetchResourceTypeDetails,
} from '../services/api.js';

const useInfrastructureTab = ({ selectedMonth, activeTab, selectedResourceType }) => {
  const [showAllServers, setShowAllServers] = useState(false);

  // The inventory: the servers, VPS and storage services that exist now
  const { data: inventoryServers = [] } = useQuery({
    queryKey: ['inventoryServers'],
    queryFn: fetchInventoryServers,
    enabled: activeTab === 'infrastructure'
  });

  const { data: inventoryVps = [] } = useQuery({
    queryKey: ['inventoryVps'],
    queryFn: fetchInventoryVps,
    enabled: activeTab === 'infrastructure'
  });

  const { data: inventoryStorage = [] } = useQuery({
    queryKey: ['inventoryStorage'],
    queryFn: fetchInventoryStorage,
    enabled: activeTab === 'infrastructure'
  });

  const { data: resourceTypeDetails = [] } = useQuery({
    queryKey: ['resourceTypeDetails', selectedResourceType, selectedMonth?.from, selectedMonth?.to],
    queryFn: () => fetchResourceTypeDetails(selectedResourceType, selectedMonth.from, selectedMonth.to),
    enabled: !!selectedResourceType && !!selectedMonth
  });

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
