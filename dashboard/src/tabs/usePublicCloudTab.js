// The Public Cloud tab's state and data queries, in a hook that the dashboard shell calls
// on every render: see docs/adr/0001-tab-state-lives-in-the-dashboard-shell.md

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTableSorts } from '../components/SortableHeader.jsx';
import {
  fetchProjectsEnriched, fetchProjectConsumption, fetchProjectInstances, fetchProjectQuotas,
  fetchProjectVolumes, fetchProjectSnapshots, fetchProjectSavingsPlans, fetchProjectBuckets,
  fetchProjectInstanceTotal, fetchPublicCloudStats, fetchProjectOtherServices, fetchAiEndpoints,
} from '../services/api.js';
import { accountQuery } from '../utils/accounts.js';

// The selected project is the shell's, not the tab's (#36): the Overview opens a project
// on this tab, and the logo closes it. The hook reads it, as it reads the selected month and
// the account shown (#121): the projects and the figures of the month are those of that
// account, and a project's resources those of the project, which belongs to one account.
// What is billed in the month selected waits until the months of the account shown hold that
// month, holdsSelectedMonth, as the shell checks it: not while they load, nor when the account
// lacks the month, until the shell selects its latest month (#115). A month the account lacks
// would never show (#120).
// What a project's detail shows of its other services until they load
const NO_OTHER_SERVICES = { total: 0, products: [], credits: 0 };

// The table of the AI Endpoints models sorts by cost, the most expensive first, until the user
// sorts it by another column (#146, #193)
const BY_COST = { column: 'total', kind: 'number', direction: 'desc' };

