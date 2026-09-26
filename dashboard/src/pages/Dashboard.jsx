import { useState, useEffect, useRef, Fragment } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend
} from 'recharts';
import {
  fetchMonths, fetchSummary, fetchByProject, fetchByService,
  fetchImportStatus, fetchConfig, fetchUser,
  fetchConsumptionCurrent, fetchConsumptionForecast,
  fetchExpiringServices,
  fetchByResourceType, fetchProjectsEnriched, fetchProjectConsumption,
  fetchProjectInstances, fetchProjectQuotas, fetchGpuSummary, fetchPublicCloudStats,
  fetchProjectBuckets, fetchProjectInstanceTotal, triggerImport,
  fetchProjectVolumes, fetchProjectSnapshots, fetchProjectSavingsPlans
} from '../services/api';
import { useLanguage } from '../hooks/useLanguage.jsx';
import Logo from '../components/Logo';
import Accordion from '../components/Accordion.jsx';
import Modal from '../components/Modal.jsx';
import TableActions from '../components/TableActions.jsx';
import { BucketsTable, bucketCsvColumns, sortBucketsByName } from '../components/BucketsTable.jsx';
import { SavingsPlansTable, savingsPlanCsvColumns } from '../components/SavingsPlansTable.jsx';
import { VolumesTable, volumeCsvColumns, volumeCsvRows } from '../components/VolumesTable.jsx';
import { SnapshotsTable, snapshotCsvColumns } from '../components/SnapshotsTable.jsx';
import {
  InstancesTable, instanceCsvColumns, instanceCsvRows
} from '../components/InstancesTable.jsx';
import { SortIcon } from '../components/SortIcon.jsx';
import { downloadCSV } from '../utils/csv.js';
import { formatCurrency } from '../utils/format.js';
import { parseSqliteDate } from '../utils/sqliteDate.js';
import { generateMarkdownReport } from '../utils/markdownReport.js';
import { useWebCloudTab } from '../tabs/useWebCloudTab.js';
import { WebCloudTab, WebCloudTabModals } from '../tabs/WebCloudTab.jsx';
import { useBackupTab } from '../tabs/useBackupTab.js';
import { BackupTab } from '../tabs/BackupTab.jsx';
import { useTrendsTab } from '../tabs/useTrendsTab.js';
import { TrendsTab, TrendsPeriodSelector } from '../tabs/TrendsTab.jsx';
import { useInfrastructureTab } from '../tabs/useInfrastructureTab.js';
import { InfrastructureTab, InfrastructureTabModals } from '../tabs/InfrastructureTab.jsx';
import ProjectProductComparison from './ProjectProductComparison.jsx';

// Translation keys for the import_log type and status values
const IMPORT_TYPE_KEYS = {
  full: 'importTypeFull',
  period: 'importTypePeriod',
  differential: 'importTypeDifferential'
};
const IMPORT_STATUS_KEYS = {
  running: 'importStatusRunning',
  success: 'importStatusSuccess',
  failed: 'importStatusFailed',
  partial: 'importStatusPartial'
};

