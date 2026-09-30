import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell,
} from 'recharts';
import { pieLabel } from '../components/pieLabels.jsx';
import { SortableHeader, sortRows } from '../components/SortableHeader.jsx';
import { accountInBrackets } from '../utils/accounts.js';
import { formatPercent, takesSingular } from '../utils/format.js';

// The share of the Cloud total of the month that a project's amount is: 0 of a Cloud total of
// 0 € (#87)
const shareOf = (total, cloudTotal) => (cloudTotal ? total / cloudTotal : 0);

// The value of a project of the breakdown in each column that sorts it (#146): its account,
// none without the Account column, and its share of the Cloud total of the month
const breakdownValues = (accountColumn, cloudTotal) => ({
  name: (p) => p.projectName,
  account: (p) => accountColumn?.nameOf(p.account),
  total: (p) => p.total,
  share: (p) => shareOf(p.total, cloudTotal),
});

// The value of a project of the GPU costs in each column that sorts them (#146): its account,
// none without the Account column, and its GPU types as the text of their list
const gpuProjectValues = (accountColumn) => ({
  name: (p) => p.project_name,
  account: (p) => accountColumn?.nameOf(p.account),
  flavors: (p) => p.gpu_flavors,
  total: (p) => p.total,
});

// The Overview tab, which the shell renders while it is active: what useOverviewTab()
// returns, the sort order of its tables included (#146), with the shell's language,
// translations (t) and amount format (fmt), and what the shell holds for the whole page: the
// month's figures, of the account selected in the header (#118), and the services about to
// expire, of that account too (#123), which load at page start for the KPI cards, the header,
// the Markdown report or other tabs too, and the budget with its setter, which the month-end
// forecast card reads as well. The budget is that of what the page shows (#117), with whether
// the user may change it: the dashboard budget, which setBudget changes, for all accounts, or
// else the account's own, which config.json sets, or null when it has none. Its lists, the
// breakdown by project and the GPU projects, name the account of each project in the Account
// column of the shell (accountColumn), when it shows one: they then list the projects by
// account that the hook requests, a project billed to several accounts once for each (#118).
// The services about to expire name their account there too (#123).
// Its links navigate with the shell's setters: what each one keeps open is in
// docs/adr/0001-tab-state-lives-in-the-dashboard-shell.md (#56).
const OverviewTab = ({
  sortingOf, projectsByAccount, gpuProjectsByAccount,
  language, t, fmt, accountColumn,
  summary, total, byService, byProject, byResourceType, gpuSummary,
  expiringServices, budget, setBudget,
  setActiveTab, setSelectedProject, setSelectedResourceType,
}) => {
  // The share of the budget the month has used, and the same in whole percents, which the bar
  // and its colour follow
  const budgetShare = budget?.amount ? total / budget.amount : 0;
  const budgetUsage = Math.round(budgetShare * 100);

  // The projects of the breakdown and of the GPU costs, by account for the Account column.
  // The Top projects chart, which names no account, keeps each project once.
  const breakdownProjects = accountColumn ? projectsByAccount : byProject;
  const gpuProjects = accountColumn ? gpuProjectsByAccount : gpuSummary?.byProject;
  // The sort of the breakdown, by amount until the user sorts it by another column, and that
  // of the GPU costs by project (#146)
  const breakdownSorting = sortingOf('projects');
  const gpuSorting = sortingOf('gpuProjects');

  return (
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
                label={pieLabel(({ name, percent }) => (
                  `${name} ${formatPercent(percent, language, { decimals: 0 })}`
                ))}
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

      {/* Resource Type Breakdown */}
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
                    label={pieLabel(({ name, percent }) => (
                      `${name} ${formatPercent(percent, language, { decimals: 0 })}`
                    ))}
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
                  onClick={() => setActiveTab('webcloud')}
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
                  ({formatPercent(gpuSummary.total / summary.cloudTotal, language)}{' '}
                  {language === 'en' ? 'of cloud' : 'du cloud'})
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
                      label={pieLabel(({ gpu_model, total }) => `${gpu_model}: ${fmt(total)}€`)}
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
                      <SortableHeader
                        column="name" kind="text" sorting={gpuSorting} t={t}
                        className="p-2 text-left font-medium"
                      >
                        {t('project')}
                      </SortableHeader>
                      {accountColumn && (
                        <SortableHeader
                          column="account" kind="text" sorting={gpuSorting} t={t}
                          className="p-2 text-left font-medium"
                        >
                          {accountColumn.label}
                        </SortableHeader>
                      )}
                      <SortableHeader
                        column="flavors" kind="text" sorting={gpuSorting} t={t}
                        className="p-2 text-left font-medium"
                      >
                        {t('gpuFlavors')}
                      </SortableHeader>
                      <SortableHeader
                        column="total" kind="number" sorting={gpuSorting} t={t}
                        className="p-2 text-right font-medium"
                      >
                        {t('amount')}
                      </SortableHeader>
                    </tr>
                  </thead>
                  <tbody>
                    {sortRows(
                      gpuProjects, gpuSorting.sort, gpuProjectValues(accountColumn), language,
                    ).map(p => {
                      const share = gpuSummary.total ? p.total / gpuSummary.total : 0;
                      // A project billed to several accounts has a row for each (#118)
                      const key = accountColumn ? `${p.project_id} ${p.account}` : p.project_id;
                      return (
                        <tr key={key} className="border-b hover:bg-gray-50">
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
                          {accountColumn && (
                            <td className="p-2 text-xs text-gray-600">
                              {accountColumn.nameOf(p.account)}
                            </td>
                          )}
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
                            <div className="text-xs text-gray-400">
                              {formatPercent(share, language)}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="bg-gray-50 font-semibold">
                      <td className="p-2" colSpan={2 + (accountColumn ? 1 : 0)}>{t('gpuTotal')}</td>
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
                <SortableHeader
                  column="name" kind="text" sorting={breakdownSorting} t={t}
                  className="p-3 text-left font-medium"
                >
                  {t('project')}
                </SortableHeader>
                {accountColumn && (
                  <SortableHeader
                    column="account" kind="text" sorting={breakdownSorting} t={t}
                    className="p-3 text-left font-medium"
                  >
                    {accountColumn.label}
                  </SortableHeader>
                )}
                <SortableHeader
                  column="total" kind="number" sorting={breakdownSorting} t={t}
                  className="p-3 text-right font-medium"
                >
                  {t('amount')}
                </SortableHeader>
                <SortableHeader
                  column="share" kind="number" sorting={breakdownSorting} t={t}
                  className="p-3 text-right font-medium"
                >
                  %
                </SortableHeader>
              </tr>
            </thead>
            <tbody>
              {sortRows(
                breakdownProjects, breakdownSorting.sort,
                breakdownValues(accountColumn, summary?.cloudTotal), language,
              ).map((p, i) => {
                // With one decimal, 0,0 % of a Cloud total of 0 € included (#87)
                const share = shareOf(p.total, summary?.cloudTotal);
                // A project billed to several accounts has a row for each (#118)
                const key = accountColumn ? `${p.projectId} ${p.account}` : p.projectId || i;
                return (
                  <tr key={key} className="border-b hover:bg-gray-50">
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
                    {accountColumn && (
                      <td className="p-3 text-gray-600">{accountColumn.nameOf(p.account)}</td>
                    )}
                    <td className="p-3 text-right font-medium">{fmt(p.total)}€</td>
                    <td className="p-3 text-right text-gray-500">
                      {formatPercent(share, language)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="bg-gray-50 font-semibold">
                <td className="p-3" colSpan={1 + (accountColumn ? 1 : 0)}>
                  {t('cloudTotal')}
                </td>
                <td className="p-3 text-right">{fmt(summary?.cloudTotal || 0)}€</td>
                <td className="p-3 text-right">{formatPercent(1, language, { decimals: 0 })}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* Budget Progress: none for an account without a budget of its own, rather than
          compare it with the budget of all accounts (#117) */}
      {budget !== null && (
        <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100 lg:col-span-2">
          <div className="flex justify-between items-center mb-3">
            <span className="font-semibold text-gray-900">{t('budgetConsumption')}</span>
            <span className={`px-3 py-1 rounded-full text-sm font-medium ${
              budgetUsage > 80 ? 'bg-orange-100 text-orange-700' : 'bg-green-100 text-green-700'
            }`}>
              {formatPercent(budgetShare, language, { decimals: 0 })} {t('used')}
            </span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-3 overflow-hidden">
            <div
              className={`h-3 rounded-full transition-all duration-500 ${
                budgetUsage > 80 ? 'bg-orange-500' : 'bg-blue-600'
              }`}
              style={{ width: `${Math.min(budgetUsage, 100)}%` }}
            />
          </div>
          <div className="flex justify-between items-center mt-2 text-sm text-gray-500">
            <span>{t('consumed')}: {fmt(total)}€</span>
            <div className="flex items-center gap-1">
              <span>{t('budget')}:</span>
              {budget.editable ? (
                <>
                  <input
                    type="number"
                    value={budget.amount}
                    onChange={(e) => setBudget(Number(e.target.value) || 0)}
                    className="w-24 px-2 py-1 border border-gray-200 rounded text-right text-sm"
                  />
                  <span>€</span>
                </>
              ) : (
                // An account's own budget, which config.json sets, and the page shows as is
                <span>{fmt(budget.amount)}€</span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Expiration Alerts */}
      {expiringServices.length > 0 && (
        <div className="bg-white rounded-xl p-5 shadow-sm border border-orange-200 lg:col-span-2">
          <h3 className="font-semibold text-orange-700 mb-4">{t('expiringSoon')}</h3>
          <div className="space-y-2">
            {expiringServices.slice(0, 5).map(s => {
              const daysLeft = Math.ceil((new Date(s.expiration_date) - new Date()) / (1000 * 60 * 60 * 24));
              // The days since it expired or until it does: "1 jour", "2 jours" (#74)
              const days = Math.abs(daysLeft);
              const singular = takesSingular(days, language);
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
                    {/* Its account, in brackets, when the lists name it (#123) */}
                    {accountColumn && (
                      <span className="text-gray-500">
                        {accountInBrackets(accountColumn, s.account)}
                      </span>
                    )}
                  </div>
                  <span className={`text-sm font-medium ${daysLeft <= 7 ? 'text-red-600' : 'text-orange-600'}`}>
                    {/* A service already expired, first in the list, says since when (#74) */}
                    {daysLeft < 0 ? (
                      <>{t('expiredSince')} {days} {t(singular ? 'dayAgo' : 'daysAgo')}</>
                    ) : (
                      <>{t('expiringIn')} {days} {t(singular ? 'day' : 'days')}</>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

    </div>
  );
};

export { OverviewTab };
