import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, LineChart, Line, Legend
} from 'recharts';
import {
  fetchMonths, fetchSummary, fetchByProject, fetchByService,
  fetchMonthlyTrend, fetchImportStatus, fetchConfig
} from '../services/api';
import { useLanguage } from '../hooks/useLanguage.jsx';
import Logo from '../components/Logo';

// Format currency based on language
const formatCurrency = (value, language = 'fr') => {
  const locale = language === 'en' ? 'en-US' : 'fr-FR';
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value);
};

// Generate markdown report
const generateMarkdownReport = (summary, byService, byProject, selectedMonth, language = 'fr') => {
  const locale = language === 'en' ? 'en-US' : 'fr-FR';
  const fmt = (v) => formatCurrency(v, language);

  let md = `# OVH Cost Report - ${selectedMonth?.label || 'N/A'}\n\n`;
  md += `**${language === 'en' ? 'Period' : 'Période'}:** ${selectedMonth?.from} to ${selectedMonth?.to}\n\n`;
  md += `## ${language === 'en' ? 'Summary' : 'Résumé'}\n\n`;
  md += `| ${language === 'en' ? 'Metric' : 'Métrique'} | ${language === 'en' ? 'Value' : 'Valeur'} |\n|--------|-------|\n`;
  md += `| ${language === 'en' ? 'Total Cost' : 'Coût Total'} | ${fmt(summary?.total || 0)}€ |\n`;
  md += `| ${language === 'en' ? 'Cloud Total' : 'Cloud Total'} | ${fmt(summary?.cloudTotal || 0)}€ |\n`;
  md += `| ${language === 'en' ? 'Non-Cloud Total' : 'Non-Cloud Total'} | ${fmt(summary?.nonCloudTotal || 0)}€ |\n`;
  md += `| ${language === 'en' ? 'Daily Average' : 'Moyenne Journalière'} | ${fmt(summary?.dailyAverage || 0)}€ |\n`;
  md += `| ${language === 'en' ? 'Active Projects' : 'Projets Actifs'} | ${summary?.projectsCount || 0} |\n\n`;

  md += `## ${language === 'en' ? 'By Service Type' : 'Par Type de Service'}\n\n`;
  md += `| Service | ${language === 'en' ? 'Cost' : 'Coût'} | % |\n|---------|------|---|\n`;
  const totalService = byService.reduce((sum, s) => sum + s.value, 0);
  byService.forEach(s => {
    const pct = totalService ? ((s.value / totalService) * 100).toFixed(1) : 0;
    md += `| ${s.name} | ${fmt(s.value)}€ | ${pct}% |\n`;
  });

  md += `\n## ${language === 'en' ? 'Top Projects' : 'Top Projets'}\n\n`;
  md += `| ${language === 'en' ? 'Project' : 'Projet'} | ${language === 'en' ? 'Cost' : 'Coût'} |\n|---------|------|\n`;
  byProject.slice(0, 10).forEach(p => {
    md += `| ${p.projectName} | ${fmt(p.total)}€ |\n`;
  });

  md += `\n---\n*${language === 'en' ? 'Generated on' : 'Généré le'} ${new Date().toLocaleString(locale)}*\n`;
  return md;
};