const usePublicCloudTab = ({
  selectedMonth, holdsSelectedMonth, activeTab, selectedProject, selectedAccount,
}) => {
  // The sort order of its tables, by table (#146): those of the open project's resources are
  // shared by their panel and their "show all" modal, and stay when another project opens
  const sortingOf = useTableSorts({ aiEndpoints: BY_COST });
  const [showAllBuckets, setShowAllBuckets] = useState(false);
  const [showAllInstances, setShowAllInstances] = useState(false);
  const [showAllVolumes, setShowAllVolumes] = useState(false);
  const [showAllSnapshots, setShowAllSnapshots] = useState(false);
  const [showAllSavingsPlans, setShowAllSavingsPlans] = useState(false);

  // Enriched projects for the Public Cloud tab, and whether those of the account shown have
  // loaded: until they have, as when the tab first opens or another account is selected, the tab
  // cannot tell which projects billed in the month the list lacks (#180). A later request that
  // fails, such as once an import is over, leaves the projects that it had, and so the tab
  // those that it lacks.
  const { data: projectsOfAccount } = useQuery(accountQuery(selectedAccount, {
    key: ['projectsEnriched'],
    fetch: fetchProjectsEnriched,
    enabled: activeTab === 'inventory',
  }));
  const projectsEnriched = projectsOfAccount ?? [];
  const projectsLoaded = projectsOfAccount !== undefined;

  // The project whose detail is open: the one selected, while the list of the account shown
  // holds it. It stays selected across account switches (#56), but with an account that does
  // not list it, no project is open and nothing of it is asked for (#121).
  const openProject = projectsEnriched.some(({ id }) => id === selectedProject?.id)
    ? selectedProject
    : null;

  // Project detail queries
  const { data: projectConsumption = [] } = useQuery({
    queryKey: ['projectConsumption', openProject?.id],
    queryFn: () => fetchProjectConsumption(openProject.id),
    enabled: !!openProject
  });

  // The instances, with their costs in the selected month
  const { data: projectInstances = [] } = useQuery({
    queryKey: ['projectInstances', openProject?.id, selectedMonth?.from, selectedMonth?.to],
    queryFn: () => fetchProjectInstances(openProject.id, selectedMonth.from, selectedMonth.to),
    enabled: !!openProject && holdsSelectedMonth,
  });
  // The unallocated row is not an instance
  const instanceCount = projectInstances.filter(i => !i.unallocated).length;

  const { data: projectQuotas = [] } = useQuery({
    queryKey: ['projectQuotas', openProject?.id],
    queryFn: () => fetchProjectQuotas(openProject.id),
    enabled: !!openProject
  });

  // The project's volumes, snapshots, savings plans and buckets (filtered by selected month)
  const { data: projectVolumes = [] } = useQuery({
    queryKey: ['projectVolumes', openProject?.id, selectedMonth?.from, selectedMonth?.to],
    queryFn: () => fetchProjectVolumes(openProject.id, selectedMonth.from, selectedMonth.to),
    enabled: !!openProject?.id && holdsSelectedMonth
  });

  const { data: projectSnapshots = [] } = useQuery({
    queryKey: ['projectSnapshots', openProject?.id, selectedMonth?.from, selectedMonth?.to],
    queryFn: () => fetchProjectSnapshots(openProject.id, selectedMonth.from, selectedMonth.to),
    enabled: !!openProject?.id && holdsSelectedMonth
  });

  const { data: projectSavingsPlans = [] } = useQuery({
    queryKey: ['projectSavingsPlans', openProject?.id, selectedMonth?.from, selectedMonth?.to],
    queryFn: () => fetchProjectSavingsPlans(openProject.id, selectedMonth.from, selectedMonth.to),
    enabled: !!openProject?.id && holdsSelectedMonth
  });

  const { data: projectBuckets = [] } = useQuery({
    queryKey: ['projectBuckets', openProject?.id, selectedMonth?.from, selectedMonth?.to],
    queryFn: () => fetchProjectBuckets(openProject.id, selectedMonth.from, selectedMonth.to),
    enabled: !!openProject && holdsSelectedMonth
  });

  // The project's other services of the selected month, its registry among them (#145)
  const { data: projectOtherServices = NO_OTHER_SERVICES } = useQuery({
    queryKey: ['projectOtherServices', openProject?.id, selectedMonth?.from, selectedMonth?.to],
    queryFn: () => fetchProjectOtherServices(openProject.id, selectedMonth.from, selectedMonth.to),
    enabled: !!openProject && holdsSelectedMonth
  });

  // Project instance total cost (filtered by selected month)
  const { data: projectInstanceTotal } = useQuery({
    queryKey: ['projectInstanceTotal', openProject?.id, selectedMonth?.from, selectedMonth?.to],
    queryFn: () => fetchProjectInstanceTotal(openProject.id, selectedMonth.from, selectedMonth.to),
    enabled: !!openProject && holdsSelectedMonth
  });

  // Public Cloud stats (Kubernetes, S3, Registry, etc.)
  const { data: publicCloudStats } = useQuery(accountQuery(selectedAccount, {
    key: ['publicCloudStats', selectedMonth?.from, selectedMonth?.to],
    fetch: (account) => fetchPublicCloudStats(selectedMonth.from, selectedMonth.to, account),
    enabled: holdsSelectedMonth && activeTab === 'inventory',
  }));

  // The AI Endpoints models of the month (#193), the projects together, as the figures of the
  // month: those of the account shown
  const { data: aiEndpoints } = useQuery(accountQuery(selectedAccount, {
    key: ['aiEndpoints', selectedMonth?.from, selectedMonth?.to],
    fetch: (account) => fetchAiEndpoints(selectedMonth.from, selectedMonth.to, account),
    enabled: holdsSelectedMonth && activeTab === 'inventory',
  }));

  return {
    sortingOf,
    showAllBuckets,
    setShowAllBuckets,
    showAllInstances,
    setShowAllInstances,
    showAllVolumes,
    setShowAllVolumes,
    showAllSnapshots,
    setShowAllSnapshots,
    showAllSavingsPlans,
    setShowAllSavingsPlans,
    projectsEnriched,
    projectsLoaded,
    openProject,
    projectConsumption,
    projectInstances,
    instanceCount,
    projectQuotas,
    projectVolumes,
    projectSnapshots,
    projectSavingsPlans,
    projectBuckets,
    projectInstanceTotal,
    projectOtherServices,
    publicCloudStats,
    aiEndpoints,
  };
};

export { usePublicCloudTab };
