import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, LineChart, Line, AreaChart, Area, Legend
} from 'recharts';
import {
  fetchMonths, fetchSummary, fetchByProject, fetchByService,
  fetchDailyTrend, fetchMonthlyTrend, fetchImportStatus
} from '../services/api';

// Format currency
const formatCurrency = (value) => {
  return new Intl.NumberFormat('fr-FR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value);
};

export default function Dashboard() {
  const [selectedMonth, setSelectedMonth] = useState(null);
  const [compareMonthA, setCompareMonthA] = useState(null);
  const [compareMonthB, setCompareMonthB] = useState(null);
  const [activeTab, setActiveTab] = useState('overview');
  const [budget, setBudget] = useState(50000); // Default budget

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

  const { data: dailyTrend = [] } = useQuery({
    queryKey: ['dailyTrend', selectedMonth?.from, selectedMonth?.to],
    queryFn: () => fetchDailyTrend(selectedMonth.from, selectedMonth.to),
    enabled: !!selectedMonth
  });

  const { data: monthlyTrend = [] } = useQuery({
    queryKey: ['monthlyTrend'],
    queryFn: () => fetchMonthlyTrend(6)
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

  // Calculations
  const total = summary?.total || 0;
  const previousTotal = compareDataB?.total || total;
  const variation = previousTotal ? ((total - previousTotal) / previousTotal * 100).toFixed(1) : 0;
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
          <p className="text-gray-500">Chargement des données...</p>
        </div>
      </div>
    );
  }

  const totalVariation = compareDataA && compareDataB
    ? ((compareDataA.total - compareDataB.total) / compareDataB.total * 100).toFixed(1)
    : 0;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 p-4 md:p-6">
      <div className="max-w-6xl mx-auto space-y-6">

        {/* Header */}
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-blue-600 rounded-xl flex items-center justify-center shadow-lg text-2xl">
              OVH
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">OVH Cost Manager</h1>
              <p className="text-gray-500 text-sm">Tableau de bord de suivi des coûts OVHcloud</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
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
            <button className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium flex items-center gap-2 hover:bg-blue-700 shadow-sm transition-colors">
              PDF
            </button>
          </div>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white rounded-xl p-5 shadow-sm border-2 border-blue-500">
            <div className="flex justify-between items-start mb-3">
              <span className="text-gray-500 text-sm font-medium">Coût total du mois</span>
            </div>
            <div className="text-2xl font-bold text-gray-900">{formatCurrency(total)}€</div>
            <div className={`flex items-center mt-2 text-sm ${Number(variation) > 0 ? 'text-red-500' : 'text-green-500'}`}>
              {Number(variation) > 0 ? '+' : ''}{variation}% vs mois précédent
            </div>
          </div>

          <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
            <div className="flex justify-between items-start mb-3">
              <span className="text-gray-500 text-sm font-medium">Cloud Total</span>
            </div>
            <div className="text-2xl font-bold text-gray-900">{formatCurrency(summary?.cloudTotal || 0)}€</div>
            <div className="text-sm text-gray-500 mt-2">Public Cloud</div>
          </div>

          <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
            <div className="flex justify-between items-start mb-3">
              <span className="text-gray-500 text-sm font-medium">Coût moyen / jour</span>
            </div>
            <div className="text-2xl font-bold text-gray-900">{formatCurrency(summary?.dailyAverage || 0)}€</div>
            <div className="text-sm text-gray-500 mt-2">Sur 30 jours</div>
          </div>

          <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
            <div className="flex justify-between items-start mb-3">
              <span className="text-gray-500 text-sm font-medium">Projets actifs</span>
            </div>
            <div className="text-2xl font-bold text-gray-900">{summary?.projectsCount || 0}</div>
            <div className="text-sm text-gray-500 mt-2">avec consommation</div>
          </div>
        </div>

        {/* Budget Progress */}
        <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
          <div className="flex justify-between items-center mb-3">
            <span className="font-semibold text-gray-900">Consommation du budget</span>
            <span className={`px-3 py-1 rounded-full text-sm font-medium ${Number(budgetUsage) > 80 ? 'bg-orange-100 text-orange-700' : 'bg-green-100 text-green-700'}`}>
              {budgetUsage}% utilisé
            </span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-3 overflow-hidden">
            <div
              className={`h-3 rounded-full transition-all duration-500 ${Number(budgetUsage) > 80 ? 'bg-orange-500' : 'bg-blue-600'}`}
              style={{ width: `${Math.min(Number(budgetUsage), 100)}%` }}
            />
          </div>
          <div className="flex justify-between mt-2 text-sm text-gray-500">
            <span>Consommé: {formatCurrency(total)}€</span>
            <span>Budget: {formatCurrency(budget)}€</span>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 bg-white p-1 rounded-xl shadow-sm w-fit">
          {[
            { id: 'overview', label: "Vue d'ensemble", icon: null },
            { id: 'compare', label: 'Comparaison', icon: null },
            { id: 'trends', label: 'Tendances', icon: null },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-all ${
                activeTab === tab.id
                  ? 'bg-blue-600 text-white shadow-md'
                  : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab Content - Overview */}
        {activeTab === 'overview' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Pie Chart */}
            <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
              <h3 className="font-semibold text-gray-900 mb-4">Répartition par service</h3>
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
                    <Tooltip formatter={(v) => `${formatCurrency(v)}€`} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="grid grid-cols-2 gap-2 mt-4">
                {byService.map(s => (
                  <div key={s.name} className="flex items-center gap-2 text-sm">
                    <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: s.color }} />
                    <span className="text-gray-600 truncate">{s.name}</span>
                    <span className="ml-auto font-medium">{formatCurrency(s.value)}€</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Bar Chart */}
            <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
              <h3 className="font-semibold text-gray-900 mb-4">Top projets consommateurs</h3>
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={byProject.slice(0, 10)} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} />
                    <XAxis type="number" tickFormatter={(v) => `${v}€`} />
                    <YAxis dataKey="projectName" type="category" width={120} tick={{ fontSize: 11 }} />
                    <Tooltip formatter={(v) => `${formatCurrency(v)}€`} />
                    <Bar dataKey="total" fill="#3b82f6" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Daily trend */}
            <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100 lg:col-span-2">
              <h3 className="font-semibold text-gray-900 mb-4">Consommation journalière</h3>
              <div className="h-52">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={dailyTrend}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="day" tick={{ fontSize: 11 }} />
                    <YAxis tickFormatter={(v) => `${v}€`} tick={{ fontSize: 11 }} />
                    <Tooltip formatter={(v) => `${formatCurrency(v)}€`} labelFormatter={(l) => `Jour ${l}`} />
                    <Area type="monotone" dataKey="cost" stroke="#3b82f6" fill="#93c5fd" strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
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
                  <span className="font-medium text-gray-700 text-sm">Mois A :</span>
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
                <span className="text-2xl font-bold text-gray-300">VS</span>
                <div className="flex items-center gap-2">
                  <span className="font-medium text-gray-700 text-sm">Mois B :</span>
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
                    {formatCurrency(compareDataA?.total || 0)}€
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
                    {formatCurrency(compareDataB?.total || 0)}€
                  </div>
                  <div className="text-gray-500 mt-1 text-sm">{compareMonthB?.label}</div>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
              <h3 className="font-semibold text-gray-900 mb-4">Comparaison par service</h3>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={comparisonChartData} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis type="number" tickFormatter={(v) => `${v}€`} />
                    <YAxis dataKey="name" type="category" width={70} tick={{ fontSize: 11 }} />
                    <Tooltip formatter={(v) => `${formatCurrency(v)}€`} />
                    <Legend />
                    <Bar dataKey="moisA" fill="#3b82f6" name={compareMonthA?.label} />
                    <Bar dataKey="moisB" fill="#94a3b8" name={compareMonthB?.label} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100 overflow-x-auto">
              <h3 className="font-semibold text-gray-900 mb-4">Comparaison par projet</h3>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left bg-gray-50">
                    <th className="p-3 font-medium rounded-tl-lg">Projet</th>
                    <th className="p-3 font-medium text-right">{compareMonthA?.label}</th>
                    <th className="p-3 font-medium text-right">{compareMonthB?.label}</th>
                    <th className="p-3 font-medium text-right rounded-tr-lg">Variation</th>
                  </tr>
                </thead>
                <tbody>
                  {byProjectA.slice(0, 10).map((p) => {
                    const pB = byProjectB.find(proj => proj.projectName === p.projectName) || { total: 0 };
                    const diff = pB.total ? ((p.total - pB.total) / pB.total * 100).toFixed(1) : 'N/A';
                    return (
                      <tr key={p.projectId} className="border-b hover:bg-gray-50 transition-colors">
                        <td className="p-3 font-medium">{p.projectName}</td>
                        <td className="p-3 text-right font-medium">{formatCurrency(p.total)}€</td>
                        <td className="p-3 text-right text-gray-500">{formatCurrency(pB.total)}€</td>
                        <td className="p-3 text-right">
                          {diff !== 'N/A' && (
                            <span className={`px-2 py-1 rounded text-xs font-medium ${Number(diff) > 0 ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>
                              {Number(diff) > 0 ? '+' : ''}{diff}%
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Tab Content - Trends */}
        {activeTab === 'trends' && (
          <div className="space-y-6">
            <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
              <h3 className="font-semibold text-gray-900 mb-4">Évolution sur 6 mois</h3>
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={monthlyTrend}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="month" />
                    <YAxis tickFormatter={(v) => `${v}€`} />
                    <Tooltip formatter={(v) => `${formatCurrency(v)}€`} />
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
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
                <span className="text-gray-500 text-sm">Croissance mensuelle moyenne</span>
                <div className="text-3xl font-bold text-orange-600 mt-2">
                  {monthlyTrend.length > 1
                    ? `${(((monthlyTrend[monthlyTrend.length - 1]?.cost / monthlyTrend[0]?.cost) ** (1 / (monthlyTrend.length - 1)) - 1) * 100).toFixed(1)}%`
                    : 'N/A'}
                </div>
                <p className="text-sm text-gray-500 mt-1">Sur les 6 derniers mois</p>
              </div>
              <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
                <span className="text-gray-500 text-sm">Mois le plus coûteux</span>
                <div className="text-3xl font-bold text-red-600 mt-2">
                  {monthlyTrend.length > 0
                    ? monthlyTrend.reduce((max, m) => m.cost > max.cost ? m : max, monthlyTrend[0]).month
                    : 'N/A'}
                </div>
                <p className="text-sm text-gray-500 mt-1">
                  {monthlyTrend.length > 0
                    ? `${formatCurrency(Math.max(...monthlyTrend.map(m => m.cost)))}€`
                    : ''}
                </p>
              </div>
              <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
                <span className="text-gray-500 text-sm">Projection annuelle</span>
                <div className="text-3xl font-bold text-blue-600 mt-2">
                  ~{formatCurrency((summary?.total || 0) * 12)}€
                </div>
                <p className="text-sm text-gray-500 mt-1">Basé sur le mois actuel</p>
              </div>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="text-center text-sm text-gray-400 pt-4 pb-2">
          <p>Données synchronisées via l'API OVHcloud</p>
          {importStatus?.latest && (
            <p className="mt-1">
              Dernière sync: {new Date(importStatus.latest.completed_at).toLocaleString('fr-FR')}
              ({importStatus.latest.bills_imported} factures)
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
