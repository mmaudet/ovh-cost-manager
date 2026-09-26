import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  fetchMonths, fetchSummary, fetchByProject, fetchByService,
  fetchImportStatus, fetchConfig, fetchUser,
  fetchConsumptionCurrent, fetchConsumptionForecast,
  fetchExpiringServices,
  fetchByResourceType, fetchGpuSummary, triggerImport
} from '../services/api';
import { useLanguage } from '../hooks/useLanguage.jsx';
import Logo from '../components/Logo';
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
import { usePublicCloudTab } from '../tabs/usePublicCloudTab.js';
import { PublicCloudTab, PublicCloudTabModals } from '../tabs/PublicCloudTab.jsx';
import { useCompareTab } from '../tabs/useCompareTab.js';
import { CompareTab } from '../tabs/CompareTab.jsx';
import { useOverviewTab } from '../tabs/useOverviewTab.js';
import { OverviewTab } from '../tabs/OverviewTab.jsx';

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
  const [activeTab, setActiveTab] = useState('overview');
  const [budget, setBudget] = useState(50000); // Default budget
  const [syncWarningDismissed, setSyncWarningDismissed] = useState(false);
  const [selectedProject, setSelectedProject] = useState(null);
  const [selectedResourceType, setSelectedResourceType] = useState(null);
  const [syncFeedback, setSyncFeedback] = useState(null); // { type: 'ok'|'error', msg }

  // Helper to format currency with current language
  const fmt = (value) => formatCurrency(value, language);
  const locale = language === 'en' ? 'en-US' : 'fr-FR';

  // What loads at page start: the header, the KPI cards, the footer and several tabs read
  // it, and the tabs get it as props (ADR 0001)

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

  // Fetch available months
  const { data: months = [] } = useQuery({
    queryKey: ['months'],
    queryFn: fetchMonths
  });

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

  const { data: byResourceType = [] } = useQuery({
    queryKey: ['byResourceType', selectedMonth?.from, selectedMonth?.to],
    queryFn: () => fetchByResourceType(selectedMonth.from, selectedMonth.to),
    enabled: !!selectedMonth
  });

  // GPU costs of the selected month, for the Overview and the Public Cloud tab
  const { data: gpuSummary } = useQuery({
    queryKey: ['gpuSummary', selectedMonth?.from, selectedMonth?.to],
    queryFn: () => fetchGpuSummary(selectedMonth.from, selectedMonth.to),
    enabled: !!selectedMonth
  });

  const { data: importStatus } = useQuery({
    queryKey: ['importStatus'],
    queryFn: fetchImportStatus,
    // Poll while an import is in progress so the footer follows it, every
    // 30 s to stay well below the general API rate limit (100 requests per
    // 15 minutes per IP by default)
    refetchInterval: (query) => (query.state.data?.running ? 30000 : false)
  });

  // The current month's consumption so far and its month-end forecast, for the KPI cards
  const { data: consumptionCurrent } = useQuery({
    queryKey: ['consumptionCurrent'],
    queryFn: fetchConsumptionCurrent
  });

  const { data: consumptionForecast } = useQuery({
    queryKey: ['consumptionForecast'],
    queryFn: fetchConsumptionForecast
  });

  const { data: expiringServices = [] } = useQuery({
    queryKey: ['expiringServices'],
    queryFn: () => fetchExpiringServices(30)
  });

  // Each tab's state and queries, in the order of the tab bar: its hook runs on every render,
  // before the loading screen, so that the tab keeps them while another one is open (ADR 0001)

  const overviewTab = useOverviewTab();

  const compareTab = useCompareTab({ months, selectedMonth, activeTab });
  // The "vs previous month" KPI reads the summary of month B (#50). Its query only runs on
  // the Compare tab, but month B defaults to the latest month, whose summary the page loads
  // at start under the same key: the KPI reads it from page start.
  const { compareDataB } = compareTab;

  const trendsTab = useTrendsTab({ months, activeTab });

  const publicCloudTab = usePublicCloudTab({ selectedMonth, activeTab, selectedProject });

  const webCloudTab = useWebCloudTab({ selectedMonth, activeTab });

  const infrastructureTab = useInfrastructureTab({
    selectedMonth, activeTab, selectedResourceType,
  });
  // The Compare tab lists the dedicated servers too: the shell passes them on, though they
  // only load on the Infrastructure tab (#35)
  const { inventoryServers } = infrastructureTab;

  const backupTab = useBackupTab({ selectedMonth, activeTab });

  // Update budget when config loads
  useEffect(() => {
    if (configData?.budget) {
      setBudget(configData.budget);
    }
  }, [configData]);

  // Set the default month when data loads: the latest one. useCompareTab sets months A
  // and B on the same condition, in the same commit
  useEffect(() => {
    if (months.length > 0 && !selectedMonth) {
      setSelectedMonth(months[0]);
    }
  }, [months, selectedMonth]);

  // Manual resync
  const queryClient = useQueryClient();
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

  // Check if previous month exists
  const previousMonthExists = selectedMonth && months.length > 1 &&
    months.findIndex(m => m.value === selectedMonth.value) < months.length - 1;

  // Calculations
  const total = summary?.total || 0;
  const previousTotal = compareDataB?.total || 0;
  const variation = previousMonthExists && previousTotal ? ((total - previousTotal) / previousTotal * 100).toFixed(1) : null;

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
            {/* What the logo and the tab bar keep open: ADR 0001 (#56) */}
            <button
              onClick={() => {
                setActiveTab('overview');
                setSelectedProject(null);
                setSelectedResourceType(null);
              }}
              className="cursor-pointer"
            >
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
                    title={t('logout')}
                  >
                    ✕
                  </a>
                )}
              </div>
            )}
            {activeTab !== 'compare' && (
              <>
                <select
                  value={selectedMonth.value}
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
                        a.download = `ovh-report-${selectedMonth.value}.md`;
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

        {/* Consumption, Forecast and Resource Count KPI Cards */}
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
                      ? `${consumptionForecast.days_elapsed}/${consumptionForecast.days_in_month}`
                        + ` ${t('days')}`
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
                onClick={() => setActiveTab(tab.id)}
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
          <OverviewTab
            {...overviewTab} language={language} t={t} fmt={fmt}
            summary={summary} total={total} byService={byService} byProject={byProject}
            byResourceType={byResourceType} gpuSummary={gpuSummary}
            expiringServices={expiringServices} budget={budget} setBudget={setBudget}
            setActiveTab={setActiveTab} setSelectedProject={setSelectedProject}
            setSelectedResourceType={setSelectedResourceType}
          />
        )}

        {/* Tab Content - Compare */}
        {activeTab === 'compare' && (
          <CompareTab
            {...compareTab} language={language} t={t} fmt={fmt}
            months={months} inventoryServers={inventoryServers}
          />
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
          <PublicCloudTab
            {...publicCloudTab} language={language} t={t} fmt={fmt} locale={locale}
            selectedMonth={selectedMonth} selectedProject={selectedProject}
            setSelectedProject={setSelectedProject} byResourceType={byResourceType}
            gpuSummary={gpuSummary}
          />
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

      <PublicCloudTabModals
        {...publicCloudTab} language={language} t={t} fmt={fmt} locale={locale}
        selectedMonth={selectedMonth} selectedProject={selectedProject}
      />

      <InfrastructureTabModals {...infrastructureTab} language={language} t={t} />
    </div>
  );
}
