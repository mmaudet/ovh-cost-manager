// The Web Cloud tab's state and data queries, in a hook that the dashboard shell calls on
// every render: see docs/adr/0001-tab-state-lives-in-the-dashboard-shell.md

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchWebCloudSummary, fetchWebCloudItems } from '../services/api.js';
import { webCloudPeriodEndingOn } from '../utils/webCloudPeriod.js';

const useWebCloudTab = ({ selectedMonth, activeTab }) => {
  const [showAllWebCloud, setShowAllWebCloud] = useState(null); // category key, null when closed

  const webCloudPeriod = webCloudPeriodEndingOn(selectedMonth);

  const { data: webCloudSummary } = useQuery({
    queryKey: ['webCloudSummary', webCloudPeriod?.from, webCloudPeriod?.to],
    queryFn: () => fetchWebCloudSummary(webCloudPeriod.from, webCloudPeriod.to),
    enabled: !!webCloudPeriod && activeTab === 'webcloud'
  });

  const { data: webCloudItems = [] } = useQuery({
    queryKey: ['webCloudItems', webCloudPeriod?.from, webCloudPeriod?.to],
    queryFn: () => fetchWebCloudItems(webCloudPeriod.from, webCloudPeriod.to),
    enabled: !!webCloudPeriod && activeTab === 'webcloud'
  });

  return {
    webCloudPeriod,
    webCloudSummary,
    webCloudItems,
    showAllWebCloud,
    setShowAllWebCloud,
  };
};

export { useWebCloudTab };