export default function Dashboard() {
  const { language, setLanguage, t } = useLanguage();
  const [selectedMonth, setSelectedMonth] = useState(null);
  const [compareMonthA, setCompareMonthA] = useState(null);
  const [compareMonthB, setCompareMonthB] = useState(null);
  const [activeTab, setActiveTab] = useState('overview');
  const [budget, setBudget] = useState(50000); // Default budget
  const [trendPeriod, setTrendPeriod] = useState(6); // Months for trend
  const [projectSort, setProjectSort] = useState({ column: 'total', direction: 'desc' });
  const [compareSort, setCompareSort] = useState({ column: 'totalA', direction: 'desc' });
  const [syncWarningDismissed, setSyncWarningDismissed] = useState(false);

  // Helper to format currency with current language
  const fmt = (value) => formatCurrency(value, language);
  const locale = language === 'en' ? 'en-US' : 'fr-FR';

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

  const SortIcon = ({ column, current }) => (
    <span className="ml-1 text-gray-400">
      {current.column === column ? (current.direction === 'desc' ? '▼' : '▲') : '○'}
    </span>
  );

  // Fetch config (budget)
  const { data: configData } = useQuery({
    queryKey: ['config'],
    queryFn: fetchConfig
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
      setCompareMonthA(months[0]);
      if (months.length > 1) {
        setCompareMonthB(months[1]);
      }
    }
    // Adjust trend period if it exceeds available data
    if (months.length > 0 && trendPeriod > months.length) {
      const validPeriods = [3, 6, 12, 24, 36].filter(p => p <= months.length);
      if (validPeriods.length > 0) {
        setTrendPeriod(validPeriods[validPeriods.length - 1]);
      }
    }
  }, [months, selectedMonth, trendPeriod]);

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

  const { data: monthlyTrend = [] } = useQuery({
    queryKey: ['monthlyTrend', trendPeriod],
    queryFn: () => fetchMonthlyTrend(trendPeriod)
  });

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
    queryFn: fetchImportStatus
  });

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
            <Logo className="w-10 h-10" />
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
            {activeTab === 'overview' && (
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

        {/* Tabs */}
        <div className="flex items-center gap-4">
          <div className="flex gap-1 bg-white p-1 rounded-xl shadow-sm">
            {[
              { id: 'overview', labelKey: 'overview' },
              { id: 'compare', labelKey: 'compare' },
              { id: 'trends', labelKey: 'trends' },
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
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-600">{t('period')}:</span>
              <select
                value={trendPeriod}
                onChange={(e) => setTrendPeriod(Number(e.target.value))}
                className="px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm shadow-sm cursor-pointer"
              >
                {months.length >= 3 && <option value={3}>{t('months3')}</option>}
                {months.length >= 6 && <option value={6}>{t('months6')}</option>}
                {months.length >= 12 && <option value={12}>{t('months12')}</option>}
                {months.length >= 24 && <option value={24}>{t('months24')}</option>}
                {months.length >= 36 && <option value={36}>{t('months36')}</option>}
              </select>
            </div>
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
                    <Bar dataKey="total" fill="#3b82f6" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

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
                          <td className="p-3">{p.projectName}</td>
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

            <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100 overflow-x-auto">
              <h3 className="font-semibold text-gray-900 mb-4">{t('projectComparison')}</h3>
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
            </div>
          </div>
        )}

        {/* Tab Content - Trends */}
        {activeTab === 'trends' && (
          <div className="space-y-6">
            <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
              <h3 className="font-semibold text-gray-900 mb-4">{t('evolutionOver')} {trendPeriod} {language === 'en' ? 'months' : 'mois'}</h3>
              {monthlyTrend.length > 0 ? (
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={monthlyTrend}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="month" />
                      <YAxis tickFormatter={(v) => `${v}€`} />
                      <Tooltip formatter={(v) => `${fmt(v)}€`} />
                      <Line
                        type="monotone"
                        dataKey="cost"
                        stroke="#3b82f6"
                        strokeWidth={3}
                        dot={{ fill: '#3b82f6', r: 6, strokeWidth: 2, stroke: '#fff' }}
                        activeDot={{ r: 8 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="h-72 flex items-center justify-center text-gray-400">
                  <p>{t('noDataAvailable')}</p>
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className={`bg-white rounded-xl p-5 shadow-sm border border-gray-100 ${monthlyTrend.length === 0 ? 'opacity-50' : ''}`}>
                <span className="text-gray-500 text-sm">{t('periodGrowth')}</span>
                <div className={`text-3xl font-bold mt-2 ${monthlyTrend.length > 1 ? (((monthlyTrend[monthlyTrend.length - 1]?.cost - monthlyTrend[0]?.cost) / monthlyTrend[0]?.cost) > 0 ? 'text-red-600' : 'text-green-600') : 'text-gray-400'}`}>
                  {monthlyTrend.length > 1
                    ? `${(((monthlyTrend[monthlyTrend.length - 1]?.cost - monthlyTrend[0]?.cost) / monthlyTrend[0]?.cost) * 100) > 0 ? '+' : ''}${(((monthlyTrend[monthlyTrend.length - 1]?.cost - monthlyTrend[0]?.cost) / monthlyTrend[0]?.cost) * 100).toFixed(1)}%`
                    : 'N/A'}
                </div>
                <p className="text-sm text-gray-500 mt-1">{t('overLast')} {trendPeriod} {t('lastMonths')}</p>
              </div>
              <div className={`bg-white rounded-xl p-5 shadow-sm border border-gray-100 ${monthlyTrend.length === 0 ? 'opacity-50' : ''}`}>
                <span className="text-gray-500 text-sm">{t('mostExpensiveMonth')}</span>
                <div className={`text-3xl font-bold mt-2 ${monthlyTrend.length > 0 ? 'text-red-600' : 'text-gray-400'}`}>
                  {monthlyTrend.length > 0
                    ? monthlyTrend.reduce((max, m) => m.cost > max.cost ? m : max, monthlyTrend[0]).month
                    : 'N/A'}
                </div>
                <p className="text-sm text-gray-500 mt-1">
                  {monthlyTrend.length > 0
                    ? `${fmt(Math.max(...monthlyTrend.map(m => m.cost)))}€`
                    : ''}
                </p>
              </div>
              <div className={`bg-white rounded-xl p-5 shadow-sm border border-gray-100 ${monthlyTrend.length === 0 ? 'opacity-50' : ''}`}>
                <span className="text-gray-500 text-sm">{t('annualProjection')}</span>
                <div className={`text-3xl font-bold mt-2 ${monthlyTrend.length > 0 ? 'text-blue-600' : 'text-gray-400'}`}>
                  {monthlyTrend.length > 0
                    ? `~${fmt((monthlyTrend[monthlyTrend.length - 1]?.cost || 0) * 12)}€`
                    : 'N/A'}
                </div>
                <p className="text-sm text-gray-500 mt-1">{t('basedOnLastMonth')}</p>
              </div>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="text-center text-sm text-gray-400 pt-4 pb-2">
          <p>{t('syncedVia')}</p>
          {importStatus?.latest && (
            <p className="mt-1">
              {t('lastSync')}: {new Date(importStatus.latest.completed_at).toLocaleString(locale)}
              ({importStatus.latest.bills_imported} {t('bills')})
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
