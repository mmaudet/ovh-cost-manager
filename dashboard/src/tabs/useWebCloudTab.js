// The Web Cloud tab's state and data queries, in a hook that the dashboard shell calls on
// every render: see docs/adr/0001-tab-state-lives-in-the-dashboard-shell.md

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchWebCloudSummary, fetchWebCloudItems } from '../services/api.js';
import { WEB_CLOUD_MONTHS, shiftMonths } from '../utils/webCloudPeriod.js';

const useWebCloudTab = ({ selectedMonth, activeTab }) => {
  const [showAllWebCloud, setShowAllWebCloud] = useState(null); // category key, null when closed

  // Domains, hosting and mail renew yearly, so the Web Cloud tab reads the 12
  // months ending on the selected one rather than that single month.
  const webCloudPeriod = selectedMonth ? {
    from: shiftMonths(selectedMonth.from, -(WEB_CLOUD_MONTHS - 1)),
    to: selectedMonth.to
  } : null;

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
