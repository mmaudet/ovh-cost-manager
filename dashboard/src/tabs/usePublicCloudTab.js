// The Public Cloud tab's state and data queries, in a hook that the dashboard shell calls
// on every render: see docs/adr/0001-tab-state-lives-in-the-dashboard-shell.md

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  fetchProjectsEnriched, fetchProjectConsumption, fetchProjectInstances, fetchProjectQuotas,
  fetchProjectVolumes, fetchProjectSnapshots, fetchProjectSavingsPlans, fetchProjectBuckets,
  fetchProjectInstanceTotal, fetchPublicCloudStats,
} from '../services/api.js';

// The selected project is the shell's, not the tab's (#36): the Overview opens a project
// on this tab, and the logo closes it. The hook reads it, as it reads the selected month.
const usePublicCloudTab = ({ selectedMonth, activeTab, selectedProject }) => {
  const [showAllBuckets, setShowAllBuckets] = useState(false);
  const [showAllInstances, setShowAllInstances] = useState(false);
  const [showAllVolumes, setShowAllVolumes] = useState(false);
  const [showAllSnapshots, setShowAllSnapshots] = useState(false);
  const [showAllSavingsPlans, setShowAllSavingsPlans] = useState(false);

  // Enriched projects for the Public Cloud tab
  const { data: projectsEnriched = [] } = useQuery({
    queryKey: ['projectsEnriched'],
    queryFn: fetchProjectsEnriched,
    enabled: activeTab === 'inventory'
  });

  // Project detail queries
  const { data: projectConsumption = [] } = useQuery({
    queryKey: ['projectConsumption', selectedProject?.id],
    queryFn: () => fetchProjectConsumption(selectedProject.id),
    enabled: !!selectedProject
  });

  // The instances, with their costs in the selected month
  const { data: projectInstances = [] } = useQuery({
    queryKey: ['projectInstances', selectedProject?.id, selectedMonth?.from, selectedMonth?.to],
    queryFn: () => fetchProjectInstances(selectedProject.id, selectedMonth.from, selectedMonth.to),
    enabled: !!selectedProject && !!selectedMonth,
  });
  // The unallocated row is not an instance
  const instanceCount = projectInstances.filter(i => !i.unallocated).length;

  const { data: projectQuotas = [] } = useQuery({
    queryKey: ['projectQuotas', selectedProject?.id],
    queryFn: () => fetchProjectQuotas(selectedProject.id),
    enabled: !!selectedProject
  });

  // The project's volumes, snapshots, savings plans and buckets (filtered by selected month)
  const { data: projectVolumes = [] } = useQuery({
    queryKey: ['projectVolumes', selectedProject?.id, selectedMonth?.from, selectedMonth?.to],
    queryFn: () => fetchProjectVolumes(selectedProject.id, selectedMonth.from, selectedMonth.to),
    enabled: !!selectedProject?.id && !!selectedMonth
  });

  const { data: projectSnapshots = [] } = useQuery({
    queryKey: ['projectSnapshots', selectedProject?.id, selectedMonth?.from, selectedMonth?.to],
    queryFn: () => fetchProjectSnapshots(selectedProject.id, selectedMonth.from, selectedMonth.to),
    enabled: !!selectedProject?.id && !!selectedMonth
  });

  const { data: projectSavingsPlans = [] } = useQuery({
    queryKey: ['projectSavingsPlans', selectedProject?.id, selectedMonth?.from, selectedMonth?.to],
    queryFn: () => fetchProjectSavingsPlans(selectedProject.id, selectedMonth.from, selectedMonth.to),
    enabled: !!selectedProject?.id && !!selectedMonth
  });

  const { data: projectBuckets = [] } = useQuery({
    queryKey: ['projectBuckets', selectedProject?.id, selectedMonth?.from, selectedMonth?.to],
    queryFn: () => fetchProjectBuckets(selectedProject.id, selectedMonth.from, selectedMonth.to),
    enabled: !!selectedProject && !!selectedMonth
  });

  // Project instance total cost (filtered by selected month)
  const { data: projectInstanceTotal } = useQuery({
    queryKey: ['projectInstanceTotal', selectedProject?.id, selectedMonth?.from, selectedMonth?.to],
    queryFn: () => fetchProjectInstanceTotal(selectedProject.id, selectedMonth.from, selectedMonth.to),
    enabled: !!selectedProject && !!selectedMonth
  });

  // Public Cloud stats (Kubernetes, S3, Registry, etc.)
  const { data: publicCloudStats } = useQuery({
    queryKey: ['publicCloudStats', selectedMonth?.from, selectedMonth?.to],
    queryFn: () => fetchPublicCloudStats(selectedMonth.from, selectedMonth.to),
    enabled: !!selectedMonth && activeTab === 'inventory'
  });

  return {
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
    projectConsumption,
    projectInstances,
    instanceCount,
    projectQuotas,
    projectVolumes,
    projectSnapshots,
    projectSavingsPlans,
    projectBuckets,
    projectInstanceTotal,
    publicCloudStats,
  };
};

export { usePublicCloudTab };