export default function Dashboard() {
  const { language, setLanguage, t } = useLanguage();
  const [selectedMonth, setSelectedMonth] = useState(null);
  const [compareMonthA, setCompareMonthA] = useState(null);
  const [compareMonthB, setCompareMonthB] = useState(null);
  const [activeTab, setActiveTab] = useState('overview');
  const [budget, setBudget] = useState(50000); // Default budget
  const [projectSort, setProjectSort] = useState({ column: 'total', direction: 'desc' });
  const [compareSort, setCompareSort] = useState({ column: 'totalA', direction: 'desc' });
  const [syncWarningDismissed, setSyncWarningDismissed] = useState(false);
  const [selectedProject, setSelectedProject] = useState(null);
  const [selectedResourceType, setSelectedResourceType] = useState(null);
  const [showAllBuckets, setShowAllBuckets] = useState(false);
  const [showAllInstances, setShowAllInstances] = useState(false);
  const [showAllVolumes, setShowAllVolumes] = useState(false);
  const [showAllSnapshots, setShowAllSnapshots] = useState(false);
  const [showAllSavingsPlans, setShowAllSavingsPlans] = useState(false);

  // Helper to format currency with current language
  const fmt = (value) => formatCurrency(value, language);
  const locale = language === 'en' ? 'en-US' : 'fr-FR';

  // Human-readable byte size (decimal units, like the OVH manager)
  const fmtBytes = (bytes) => {
    if (bytes === null || bytes === undefined) return '-';
    if (bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
    const i = Math.min(Math.floor(Math.log10(bytes) / 3), units.length - 1);
    const value = bytes / Math.pow(1000, i);
    return `${value.toFixed(value < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
  };

  // Sort projects helper
  const sortProjects = (projects, sortConfig) => {
    if (!projects) return [];
    return [...projects].sort((a, b) => {
      let aVal, bVal;
      if (sortConfig.column === 'name') {
        aVal = a.projectName?.toLowerCase() || '';
        bVal = b.projectName?.toLowerCase() || '';
      } else {
        aVal = a.total || 0;
        bVal = b.total || 0;
      }
      if (aVal < bVal) return sortConfig.direction === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });
  };

  const handleProjectSort = (column) => {
    setProjectSort(prev => ({
      column,
      direction: prev.column === column && prev.direction === 'desc' ? 'asc' : 'desc'
    }));
  };

  const handleCompareSort = (column) => {
    setCompareSort(prev => ({
      column,
      direction: prev.column === column && prev.direction === 'desc' ? 'asc' : 'desc'
    }));
  };

  // Merge and sort comparison data
  const getSortedCompareProjects = () => {
    if (!byProjectA.length) return [];
    const merged = byProjectA.map(p => {
      const pB = byProjectB.find(proj => proj.projectName === p.projectName) || { total: 0 };
      // Variation: how MoisB changed compared to MoisA (reference)
      const diff = p.total ? ((pB.total - p.total) / p.total * 100) : null;
      return { ...p, totalB: pB.total, diff };
    });
    return merged.sort((a, b) => {
      let aVal, bVal;
      if (compareSort.column === 'name') {
        aVal = a.projectName?.toLowerCase() || '';
        bVal = b.projectName?.toLowerCase() || '';
      } else if (compareSort.column === 'totalA') {
        aVal = a.total || 0;
        bVal = b.total || 0;
      } else if (compareSort.column === 'totalB') {
        aVal = a.totalB || 0;
        bVal = b.totalB || 0;
      } else if (compareSort.column === 'diff') {
        aVal = a.diff ?? -Infinity;
        bVal = b.diff ?? -Infinity;
      }
      if (aVal < bVal) return compareSort.direction === 'asc' ? -1 : 1;
      if (aVal > bVal) return compareSort.direction === 'asc' ? 1 : -1;
      return 0;
    });
  };

  // Fetch config (budget)
  const { data: configData } = useQuery({
    queryKey: ['config'],
    queryFn: fetchConfig
  });

  // Fetch current user
  const { data: userData } = useQuery({
    queryKey: ['user'],
    queryFn: fetchUser
  });

  // Update budget when config loads
  useEffect(() => {
    if (configData?.budget) {
      setBudget(configData.budget);
    }
  }, [configData]);

  // Fetch available months
  const { data: months = [] } = useQuery({
    queryKey: ['months'],
    queryFn: fetchMonths
  });

  // Set default months when data loads
  useEffect(() => {
    if (months.length > 0 && !selectedMonth) {
      setSelectedMonth(months[0]);
      // Pour la comparaison :
      // A = mois précédent, B = mois courant
      if (months.length > 1) {
        setCompareMonthA(months[1]);
        setCompareMonthB(months[0]);
      } else {
        setCompareMonthA(months[0]);
        setCompareMonthB(months[0]);
      }
    }
  }, [months, selectedMonth]);

  // Fetch data for selected month
  const { data: summary, isLoading: loadingSummary } = useQuery({
    queryKey: ['summary', selectedMonth?.from, selectedMonth?.to],
    queryFn: () => fetchSummary(selectedMonth.from, selectedMonth.to),
    enabled: !!selectedMonth
  });

  const { data: byService = [] } = useQuery({
    queryKey: ['byService', selectedMonth?.from, selectedMonth?.to],
    queryFn: () => fetchByService(selectedMonth.from, selectedMonth.to),
    enabled: !!selectedMonth
  });

  const { data: byProject = [] } = useQuery({
    queryKey: ['byProject', selectedMonth?.from, selectedMonth?.to],
    queryFn: () => fetchByProject(selectedMonth.from, selectedMonth.to),
    enabled: !!selectedMonth
  });

  const trendsTab = useTrendsTab({ months, activeTab });

  // Comparison data
  const { data: compareDataA } = useQuery({
    queryKey: ['summary', compareMonthA?.from, compareMonthA?.to],
    queryFn: () => fetchSummary(compareMonthA.from, compareMonthA.to),
    enabled: !!compareMonthA && activeTab === 'compare'
  });

  const { data: compareDataB } = useQuery({
    queryKey: ['summary', compareMonthB?.from, compareMonthB?.to],
    queryFn: () => fetchSummary(compareMonthB.from, compareMonthB.to),
    enabled: !!compareMonthB && activeTab === 'compare'
  });

  const { data: byServiceA = [] } = useQuery({
    queryKey: ['byService', compareMonthA?.from, compareMonthA?.to],
    queryFn: () => fetchByService(compareMonthA.from, compareMonthA.to),
    enabled: !!compareMonthA && activeTab === 'compare'
  });

  const { data: byServiceB = [] } = useQuery({
    queryKey: ['byService', compareMonthB?.from, compareMonthB?.to],
    queryFn: () => fetchByService(compareMonthB.from, compareMonthB.to),
    enabled: !!compareMonthB && activeTab === 'compare'
  });

  const { data: byProjectA = [] } = useQuery({
    queryKey: ['byProject', compareMonthA?.from, compareMonthA?.to],
    queryFn: () => fetchByProject(compareMonthA.from, compareMonthA.to),
    enabled: !!compareMonthA && activeTab === 'compare'
  });

  const { data: byProjectB = [] } = useQuery({
    queryKey: ['byProject', compareMonthB?.from, compareMonthB?.to],
    queryFn: () => fetchByProject(compareMonthB.from, compareMonthB.to),
    enabled: !!compareMonthB && activeTab === 'compare'
  });

  const { data: importStatus } = useQuery({
    queryKey: ['importStatus'],
    queryFn: fetchImportStatus,
    // Poll while an import is in progress so the footer follows it, every
    // 30 s to stay well below the general API rate limit (100 requests per
    // 15 minutes per IP by default)
    refetchInterval: (query) => (query.state.data?.running ? 30000 : false)
  });

  // Manual resync
  const queryClient = useQueryClient();
  const [syncFeedback, setSyncFeedback] = useState(null); // { type: 'ok'|'error', msg }
  const resync = useMutation({
    mutationFn: triggerImport,
    onSuccess: () => {
      setSyncFeedback({ type: 'ok', msg: t('syncStarted') });
      // The import runs in the background; refresh status a bit later.
      setTimeout(() => queryClient.invalidateQueries({ queryKey: ['importStatus'] }), 8000);
    },
    onError: (err) => {
      const status = err?.response?.status;
      const key = status === 429 ? 'syncRateLimited'
        : err?.response?.data?.error === 'syncDisabled' ? 'syncDisabled'
        : status === 409 ? 'syncRunning'
        : 'syncError';
      setSyncFeedback({ type: 'error', msg: t(key) });
    }
  });

  // Once the latest import has finished, refresh every query built from
  // imported data (all of them but config, user and the import status).
  const latestImport = importStatus?.latest;
  const previousImport = useRef(latestImport);
  useEffect(() => {
    const previous = previousImport.current;
    previousImport.current = latestImport;
    if (!previous || !latestImport || latestImport.status === 'running') return;
    if (previous.id !== latestImport.id || previous.status === 'running') {
      queryClient.invalidateQueries({
        predicate: (query) => !['config', 'user', 'importStatus'].includes(query.queryKey[0])
      });
    }
  }, [latestImport, queryClient]);

  // Phase 1: Consumption data
  const { data: consumptionCurrent } = useQuery({
    queryKey: ['consumptionCurrent'],
    queryFn: fetchConsumptionCurrent
  });

  const { data: consumptionForecast } = useQuery({
    queryKey: ['consumptionForecast'],
    queryFn: fetchConsumptionForecast
  });


  const infrastructureTab = useInfrastructureTab({
    selectedMonth, activeTab, selectedResourceType,
  });
  const { inventoryServers } = infrastructureTab;

  const { data: expiringServices = [] } = useQuery({
    queryKey: ['expiringServices'],
    queryFn: () => fetchExpiringServices(30)
  });

  const webCloudTab = useWebCloudTab({ selectedMonth, activeTab });

  const { data: byResourceType = [] } = useQuery({
    queryKey: ['byResourceType', selectedMonth?.from, selectedMonth?.to],
    queryFn: () => fetchByResourceType(selectedMonth.from, selectedMonth.to),
    enabled: !!selectedMonth
  });

  // Enriched projects for inventory tab
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

  const { data: projectInstances = [] } = useQuery({
    queryKey: ['projectInstances', selectedProject?.id, selectedMonth?.from, selectedMonth?.to],
    queryFn: () => fetchProjectInstances(selectedProject.id, selectedMonth?.from, selectedMonth?.to),
    enabled: !!selectedProject
  });
  // The unallocated row is not an instance
  const instanceCount = projectInstances.filter(i => !i.unallocated).length;

  const { data: projectQuotas = [] } = useQuery({
    queryKey: ['projectQuotas', selectedProject?.id],
    queryFn: () => fetchProjectQuotas(selectedProject.id),
    enabled: !!selectedProject
  });

  // Project buckets (filtered by selected month)
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

  // GPU cost summary — filtered by selected month (for overview)
  const { data: gpuSummary } = useQuery({
    queryKey: ['gpuSummary', selectedMonth?.from, selectedMonth?.to],
    queryFn: () => fetchGpuSummary(selectedMonth.from, selectedMonth.to),
    enabled: !!selectedMonth
  });

  // Public Cloud stats (Kubernetes, S3, Registry, etc.)
  const { data: publicCloudStats } = useQuery({
    queryKey: ['publicCloudStats', selectedMonth?.from, selectedMonth?.to],
    queryFn: () => fetchPublicCloudStats(selectedMonth.from, selectedMonth.to),
    enabled: !!selectedMonth && activeTab === 'inventory'
  });

  const backupTab = useBackupTab({ selectedMonth, activeTab });

  // Check if previous month exists
  const previousMonthExists = selectedMonth && months.length > 1 &&
    months.findIndex(m => m.value === selectedMonth.value) < months.length - 1;

  // Calculations
  const total = summary?.total || 0;
  const previousTotal = compareDataB?.total || 0;
  const variation = previousMonthExists && previousTotal ? ((total - previousTotal) / previousTotal * 100).toFixed(1) : null;
  const budgetUsage = budget ? (total / budget * 100).toFixed(0) : 0;

  // Comparison chart data
  const comparisonChartData = byServiceA.map((s) => {
    const matchB = byServiceB.find(b => b.name === s.name);
    return {
      name: s.name,
      moisA: s.value,
      moisB: matchB?.value || 0
    };
  });

  // Loading state
  if (!selectedMonth || loadingSummary) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 flex items-center justify-center">
        <div className="text-center">
          <div className="text-4xl mb-4">Loading...</div>
          <p className="text-gray-500">{t('loading')}</p>
        </div>
      </div>
    );
  }

  const totalVariation = compareDataA && compareDataB && compareDataA.total
    ? ((compareDataB.total - compareDataA.total) / compareDataA.total * 100).toFixed(1)
    : 0;

  // Calculate days since last import
  const daysSinceLastImport = importStatus?.latest?.completed_at
    ? Math.floor((new Date() - new Date(importStatus.latest.completed_at)) / (1000 * 60 * 60 * 24))
    : null;
  const showSyncWarning = daysSinceLastImport !== null && daysSinceLastImport > 30 && !syncWarningDismissed;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 p-4 md:p-6">
      <div className="max-w-6xl mx-auto space-y-6">

        {/* Sync Warning Banner */}
        {showSyncWarning && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-amber-600 text-xl">⚠️</span>
              <p className="text-amber-800 text-sm">
                {t('syncWarning')} <strong>{daysSinceLastImport}</strong> {t('syncWarningDays')}.{' '}
                {t('syncWarningAction')} <code className="bg-amber-100 px-1 rounded">npm run import:diff</code> {t('syncWarningToUpdate')}
              </p>
            </div>
            <button
              onClick={() => setSyncWarningDismissed(true)}
              className="text-amber-600 hover:text-amber-800 text-sm font-medium px-3 py-1 hover:bg-amber-100 rounded"
            >
              {t('dismiss')}
            </button>
          </div>
        )}

        {/* Header */}
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <button onClick={() => { setActiveTab('overview'); setSelectedProject(null); }} className="cursor-pointer">
              <Logo className="h-40" />
            </button>
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-2xl font-bold text-gray-900">{t('appTitle')}</h1>
                <select
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                  className="px-2 py-1 text-xs bg-gray-100 border border-gray-200 rounded cursor-pointer"
                >
                  <option value="fr">FR</option>
                  <option value="en">EN</option>
                </select>
              </div>
              <p className="text-gray-500 text-sm">{t('appSubtitle')}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {/* Manual resync */}
            <button
              onClick={() => { setSyncFeedback(null); resync.mutate(); }}
              disabled={resync.isPending}
              title={t('resync')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                resync.isPending
                  ? 'bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed'
                  : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50 cursor-pointer'
              }`}
            >
              <span className={resync.isPending ? 'animate-spin' : ''}>⟳</span>
              <span>{resync.isPending ? t('syncing') : t('resync')}</span>
            </button>
            {/* Expiration badge */}
            {expiringServices.length > 0 && (
              <div className="flex items-center gap-1 px-3 py-1.5 bg-orange-100 text-orange-700 rounded-lg text-sm font-medium">
                <span>{expiringServices.length}</span>
                <span>{t('expiringSoon')}</span>
              </div>
            )}
            {/* User info */}
            {userData?.id && (
              <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-100 rounded-lg">
                <span className="text-sm text-gray-700">{userData.name}</span>
                {userData.authEnabled && (
                  <a
                    href="/auth/logout"
                    className="text-xs text-gray-500 hover:text-red-600 ml-1"
                    title={t('logout') || 'Logout'}
                  >
                    ✕
                  </a>
                )}
              </div>
            )}
            {activeTab !== 'compare' && (
              <>
                <select
                  value={selectedMonth?.value || ''}
                  onChange={(e) => {
                    const month = months.find(m => m.value === e.target.value);
                    setSelectedMonth(month);
                  }}
                  className="px-4 py-2 bg-white border border-gray-200 rounded-lg text-sm shadow-sm cursor-pointer"
                >
                  {months.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-600">{t('export')}:</span>
                  <select
                    onChange={(e) => {
                      const format = e.target.value;
                      if (format === 'md') {
                        const md = generateMarkdownReport(summary, byService, byProject, selectedMonth, language);
                        const blob = new Blob([md], { type: 'text/markdown' });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = `ovh-report-${selectedMonth?.value || 'report'}.md`;
                        a.click();
                        URL.revokeObjectURL(url);
                      } else if (format === 'pdf') {
                        window.print();
                      }
                      e.target.value = '';
                    }}
                    className="px-3 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium cursor-pointer"
                    defaultValue=""
                  >
                    <option value="" disabled>{t('choose')}</option>
                    <option value="md">{t('markdown')}</option>
                    <option value="pdf">{t('pdf')}</option>
                  </select>
                </div>
              </>
            )}
          </div>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white rounded-xl p-5 shadow-sm border-2 border-blue-500">
            <div className="flex justify-between items-start mb-3">
              <span className="text-gray-500 text-sm font-medium">{t('totalCost')}</span>
            </div>
            <div className="text-2xl font-bold text-gray-900">{fmt(total)}€</div>
            {variation !== null ? (
              <div className={`flex items-center mt-2 text-sm ${Number(variation) > 0 ? 'text-red-500' : 'text-green-500'}`}>
                {Number(variation) > 0 ? '+' : ''}{variation}% {t('vsPreviousMonth')}
              </div>
            ) : (
              <div className="flex items-center mt-2 text-sm text-gray-400">
                {t('noPreviousData')}
              </div>
            )}
          </div>

          <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
            <div className="flex justify-between items-start mb-3">
              <span className="text-gray-500 text-sm font-medium">{t('cloudTotal')}</span>
            </div>
            <div className="text-2xl font-bold text-gray-900">{fmt(summary?.cloudTotal || 0)}€</div>
            <div className="text-sm text-gray-500 mt-2">{t('publicCloud')}</div>
          </div>

          <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
            <div className="flex justify-between items-start mb-3">
              <span className="text-gray-500 text-sm font-medium">{t('dailyAverage')}</span>
            </div>
            <div className="text-2xl font-bold text-gray-900">{fmt(summary?.dailyAverage || 0)}€</div>
            <div className="text-sm text-gray-500 mt-2">{t('over30Days')}</div>
          </div>

          <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
            <div className="flex justify-between items-start mb-3">
              <span className="text-gray-500 text-sm font-medium">{t('activeProjects')}</span>
            </div>
            <div className="text-2xl font-bold text-gray-900">{summary?.projectsCount || 0}</div>
            <div className="text-sm text-gray-500 mt-2">{t('withConsumption')}</div>
          </div>
        </div>

        {/* Phase 1: Consumption KPI Cards */}
        {(consumptionCurrent || byResourceType.length > 0) && (
          <div className="grid grid-cols-3 gap-4">
            {consumptionCurrent && (
              <div className="bg-white rounded-xl p-5 shadow-sm border-2 border-emerald-500">
                <div className="flex justify-between items-start mb-3">
                  <span className="text-gray-500 text-sm font-medium">{t('currentConsumption')}</span>
                  <span className="text-xs text-gray-400">{new Date().toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' })}</span>
                </div>
                <div className="text-2xl font-bold text-gray-900">{fmt(consumptionCurrent.current_total || 0)}€</div>
                {consumptionForecast?.progress > 0 && (
                  <div className="w-full bg-gray-200 rounded-full h-1.5 mt-3">
                    <div
                      className="h-1.5 rounded-full bg-emerald-500 transition-all"
                      style={{ width: `${Math.min(consumptionForecast.progress, 100)}%` }}
                    />
                  </div>
                )}
                <div className="text-sm text-gray-500 mt-1">
                  {consumptionCurrent.source === 'cloud_projects'
                    ? `Public Cloud · ${consumptionCurrent.project_count || ''} ${t('cloudProjects').toLowerCase()}`
                    : consumptionCurrent.period_start && consumptionCurrent.period_end
                      ? `${consumptionCurrent.period_start} → ${consumptionCurrent.period_end}`
                      : t('forecastEndOfMonth')}
                </div>
              </div>
            )}
            {consumptionForecast && (
              <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
                <div className="flex justify-between items-start mb-3">
                  <span className="text-gray-500 text-sm font-medium">{t('forecastEndOfMonth')}</span>
                  <span className="text-xs text-gray-400">{new Date().toLocaleDateString(locale, { month: 'long', year: 'numeric' })}</span>
                </div>
                <div className="text-2xl font-bold text-gray-900">{fmt(consumptionForecast.forecast_total || 0)}€</div>
                {consumptionForecast.progress > 0 && (
                  <div className="w-full bg-gray-200 rounded-full h-1.5 mt-3">
                    <div
                      className="h-1.5 rounded-full bg-blue-500 transition-all"
                      style={{ width: `${Math.min(consumptionForecast.progress, 100)}%` }}
                    />
                  </div>
                )}
                <div className="text-sm text-gray-500 mt-1">
                  {consumptionForecast.forecast_total > budget
                    ? <span className="text-red-500 font-medium">{`> ${t('budget')}!`}</span>
                    : consumptionForecast.days_elapsed
                      ? `${consumptionForecast.days_elapsed}/${consumptionForecast.days_in_month} ${t('days') || 'jours'}`
                      : t('forecastEndOfMonth')}
                </div>
              </div>
            )}
            {byResourceType.length > 0 && (() => {
              const srvCount = byResourceType.find(r => r.resource_type === 'dedicated_server')?.serviceCount || 0;
              const vpsCount = byResourceType.find(r => r.resource_type === 'vps')?.serviceCount || 0;
              const cloudCount = byResourceType.find(r => r.resource_type === 'cloud_project')?.serviceCount || 0;
              const totalCount = byResourceType.reduce((sum, r) => sum + (r.serviceCount || 0), 0);
              return (
                <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
                  <div className="flex justify-between items-start mb-3">
                    <span className="text-gray-500 text-sm font-medium">{t('totalResources')}</span>
                  </div>
                  <div className="text-2xl font-bold text-gray-900">{totalCount}</div>
                  <div className="text-sm text-gray-500 mt-2">
                    {srvCount} {t('dedicatedServers')} · {vpsCount} {t('vpsInstances')} · {cloudCount} {t('cloudProjects')}
                  </div>
                </div>
              );
            })()}
          </div>
        )}

        {/* Tabs */}
        <div className="flex items-center gap-4">
          <div className="flex gap-1 bg-white p-1 rounded-xl shadow-sm">
            {[
              { id: 'overview', labelKey: 'overview' },
              { id: 'compare', labelKey: 'compare' },
              { id: 'trends', labelKey: 'trends' },
              { id: 'inventory', labelKey: 'inventory' },
              { id: 'webcloud', labelKey: 'webCloud' },
              { id: 'infrastructure', labelKey: 'infrastructure' },
              { id: 'backup', labelKey: 'backup' },
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => { setActiveTab(tab.id); if (tab.id !== 'infrastructure') setSelectedResourceType(null); }}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                  activeTab === tab.id
                    ? 'bg-blue-600 text-white shadow-md'
                    : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                {t(tab.labelKey)}
              </button>
            ))}
          </div>
          {activeTab === 'trends' && (
            <TrendsPeriodSelector {...trendsTab} t={t} />
          )}
        </div>

        {/* Tab Content - Overview */}
        {activeTab === 'overview' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Pie Chart */}
            <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
              <h3 className="font-semibold text-gray-900 mb-4">{t('serviceBreakdown')}</h3>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={byService}
                      cx="50%"
                      cy="50%"
                      innerRadius={50}
                      outerRadius={80}
                      dataKey="value"
                      label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                      labelLine={false}
                    >
                      {byService.map((entry, i) => (
                        <Cell key={i} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v) => `${fmt(v)}€`} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="grid grid-cols-2 gap-2 mt-4">
                {byService.map(s => (
                  <div key={s.name} className="flex items-center gap-2 text-sm">
                    <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: s.color }} />
                    <span className="text-gray-600 truncate">{s.name}</span>
                    <span className="ml-auto font-medium">{fmt(s.value)}€</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Bar Chart */}
            <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
              <h3 className="font-semibold text-gray-900 mb-4">{t('topProjects')}</h3>
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={byProject.slice(0, 10)} layout="vertical" margin={{ left: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} />
                    <XAxis type="number" tickFormatter={(v) => `${v}€`} />
                    <YAxis dataKey="projectName" type="category" width={150} tick={{ fontSize: 10 }} />
                    <Tooltip formatter={(v) => `${fmt(v)}€`} />
                    <Bar
                      dataKey="total"
                      fill="#3b82f6"
                      radius={[0, 4, 4, 0]}
                      cursor="pointer"
                      onClick={(data) => {
                        if (data?.projectId) {
                          setSelectedProject({ id: data.projectId, name: data.projectName });
                          setActiveTab('inventory');
                        }
                      }}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Resource Type Breakdown (Phase 3) */}
            {byResourceType.length > 0 && (
              <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100 lg:col-span-2">
                <h3 className="font-semibold text-gray-900 mb-4">{t('resourceTypeBreakdown')}</h3>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={byResourceType}
                          cx="50%"
                          cy="50%"
                          innerRadius={50}
                          outerRadius={80}
                          dataKey="value"
                          label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                          labelLine={false}
                        >
                          {byResourceType.map((entry, i) => (
                            <Cell key={i} fill={entry.color} />
                          ))}
                        </Pie>
                        <Tooltip formatter={(v) => `${fmt(v)}€`} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="flex flex-col justify-center gap-2">
                    {byResourceType.map(s => (
                      <div key={s.name} className="flex items-center gap-2 text-sm">
                        <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: s.color }} />
                        <span className="text-gray-600">{s.name}</span>
                        <span className="ml-auto font-medium">{fmt(s.value)}€</span>
                      </div>
                    ))}
                    <button
                      onClick={() => { setActiveTab('infrastructure'); setSelectedResourceType(null); }}
                      className="text-xs text-blue-600 hover:underline mt-1 text-left"
                    >
                      {language === 'en' ? 'View infrastructure detail →' : 'Voir le détail infrastructure →'}
                    </button>
                    {byResourceType.some(r => ['domain', 'web_cloud'].includes(r.resource_type)) && (
                      <button
                        onClick={() => { setActiveTab('webcloud'); setSelectedResourceType(null); }}
                        className="text-xs text-blue-600 hover:underline text-left"
                      >
                        {language === 'en' ? 'View Web Cloud detail (domains) →' : 'Voir le détail Web Cloud (domaines) →'}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* GPU Cost Consolidation */}
            {gpuSummary && gpuSummary.total > 0 && (
              <div className="bg-white rounded-xl p-5 shadow-sm border-2 border-purple-300 lg:col-span-2">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-semibold text-gray-900">{t('gpuCosts')}</h3>
                  <div className="flex items-center gap-2">
                    <span className="text-2xl font-bold text-purple-700">{fmt(gpuSummary.total)}€</span>
                    {summary?.cloudTotal > 0 && (
                      <span className="text-sm text-gray-500">
                        ({((gpuSummary.total / summary.cloudTotal) * 100).toFixed(1)}% {language === 'en' ? 'of cloud' : 'du cloud'})
                      </span>
                    )}
                  </div>
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {/* GPU by model */}
                  <div>
                    <h4 className="text-sm font-medium text-gray-600 mb-3">{t('gpuByModel')}</h4>
                    <div className="h-48">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={gpuSummary.byModel}
                            cx="50%"
                            cy="50%"
                            innerRadius={35}
                            outerRadius={70}
                            dataKey="total"
                            nameKey="gpu_model"
                            label={({ gpu_model, total }) => `${gpu_model}: ${fmt(total)}€`}
                            labelLine={false}
                          >
                            {gpuSummary.byModel.map((entry, i) => (
                              <Cell key={i} fill={entry.color} />
                            ))}
                          </Pie>
                          <Tooltip formatter={(v) => `${fmt(v)}€`} />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="space-y-1 mt-2">
                      {gpuSummary.byModel.map(m => (
                        <div key={m.gpu_model} className="flex items-center gap-2 text-sm">
                          <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: m.color }} />
                          <span className="text-gray-600">{m.gpu_model}</span>
                          <span className="ml-auto font-medium">{fmt(m.total)}€</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* GPU by project */}
                  <div>
                    <h4 className="text-sm font-medium text-gray-600 mb-3">{t('gpuByProject')}</h4>
                    <div className="overflow-y-auto max-h-72">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b bg-gray-50">
                            <th className="p-2 text-left font-medium">{t('project')}</th>
                            <th className="p-2 text-left font-medium">{t('gpuFlavors')}</th>
                            <th className="p-2 text-right font-medium">{t('amount')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {gpuSummary.byProject.map(p => {
                            const pct = gpuSummary.total ? ((p.total / gpuSummary.total) * 100).toFixed(1) : 0;
                            return (
                              <tr key={p.project_id} className="border-b hover:bg-gray-50">
                                <td className="p-2">
                                  <button
                                    className="text-blue-600 hover:text-blue-800 hover:underline text-left text-xs"
                                    onClick={() => {
                                      setSelectedProject({ id: p.project_id, name: p.project_name });
                                      setActiveTab('inventory');
                                    }}
                                  >
                                    {p.project_name}
                                  </button>
                                </td>
                                <td className="p-2">
                                  <div className="flex flex-wrap gap-1">
                                    {(p.gpu_flavors || '').split(',').map(f => (
                                      <span key={f} className="px-1.5 py-0.5 bg-purple-100 text-purple-700 rounded text-xs font-medium">
                                        {f}
                                      </span>
                                    ))}
                                  </div>
                                </td>
                                <td className="p-2 text-right">
                                  <div className="font-medium">{fmt(p.total)}€</div>
                                  <div className="text-xs text-gray-400">{pct}%</div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                        <tfoot>
                          <tr className="bg-gray-50 font-semibold">
                            <td className="p-2" colSpan="2">{t('gpuTotal')}</td>
                            <td className="p-2 text-right">{fmt(gpuSummary.total)}€</td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  </div>
                </div>

              </div>
            )}

            {/* Project breakdown table */}
            <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100 lg:col-span-2">
              <h3 className="font-semibold text-gray-900 mb-4">{t('projectBreakdown')}</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-gray-50">
                      <th
                        className="p-3 text-left font-medium cursor-pointer hover:bg-gray-100 select-none"
                        onClick={() => handleProjectSort('name')}
                      >
                        {t('project')}<SortIcon column="name" current={projectSort} />
                      </th>
                      <th
                        className="p-3 text-right font-medium cursor-pointer hover:bg-gray-100 select-none"
                        onClick={() => handleProjectSort('total')}
                      >
                        {t('amount')}<SortIcon column="total" current={projectSort} />
                      </th>
                      <th className="p-3 text-right font-medium">%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortProjects(byProject, projectSort).map((p, i) => {
                      const pct = summary?.cloudTotal ? ((p.total / summary.cloudTotal) * 100).toFixed(1) : 0;
                      return (
                        <tr key={p.projectId || i} className="border-b hover:bg-gray-50">
                          <td className="p-3">
                            <button
                              className="text-blue-600 hover:text-blue-800 hover:underline text-left"
                              onClick={() => {
                                setSelectedProject({ id: p.projectId, name: p.projectName });
                                setActiveTab('inventory');
                              }}
                            >
                              {p.projectName}
                            </button>
                          </td>
                          <td className="p-3 text-right font-medium">{fmt(p.total)}€</td>
                          <td className="p-3 text-right text-gray-500">{pct}%</td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="bg-gray-50 font-semibold">
                      <td className="p-3">{t('totalCloud')}</td>
                      <td className="p-3 text-right">{fmt(summary?.cloudTotal || 0)}€</td>
                      <td className="p-3 text-right">100%</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>

            {/* Budget Progress */}
            <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100 lg:col-span-2">
              <div className="flex justify-between items-center mb-3">
                <span className="font-semibold text-gray-900">{t('budgetConsumption')}</span>
                <span className={`px-3 py-1 rounded-full text-sm font-medium ${Number(budgetUsage) > 80 ? 'bg-orange-100 text-orange-700' : 'bg-green-100 text-green-700'}`}>
                  {budgetUsage}% {t('used')}
                </span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-3 overflow-hidden">
                <div
                  className={`h-3 rounded-full transition-all duration-500 ${Number(budgetUsage) > 80 ? 'bg-orange-500' : 'bg-blue-600'}`}
                  style={{ width: `${Math.min(Number(budgetUsage), 100)}%` }}
                />
              </div>
              <div className="flex justify-between items-center mt-2 text-sm text-gray-500">
                <span>{t('consumed')}: {fmt(total)}€</span>
                <div className="flex items-center gap-1">
                  <span>{t('budget')}:</span>
                  <input
                    type="number"
                    value={budget}
                    onChange={(e) => setBudget(Number(e.target.value) || 0)}
                    className="w-24 px-2 py-1 border border-gray-200 rounded text-right text-sm"
                  />
                  <span>€</span>
                </div>
              </div>
            </div>

            {/* Expiration Alerts (Phase 5) */}
            {expiringServices.length > 0 && (
              <div className="bg-white rounded-xl p-5 shadow-sm border border-orange-200 lg:col-span-2">
                <h3 className="font-semibold text-orange-700 mb-4">{t('expiringSoon')}</h3>
                <div className="space-y-2">
                  {expiringServices.slice(0, 5).map(s => {
                    const daysLeft = Math.ceil((new Date(s.expiration_date) - new Date()) / (1000 * 60 * 60 * 24));
                    return (
                      <div key={s.id} className="flex items-center justify-between text-sm p-2 bg-orange-50 rounded">
                        <div className="flex items-center gap-2">
                          <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                            s.type === 'dedicated_server' ? 'bg-red-100 text-red-700' :
                            s.type === 'vps' ? 'bg-amber-100 text-amber-700' :
                            'bg-green-100 text-green-700'
                          }`}>
                            {s.type === 'dedicated_server' ? t('dedicatedServers') :
                             s.type === 'vps' ? t('vpsInstances') : t('storageServices')}
                          </span>
                          <span className="font-medium">{s.display_name || s.id}</span>
                        </div>
                        <span className={`text-sm font-medium ${daysLeft <= 7 ? 'text-red-600' : 'text-orange-600'}`}>
                          {t('expiringIn')} {daysLeft} {t('days')}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

          </div>
        )}

        {/* Tab Content - Compare */}
        {activeTab === 'compare' && (
          <div className="space-y-6">
            <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
              <div className="flex items-center justify-center gap-4 md:gap-6 flex-wrap">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-gray-700 text-sm">{t('monthA')} :</span>
                  <select
                    value={compareMonthA?.value || ''}
                    onChange={(e) => {
                      const month = months.find(m => m.value === e.target.value);
                      setCompareMonthA(month);
                    }}
                    className="px-3 py-2 bg-blue-50 border border-blue-200 rounded-lg text-sm font-medium text-blue-700"
                  >
                    {months.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                  </select>
                </div>
                <span className="text-2xl font-bold text-gray-300">{t('vs')}</span>
                <div className="flex items-center gap-2">
                  <span className="font-medium text-gray-700 text-sm">{t('monthB')} :</span>
                  <select
                    value={compareMonthB?.value || ''}
                    onChange={(e) => {
                      const month = months.find(m => m.value === e.target.value);
                      setCompareMonthB(month);
                    }}
                    className="px-3 py-2 bg-gray-100 border border-gray-200 rounded-lg text-sm"
                  >
                    {months.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                  </select>
                </div>
              </div>

              <div className="flex items-center justify-center gap-6 md:gap-8 mt-8">
                <div className="text-center">
                  <div className="text-3xl md:text-4xl font-bold text-blue-600">
                    {fmt(compareDataA?.total || 0)}€
                  </div>
                  <div className="text-gray-500 mt-1 text-sm">{compareMonthA?.label}</div>
                </div>
                <div className="flex flex-col items-center">
                  <span className={`px-4 py-2 rounded-full text-lg font-bold ${Number(totalVariation) > 0 ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>
                    {Number(totalVariation) > 0 ? '+' : ''}{totalVariation}%
                  </span>
                </div>
                <div className="text-center">
                  <div className="text-3xl md:text-4xl font-bold text-gray-400">
                    {fmt(compareDataB?.total || 0)}€
                  </div>
                  <div className="text-gray-500 mt-1 text-sm">{compareMonthB?.label}</div>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
              <h3 className="font-semibold text-gray-900 mb-4">{t('serviceComparison')}</h3>
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={comparisonChartData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                    <YAxis tickFormatter={(v) => `${v}€`} />
                    <Tooltip formatter={(v) => `${fmt(v)}€`} />
                    <Legend />
                    <Bar dataKey="moisA" fill="#3b82f6" name={compareMonthA?.label} />
                    <Bar dataKey="moisB" fill="#94a3b8" name={compareMonthB?.label} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <Accordion title={t('projectComparison')} defaultOpen>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left bg-gray-50">
                    <th
                      className="p-3 font-medium rounded-tl-lg cursor-pointer hover:bg-gray-100 select-none"
                      onClick={() => handleCompareSort('name')}
                    >
                      {t('project')}<SortIcon column="name" current={compareSort} />
                    </th>
                    <th
                      className="p-3 font-medium text-right cursor-pointer hover:bg-gray-100 select-none"
                      onClick={() => handleCompareSort('totalA')}
                    >
                      {compareMonthA?.label}<SortIcon column="totalA" current={compareSort} />
                    </th>
                    <th
                      className="p-3 font-medium text-right cursor-pointer hover:bg-gray-100 select-none"
                      onClick={() => handleCompareSort('totalB')}
                    >
                      {compareMonthB?.label}<SortIcon column="totalB" current={compareSort} />
                    </th>
                    <th
                      className="p-3 font-medium text-right rounded-tr-lg cursor-pointer hover:bg-gray-100 select-none"
                      onClick={() => handleCompareSort('diff')}
                    >
                      {t('variation')}<SortIcon column="diff" current={compareSort} />
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {getSortedCompareProjects().map((p) => (
                    <tr key={p.projectId} className="border-b hover:bg-gray-50 transition-colors">
                      <td className="p-3 font-medium">{p.projectName}</td>
                      <td className="p-3 text-right font-medium">{fmt(p.total)}€</td>
                      <td className="p-3 text-right text-gray-500">{fmt(p.totalB)}€</td>
                      <td className="p-3 text-right">
                        {p.diff !== null && (
                          <span className={`px-2 py-1 rounded text-xs font-medium ${p.diff > 0 ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>
                            {p.diff > 0 ? '+' : ''}{p.diff.toFixed(1)}%
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Accordion>

            {/* Accordéon pour l'infrastructure (serveurs dédiés, VPS, stockage, etc.) */}
            <Accordion title={language === 'en' ? 'Infrastructure Comparison' : 'Comparaison Infrastructure'}>
              {/* Tableau comparatif infrastructure */}
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left bg-gray-50">
                    <th className="p-3 font-medium rounded-tl-lg">{language === 'en' ? 'Type' : 'Type'}</th>
                    <th className="p-3 font-medium text-right">{compareMonthA?.label}</th>
                    <th className="p-3 font-medium text-right">{compareMonthB?.label}</th>
                    <th className="p-3 font-medium text-right rounded-tr-lg">{t('variation')}</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    { key: 'dedicated_server', label: language === 'en'
                      ? `List of Dedicated Servers present on ${new Date().toLocaleDateString('en-GB')}`
                      : `Liste des Serveurs dédiés présents au ${new Date().toLocaleDateString('fr-FR')}`,
                      renderNames: () => (
                        <ul className="text-xs text-gray-500 mt-1">
                          {inventoryServers.map(srv => (
                            <li key={srv.id}>{srv.display_name || srv.id}</li>
                          ))}
                        </ul>
                      )
                    },
                    { key: 'vps', label: 'VPS' },
                    { key: 'storage', label: language === 'en' ? 'Storage' : 'Stockage' },
                    { key: 'load_balancer', label: language === 'en' ? 'Load Balancer' : 'Load Balancer' },
                    { key: 'ip_service', label: language === 'en' ? 'IP Addresses' : 'Adresses IP' },
                    { key: 'domain', label: language === 'en' ? 'Domains' : 'Noms de domaine' },
                    { key: 'private_cloud_host', label: language === 'en' ? 'Private Cloud Hosts' : 'Hôtes Private Cloud' },
                    { key: 'private_cloud_datastore', label: language === 'en' ? 'Private Cloud Datastores' : 'Datastores Private Cloud' },
                  ].map(row => {
                    const a = byServiceA.find(s => s.key === row.key) || {};
                    const b = byServiceB.find(s => s.key === row.key) || {};
                    const valA = a.value || 0;
                    const valB = b.value || 0;
                    const diff = valA ? ((valB - valA) / valA * 100) : null;
                    return (
                      <tr key={row.key} className="border-b hover:bg-gray-50 transition-colors">
                        <td className="p-3 font-medium">
                          {row.label}
                          {row.key === 'dedicated_server' && row.renderNames && inventoryServers.length > 0 && row.renderNames()}
                        </td>
                        <td className="p-3 text-right font-medium">{fmt(valA)}€</td>
                        <td className="p-3 text-right text-gray-500">{fmt(valB)}€</td>
                        <td className="p-3 text-right">
                          {diff !== null && (
                            <span className={`px-2 py-1 rounded text-xs font-medium ${diff > 0 ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>
                              {diff > 0 ? '+' : ''}{diff.toFixed(1)}%
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Accordion>

            {/* Accordéon pour le backup */}
            <Accordion title={language === 'en' ? 'Backup Comparison' : 'Comparaison Backup'}>
              {/* Tableau comparatif backup */}
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left bg-gray-50">
                    <th className="p-3 font-medium rounded-tl-lg">{language === 'en' ? 'Category' : 'Catégorie'}</th>
                    <th className="p-3 font-medium text-right">{compareMonthA?.label}</th>
                    <th className="p-3 font-medium text-right">{compareMonthB?.label}</th>
                    <th className="p-3 font-medium text-right rounded-tr-lg">{t('variation')}</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    {
                      key: 'backup_vms',
                      label: language === 'en' ? 'Veeam Backup VMs' : 'VMs Veeam Backup',
                      getA: () => (byServiceA.find(s => s.key === 'backup')?.count || 0),
                      getB: () => (byServiceB.find(s => s.key === 'backup')?.count || 0),
                      getValA: () => (byServiceA.find(s => s.key === 'backup')?.value || 0),
                      getValB: () => (byServiceB.find(s => s.key === 'backup')?.value || 0),
                    },
                    {
                      key: 'backup_enterprise',
                      label: language === 'en' ? 'Veeam Enterprise License' : 'Licence Veeam Enterprise',
                      getA: () => (byServiceA.find(s => s.key === 'backup_enterprise')?.count || 0),
                      getB: () => (byServiceB.find(s => s.key === 'backup_enterprise')?.count || 0),
                      getValA: () => (byServiceA.find(s => s.key === 'backup_enterprise')?.value || 0),
                      getValB: () => (byServiceB.find(s => s.key === 'backup_enterprise')?.value || 0),
                    },
                  ].map(row => {
                    const countA = row.getA();
                    const countB = row.getB();
                    const valA = row.getValA();
                    const valB = row.getValB();
                    const diff = valA ? ((valB - valA) / valA * 100) : null;
                    return (
                      <tr key={row.key} className="border-b hover:bg-gray-50 transition-colors">
                        <td className="p-3 font-medium">{row.label}</td>
                        <td className="p-3 text-right font-medium">{countA} / {fmt(valA)}€</td>
                        <td className="p-3 text-right text-gray-500">{countB} / {fmt(valB)}€</td>
                        <td className="p-3 text-right">
                          {diff !== null && (
                            <span className={`px-2 py-1 rounded text-xs font-medium ${diff > 0 ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>
                              {diff > 0 ? '+' : ''}{diff.toFixed(1)}%
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Accordion>

            {/* Accordéon pour le Private Cloud */}
            <Accordion title={language === 'en' ? 'Private Cloud Comparison' : 'Comparaison Private Cloud'}>
              {/* Tableau comparatif Private Cloud */}
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left bg-gray-50">
                    <th className="p-3 font-medium rounded-tl-lg">{language === 'en' ? 'Type' : 'Type'}</th>
                    <th className="p-3 font-medium text-right">{compareMonthA?.label}</th>
                    <th className="p-3 font-medium text-right">{compareMonthB?.label}</th>
                    <th className="p-3 font-medium text-right rounded-tr-lg">{t('variation')}</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    { key: 'private_cloud_host', label: language === 'en' ? 'Private Cloud Hosts' : 'Hôtes Private Cloud' },
                    { key: 'private_cloud_datastore', label: language === 'en' ? 'Private Cloud Datastores' : 'Datastores Private Cloud' },
                  ].map(row => {
                    const a = byServiceA.find(s => s.key === row.key) || {};
                    const b = byServiceB.find(s => s.key === row.key) || {};
                    const valA = a.value || 0;
                    const valB = b.value || 0;
                    const diff = valA ? ((valB - valA) / valA * 100) : null;
                    return (
                      <tr key={row.key} className="border-b hover:bg-gray-50 transition-colors">
                        <td className="p-3 font-medium">{row.label}</td>
                        <td className="p-3 text-right font-medium">{fmt(valA)}€</td>
                        <td className="p-3 text-right text-gray-500">{fmt(valB)}€</td>
                        <td className="p-3 text-right">
                          {diff !== null && (
                            <span className={`px-2 py-1 rounded text-xs font-medium ${diff > 0 ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>
                              {diff > 0 ? '+' : ''}{diff.toFixed(1)}%
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Accordion>
            {/* Accordéons par projet public cloud : comparaison détaillée produits/services */}
            {getSortedCompareProjects().map((proj) => (
              <Accordion key={proj.projectId} title={`${proj.projectName} (${t('project')})`}>
                <ProjectProductComparison projectId={proj.projectId} monthA={compareMonthA} monthB={compareMonthB} fmt={fmt} language={language} />
              </Accordion>
            ))}
          </div>
        )}

        {/* Tab Content - Trends */}
        {activeTab === 'trends' && (
          <TrendsTab {...trendsTab} language={language} t={t} fmt={fmt} />
        )}

        {/* Tab Content - Web Cloud */}
        {activeTab === 'webcloud' && (
          <WebCloudTab {...webCloudTab} language={language} t={t} fmt={fmt} />
        )}

        {/* Tab Content - Public Cloud */}
        {activeTab === 'inventory' && (
          <div className="space-y-6">
            {/* Cloud Summary Cards */}
            <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
              <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
                <span className="text-gray-500 text-sm">{t('cloudProjects')}</span>
                <div className="text-3xl font-bold text-blue-600 mt-2">{byResourceType.find(r => r.resource_type === 'cloud_project')?.serviceCount || 0}</div>
              </div>
              <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
                <span className="text-gray-500 text-sm">{t('instances')}</span>
                <div className="text-3xl font-bold text-indigo-600 mt-2">
                  {projectsEnriched.reduce((sum, p) => sum + (p.instance_count || 0), 0)}
                </div>
                {publicCloudStats?.instances?.total > 0 && (
                  <p className="text-xs text-gray-400">{fmt(publicCloudStats.instances.total)}€</p>
                )}
              </div>
              <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
                <span className="text-gray-500 text-sm">{language === 'en' ? 'GPU Instances' : 'Instances GPU'}</span>
                <div className="text-3xl font-bold text-purple-600 mt-2">{gpuSummary?.instances?.length || 0}</div>
              </div>
              <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
                <span className="text-gray-500 text-sm">Kubernetes</span>
                <div className="text-3xl font-bold text-cyan-600 mt-2">{publicCloudStats?.kubernetes?.count || 0}</div>
                {publicCloudStats?.kubernetes?.total > 0 && (
                  <p className="text-xs text-gray-400">{fmt(publicCloudStats.kubernetes.total)}€</p>
                )}
              </div>
              <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
                <span className="text-gray-500 text-sm">{language === 'en' ? 'Object Storage' : 'Stockage Objet'}</span>
                <div className="text-3xl font-bold text-green-600 mt-2">{publicCloudStats?.objectStorage?.count || 0}</div>
                {publicCloudStats?.objectStorage?.total > 0 && (
                  <p className="text-xs text-gray-400">{fmt(publicCloudStats.objectStorage.total)}€</p>
                )}
              </div>
              <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
                <span className="text-gray-500 text-sm">{language === 'en' ? 'Volumes' : 'Volumes'}</span>
                <div className="text-3xl font-bold text-teal-600 mt-2">{publicCloudStats?.volumes?.count || 0}</div>
                {publicCloudStats?.volumes?.total > 0 && (
                  <p className="text-xs text-gray-400">{fmt(publicCloudStats.volumes.total)}€</p>
                )}
              </div>
              <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
                <span className="text-gray-500 text-sm">Snapshots</span>
                <div className="text-3xl font-bold text-amber-600 mt-2">{publicCloudStats?.snapshots?.count || 0}</div>
                {publicCloudStats?.snapshots?.total > 0 && (
                  <p className="text-xs text-gray-400">{fmt(publicCloudStats.snapshots.total)}€</p>
                )}
              </div>
              <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
                <span className="text-gray-500 text-sm">{language === 'en' ? 'Savings plans' : 'Savings plans'}</span>
                <div className="text-3xl font-bold text-rose-600 mt-2">{publicCloudStats?.savingsPlans?.count || 0}</div>
                {publicCloudStats?.savingsPlans?.total > 0 && (
                  <p className="text-xs text-gray-400">{fmt(publicCloudStats.savingsPlans.total)}€</p>
                )}
              </div>
              <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
                <span className="text-gray-500 text-sm">{language === 'en' ? 'Container Registry' : 'Registre'}</span>
                <div className="text-3xl font-bold text-orange-600 mt-2">{publicCloudStats?.registry?.count || 0}</div>
                {publicCloudStats?.registry?.total > 0 && (
                  <p className="text-xs text-gray-400">{fmt(publicCloudStats.registry.total)}€</p>
                )}
              </div>
            </div>

            {/* Cloud Projects Table with inline detail */}
            {projectsEnriched.length > 0 && (
              <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
                <h3 className="font-semibold text-gray-900 mb-4">{t('cloudProjects')}</h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-gray-50">
                        <th className="p-3 text-left font-medium">{language === 'en' ? 'Name' : 'Nom'}</th>
                        <th className="p-3 text-left font-medium">{t('state')}</th>
                        <th className="p-3 text-right font-medium">{t('instances')}</th>
                        <th className="p-3 text-right font-medium">{language === 'en' ? 'Current consumption' : 'Consommation en cours'}</th>
                        <th className="p-3 text-center font-medium"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {projectsEnriched.map(p => (
                        <Fragment key={p.id}>
                          <tr
                            className={`border-b hover:bg-gray-50 cursor-pointer ${selectedProject?.id === p.id ? 'bg-blue-50' : ''}`}
                            onClick={() => setSelectedProject(selectedProject?.id === p.id ? null : p)}
                          >
                            <td className="p-3 font-medium">
                              <span className="text-blue-600">{p.name || p.id}</span>
                              {p.description && <div className="text-xs text-gray-400">{p.description}</div>}
                            </td>
                            <td className="p-3">
                              <span className={`px-2 py-0.5 rounded text-xs font-medium ${p.status === 'ok' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700'}`}>
                                {p.status}
                              </span>
                            </td>
                            <td className="p-3 text-right">{p.instance_count || 0}</td>
                            <td className="p-3 text-right font-medium">
                              {p.consumption_total > 0 ? `${fmt(p.consumption_total)}€` : '-'}
                            </td>
                            <td className="p-3 text-center">
                              <span className="text-gray-400 text-lg">
                                {selectedProject?.id === p.id ? '▲' : '▼'}
                              </span>
                            </td>
                          </tr>
                          {selectedProject?.id === p.id && (
                            <tr>
                              <td colSpan="5" className="p-0">
                                <div className="bg-blue-50 border-l-4 border-blue-400 p-5">
                                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                                    {/* Consumption by resource type */}
                                    {(() => {
                                      const byType = {};
                                      projectConsumption.forEach(c => {
                                        const key = c.resource_type || 'other';
                                        byType[key] = (byType[key] || 0) + (c.total_price || 0);
                                      });
                                      const chartData = Object.entries(byType)
                                        .map(([name, value]) => ({ name, value: Math.round(value * 100) / 100 }))
                                        .sort((a, b) => b.value - a.value);
                                      const typeColors = ['#3b82f6', '#ef4444', '#f59e0b', '#10b981', '#8b5cf6', '#ec4899', '#6b7280'];

                                      return chartData.length > 0 ? (
                                        <div>
                                          <h4 className="font-medium text-gray-700 mb-3">
                                            {language === 'en' ? 'Consumption by resource' : 'Consommation par ressource'}
                                          </h4>
                                          <ResponsiveContainer width="100%" height={220}>
                                            <PieChart>
                                              <Pie
                                                data={chartData}
                                                cx="50%"
                                                cy="50%"
                                                outerRadius={80}
                                                innerRadius={35}
                                                dataKey="value"
                                                nameKey="name"
                                                label={({ name, value }) => `${name}: ${fmt(value)}€`}
                                              >
                                                {chartData.map((_, i) => (
                                                  <Cell key={i} fill={typeColors[i % typeColors.length]} />
                                                ))}
                                              </Pie>
                                              <Tooltip formatter={(v) => `${fmt(v)}€`} />
                                            </PieChart>
                                          </ResponsiveContainer>
                                        </div>
                                      ) : (
                                        <div className="flex items-center justify-center h-32 text-gray-400 text-sm">
                                          {language === 'en' ? 'No consumption data' : 'Pas de données de consommation'}
                                        </div>
                                      );
                                    })()}

                                    {/* Instances list */}
                                    <div>
                                      <h4 className="font-medium text-gray-700 mb-3 flex items-center gap-2">
                                        <span>
                                          {t('instances')} ({instanceCount})
                                          {projectInstanceTotal?.total > 0 && (
                                            <span className="ml-2 text-sm font-normal text-indigo-600">{fmt(projectInstanceTotal.total)}€</span>
                                          )}
                                        </span>
                                        {projectInstances.length > 0 && (
                                          <TableActions
                                            language={language}
                                            onShowAll={() => setShowAllInstances(true)}
                                            onExport={() => downloadCSV(
                                              instanceCsvRows(projectInstances, language),
                                              instanceCsvColumns(language),
                                              `ovh-instances-${selectedProject?.name || 'export'}`
                                            )}
                                          />
                                        )}
                                      </h4>
                                      {projectInstances.length > 0 ? (
                                        <div className="overflow-y-auto max-h-52 bg-white rounded-lg">
                                          <InstancesTable instances={projectInstances} language={language} t={t} fmt={fmt} />
                                        </div>
                                      ) : (
                                        <div className="flex items-center justify-center h-16 text-gray-400 text-sm">
                                          {language === 'en' ? 'No instances' : 'Aucune instance'}
                                        </div>
                                      )}
                                    </div>

                                    {/* Buckets list */}
                                    {projectBuckets.length > 0 && (
                                      <div className="lg:col-span-2">
                                        <h4 className="font-medium text-gray-700 mb-3 flex items-center gap-2">
                                          <span>
                                            Buckets ({projectBuckets.length})
                                            <span className="ml-2 text-sm font-normal text-green-600">
                                              {fmt(projectBuckets.reduce((sum, b) => sum + (b.total || 0), 0))}€
                                            </span>
                                          </span>
                                          <TableActions
                                            language={language}
                                            onShowAll={() => setShowAllBuckets(true)}
                                            onExport={() => downloadCSV(
                                              sortBucketsByName(projectBuckets),
                                              bucketCsvColumns(language),
                                              `ovh-buckets-${selectedMonth?.value || 'export'}`
                                            )}
                                          />
                                        </h4>
                                        {/* ~11 rows before scrolling */}
                                        <div className="overflow-y-auto max-h-[400px] bg-white rounded-lg">
                                          <BucketsTable buckets={projectBuckets} language={language} t={t} fmt={fmt} fmtBytes={fmtBytes} />
                                        </div>
                                      </div>
                                    )}

                                    {/* Volumes */}
                                    {projectVolumes.length > 0 && (
                                      <div>
                                        <h4 className="font-medium text-gray-700 mb-3 flex items-center gap-2">
                                          <span>
                                            Volumes ({projectVolumes.length})
                                            <span className="ml-2 text-sm font-normal text-teal-600">
                                              {fmt(projectVolumes.reduce((sum, v) => sum + (v.total || 0), 0))}€
                                            </span>
                                          </span>
                                          <TableActions
                                            language={language}
                                            onShowAll={() => setShowAllVolumes(true)}
                                            onExport={() => downloadCSV(
                                              volumeCsvRows(projectVolumes),
                                              volumeCsvColumns(language),
                                              `ovh-volumes-${selectedMonth?.value || 'export'}`
                                            )}
                                          />
                                        </h4>
                                        <div className="overflow-y-auto max-h-[400px] bg-white rounded-lg">
                                          <VolumesTable volumes={projectVolumes} language={language} t={t} fmt={fmt} />
                                        </div>
                                      </div>
                                    )}

                                    {/* Snapshots */}
                                    {projectSnapshots.length > 0 && (
                                      <div>
                                        <h4 className="font-medium text-gray-700 mb-3 flex items-center gap-2">
                                          <span>
                                            Snapshots ({projectSnapshots.length})
                                            <span className="ml-2 text-sm font-normal text-amber-600">
                                              {fmt(projectSnapshots.reduce((sum, sn) => sum + (sn.total || 0), 0))}€
                                            </span>
                                          </span>
                                          <TableActions
                                            language={language}
                                            onShowAll={() => setShowAllSnapshots(true)}
                                            onExport={() => downloadCSV(
                                              projectSnapshots,
                                              snapshotCsvColumns(language),
                                              `ovh-snapshots-${selectedMonth?.value || 'export'}`
                                            )}
                                          />
                                        </h4>
                                        <div className="overflow-y-auto max-h-[400px] bg-white rounded-lg">
                                          <SnapshotsTable snapshots={projectSnapshots} language={language} t={t} fmt={fmt} locale={locale} />
                                        </div>
                                      </div>
                                    )}

                                    {/* Savings plans */}
                                    {projectSavingsPlans.length > 0 && (
                                      <div className="lg:col-span-2">
                                        <h4 className="font-medium text-gray-700 mb-3 flex items-center gap-2">
                                          <span>
                                            Savings plans ({projectSavingsPlans.length})
                                            <span className="ml-2 text-sm font-normal text-rose-600">
                                              {fmt(projectSavingsPlans.reduce((sum, p) => sum + (p.total || 0), 0))}€
                                            </span>
                                          </span>
                                          <TableActions
                                            language={language}
                                            onShowAll={() => setShowAllSavingsPlans(true)}
                                            onExport={() => downloadCSV(
                                              projectSavingsPlans,
                                              savingsPlanCsvColumns(language),
                                              `ovh-savings-plans-${selectedMonth?.value || 'export'}`
                                            )}
                                          />
                                        </h4>
                                        <div className="overflow-y-auto max-h-[400px] bg-white rounded-lg">
                                          <SavingsPlansTable plans={projectSavingsPlans} language={language} fmt={fmt} />
                                        </div>
                                      </div>
                                    )}
                                  </div>

                                  {/* Quotas — only regions with capacity */}
                                  {(() => {
                                    const activeQuotas = projectQuotas.filter(q => q.used_cores > 0 || q.used_instances > 0);
                                    return activeQuotas.length > 0 ? (
                                      <div className="mt-4">
                                        <h4 className="font-medium text-gray-700 mb-3">
                                          {language === 'en' ? 'Quotas by region' : 'Quotas par région'}
                                        </h4>
                                        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                                          {activeQuotas.map(q => {
                                            const coreUsage = q.max_cores > 0 ? Math.round((q.used_cores / q.max_cores) * 100) : 0;
                                            return (
                                              <div key={`${q.project_id}-${q.region}`} className="bg-white rounded-lg p-3">
                                                <div className="font-medium text-xs text-gray-700 mb-2">{q.region}</div>
                                                <div className="text-xs text-gray-500">
                                                  vCPU: {q.used_cores}/{q.max_cores}
                                                </div>
                                                <div className="w-full bg-gray-200 rounded-full h-1.5 mt-1">
                                                  <div
                                                    className={`h-1.5 rounded-full transition-all ${coreUsage > 80 ? 'bg-red-500' : coreUsage > 50 ? 'bg-amber-500' : 'bg-blue-500'}`}
                                                    style={{ width: `${Math.min(coreUsage, 100)}%` }}
                                                  />
                                                </div>
                                                <div className="text-xs text-gray-500 mt-1">
                                                  {t('instances')}: {q.used_instances}/{q.max_instances}
                                                </div>
                                              </div>
                                            );
                                          })}
                                        </div>
                                      </div>
                                    ) : null;
                                  })()}
                                </div>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

          </div>
        )}

        {/* Tab Content - Infrastructure */}
        {activeTab === 'infrastructure' && (
          <InfrastructureTab
            {...infrastructureTab} language={language} t={t} fmt={fmt}
            selectedMonth={selectedMonth} byResourceType={byResourceType}
            selectedResourceType={selectedResourceType}
            setSelectedResourceType={setSelectedResourceType}
          />
        )}

        {/* Tab Content - Backup */}
        {activeTab === 'backup' && (
          <BackupTab
            {...backupTab} language={language} fmt={fmt}
            selectedMonth={selectedMonth} summary={summary} byResourceType={byResourceType}
          />
        )}

        {/* Footer */}
        <div className="text-center text-sm text-gray-400 pt-4 pb-2">
          {syncFeedback && (
            <p className={`mb-2 text-sm font-medium ${syncFeedback.type === 'ok' ? 'text-green-600' : 'text-red-600'}`}>
              {syncFeedback.msg}
            </p>
          )}
          <p>{t('syncedVia')}</p>
          {importStatus?.latest && (
            <p className="mt-1">
              {t('lastSync')}: {importStatus.latest.completed_at ? (
                <>
                  {parseSqliteDate(importStatus.latest.completed_at).toLocaleString(locale)}
                  {' '}({importStatus.latest.bills_imported} {t('bills')})
                </>
              ) : t('importStatusRunning')}
            </p>
          )}

          {/* Import history */}
          <details className="mt-3 max-w-2xl mx-auto text-left">
            <summary className="cursor-pointer text-gray-500 hover:text-gray-700 text-center">
              {t('importHistory')}
            </summary>
            {importStatus?.history?.length > 0 ? (
              <table className="w-full mt-2 text-xs border-collapse">
                <thead>
                  <tr className="text-gray-500 border-b border-gray-200">
                    <th className="text-left py-1 px-2">{t('importDate')}</th>
                    <th className="text-left py-1 px-2">{t('importType')}</th>
                    <th className="text-left py-1 px-2">{t('importStatusLabel')}</th>
                    <th className="text-right py-1 px-2">{t('importBills')}</th>
                  </tr>
                </thead>
                <tbody>
                  {importStatus.history.map((h) => (
                    <tr key={h.id} className="border-b border-gray-100">
                      <td className="py-1 px-2 text-gray-600">
                        {parseSqliteDate(h.completed_at || h.started_at).toLocaleString(locale)}
                      </td>
                      <td className="py-1 px-2 text-gray-600">{t(IMPORT_TYPE_KEYS[h.type] || h.type)}</td>
                      <td className="py-1 px-2">
                        <span className={
                          h.status === 'success' ? 'text-green-600'
                          : h.status === 'running' ? 'text-blue-600'
                          : 'text-red-600'
                        }>
                          {t(IMPORT_STATUS_KEYS[h.status] || h.status)}
                        </span>
                      </td>
                      <td className="py-1 px-2 text-right text-gray-600">{h.bills_imported ?? '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="mt-2 text-center text-gray-400">{t('noImportHistory')}</p>
            )}
          </details>
        </div>
      </div>
      <WebCloudTabModals {...webCloudTab} language={language} t={t} fmt={fmt} />

      <Modal
        open={showAllBuckets}
        onClose={() => setShowAllBuckets(false)}
        maxWidth="max-w-5xl"
        title={
          <>
            Buckets ({projectBuckets.length})
            <span className="ml-2 text-sm font-normal text-green-600">
              {fmt(projectBuckets.reduce((sum, b) => sum + (b.total || 0), 0))}€
            </span>
            {selectedMonth?.label && (
              <span className="ml-2 text-sm font-normal text-gray-400">{selectedMonth.label}</span>
            )}
          </>
        }
        actions={
          <button
            onClick={() => downloadCSV(
              sortBucketsByName(projectBuckets),
              bucketCsvColumns(language),
              `ovh-buckets-${selectedMonth?.value || 'export'}`
            )}
            className="px-2 py-0.5 text-xs border border-gray-200 rounded hover:bg-gray-100"
          >
            CSV
          </button>
        }
      >
        <BucketsTable buckets={projectBuckets} language={language} t={t} fmt={fmt} fmtBytes={fmtBytes} />
      </Modal>

      <Modal
        open={showAllInstances}
        onClose={() => setShowAllInstances(false)}
        maxWidth="max-w-4xl"
        title={
          <>
            {t('instances')} ({instanceCount})
            {projectInstanceTotal?.total > 0 && (
              <span className="ml-2 text-sm font-normal text-indigo-600">{fmt(projectInstanceTotal.total)}€</span>
            )}
            {selectedProject?.name && (
              <span className="ml-2 text-sm font-normal text-gray-400">{selectedProject.name}</span>
            )}
          </>
        }
        actions={
          <TableActions
            language={language}
            onExport={() => downloadCSV(
              instanceCsvRows(projectInstances, language),
              instanceCsvColumns(language),
              `ovh-instances-${selectedProject?.name || 'export'}`
            )}
          />
        }
      >
        <InstancesTable instances={projectInstances} language={language} t={t} fmt={fmt} />
      </Modal>

      <InfrastructureTabModals {...infrastructureTab} language={language} t={t} />

      <Modal
        open={showAllVolumes}
        onClose={() => setShowAllVolumes(false)}
        maxWidth="max-w-5xl"
        title={
          <>
            Volumes ({projectVolumes.length})
            <span className="ml-2 text-sm font-normal text-teal-600">
              {fmt(projectVolumes.reduce((sum, v) => sum + (v.total || 0), 0))}€
            </span>
          </>
        }
        actions={
          <TableActions
            language={language}
            onExport={() => downloadCSV(
              volumeCsvRows(projectVolumes),
              volumeCsvColumns(language),
              `ovh-volumes-${selectedMonth?.value || 'export'}`
            )}
          />
        }
      >
        <VolumesTable volumes={projectVolumes} language={language} t={t} fmt={fmt} />
      </Modal>

      <Modal
        open={showAllSnapshots}
        onClose={() => setShowAllSnapshots(false)}
        maxWidth="max-w-5xl"
        title={
          <>
            Snapshots ({projectSnapshots.length})
            <span className="ml-2 text-sm font-normal text-amber-600">
              {fmt(projectSnapshots.reduce((sum, sn) => sum + (sn.total || 0), 0))}€
            </span>
          </>
        }
        actions={
          <TableActions
            language={language}
            onExport={() => downloadCSV(
              projectSnapshots,
              snapshotCsvColumns(language),
              `ovh-snapshots-${selectedMonth?.value || 'export'}`
            )}
          />
        }
      >
        <SnapshotsTable snapshots={projectSnapshots} language={language} t={t} fmt={fmt} locale={locale} />
      </Modal>

      <Modal
        open={showAllSavingsPlans}
        onClose={() => setShowAllSavingsPlans(false)}
        maxWidth="max-w-4xl"
        title={
          <>
            Savings plans ({projectSavingsPlans.length})
            <span className="ml-2 text-sm font-normal text-rose-600">
              {fmt(projectSavingsPlans.reduce((sum, p) => sum + (p.total || 0), 0))}€
            </span>
          </>
        }
        actions={
          <TableActions
            language={language}
            onExport={() => downloadCSV(
              projectSavingsPlans,
              savingsPlanCsvColumns(language),
              `ovh-savings-plans-${selectedMonth?.value || 'export'}`
            )}
          />
        }
      >
        <SavingsPlansTable plans={projectSavingsPlans} language={language} fmt={fmt} />
      </Modal>
    </div>
  );
}
