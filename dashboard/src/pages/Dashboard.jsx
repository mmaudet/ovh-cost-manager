import { Fragment, useState, useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchAccounts, fetchMonths, fetchSummary, fetchByProject, fetchByService,
  fetchImportStatus, fetchConfig, fetchUser,
  fetchConsumptionCurrent, fetchConsumptionForecast,
  fetchExpiringServices,
  fetchByResourceType, fetchGpuSummary,
} from '../services/api';
import { useLanguage } from '../hooks/useLanguage.jsx';
import { useMonthInProgressProjection } from '../hooks/useMonthInProgressProjection.js';
import { useSelectedAccount } from '../hooks/useSelectedAccount.js';
import Logo from '../components/Logo';
import { AccountSelector } from '../components/AccountSelector.jsx';
import { HeaderSelect } from '../components/HeaderSelect.jsx';
import { ImportStatus, importStatusName } from '../components/ImportStatus.jsx';
import { ResyncButton } from '../components/ResyncButton.jsx';
import { SortableHeader, sortRows, useTableSorts } from '../components/SortableHeader.jsx';
import {
  accountColumnOf, accountLabel, accountQuery, accountsOf, budgetOf, importStateOf,
  offersAccounts, scopeLabel,
} from '../utils/accounts.js';
import { formatCurrency, formatMonthLabel, yearMonthOf } from '../utils/format.js';
import { parseSqliteDate } from '../utils/sqliteDate.js';
import { generateMarkdownReport, reportFileName } from '../utils/markdownReport.js';
import { holdsMonth, isMonthInProgress } from '../utils/months.js';
import { shiftMonths } from '../utils/monthWindow.js';
import { comparedMonthsOf } from '../utils/monthComparison.js';
import { comparedVariation } from '../utils/variation.js';
import { useWebCloudTab } from '../tabs/useWebCloudTab.js';
import { WebCloudTab, WebCloudTabModals } from '../tabs/WebCloudTab.jsx';
import { useBackupTab } from '../tabs/useBackupTab.js';
import { BackupTab } from '../tabs/BackupTab.jsx';
import { useCarbonTab } from '../tabs/useCarbonTab.js';
import { CarbonTab } from '../tabs/CarbonTab.jsx';
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

// Translation keys for the import_log type values
const IMPORT_TYPE_KEYS = {
  full: 'importTypeFull',
  period: 'importTypePeriod',
  differential: 'importTypeDifferential'
};

// When an import of the history ended, or started while it runs
const importDateOf = (h) => parseSqliteDate(h.completed_at || h.started_at);

// The type of an import of the history, as the history names it
const importTypeName = (h, t) => t(IMPORT_TYPE_KEYS[h.type] || h.type);

// The value of an import of the history in each column, which the history sorts by (#146): its
// date, and its type and status as the history names them
const importHistoryValues = (t) => ({
  date: importDateOf,
  type: (h) => importTypeName(h, t),
  status: (h) => importStatusName(h.status, t),
  bills: (h) => h.bills_imported,
});

// The page of a release's notes, before its tag, such as v3.3.1: the footer links the version
// that runs to its own (#188)
const RELEASE_TAG_URL = 'https://github.com/mmaudet/ovh-cost-manager/releases/tag';

// The age, in days, beyond which the banner warns of a synchronisation
const SYNC_WARNING_DAYS = 30;
const DAY_MS = 1000 * 60 * 60 * 24;

// The colours of each tone of the "vs previous month" variation: red when the cost grows,
// green when it shrinks, grey when the variation rounds to 0 (#87)
const VARIATION_TONES = {
  increase: 'text-red-500',
  decrease: 'text-green-500',
  neutral: 'text-gray-500',
};

export default function Dashboard() {
  const { language, setLanguage, t } = useLanguage();
  const [selectedMonth, setSelectedMonth] = useState(null);
  const [activeTab, setActiveTab] = useState('overview');
  // The dashboard budget, which the page compares the figures of all accounts with: that of
  // config.json once the configuration loads, which the user may change for the visit
  const [dashboardBudget, setDashboardBudget] = useState(50000); // Default budget
  const [syncWarningDismissed, setSyncWarningDismissed] = useState(false);
  const [selectedProject, setSelectedProject] = useState(null);
  const [selectedResourceType, setSelectedResourceType] = useState(null);
  // The sort order of the shell's own table, the import history of the footer (#146), in the
  // order of the server, the latest first, until the user sorts it
  const sortingOf = useTableSorts();

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
  // Whether the server runs imports: the resync shows only then, as the server would refuse
  // it otherwise (#51)
  const importsEnabled = !!configData?.importEnabled;

  // Fetch current user
  const { data: userData } = useQuery({
    queryKey: ['user'],
    queryFn: fetchUser
  });

  // The accounts of the instance, which the header offers to select when it knows two at
  // least (#115): undefined while their list loads, none when it cannot load
  const { data: accountList, isError: accountsFailed } = useQuery({
    queryKey: ['accounts'],
    queryFn: fetchAccounts,
  });
  const accounts = accountList ? accountsOf(accountList) : (accountsFailed ? [] : undefined);

  // The account the page shows, page-wide: null for all accounts, undefined until the page
  // knows it. The months list, the KPI cards of the month's figures and of the current month's
  // consumption (#116), the Overview's figures (#118), the budget that they are compared with
  // (#117), the Compare tab and the Veeam backups (#119), the Web Cloud (#122) and
  // Infrastructure (#123) tabs, and the services about to expire (#123) follow it.
  const { selectedAccount, selectAccount } = useSelectedAccount(accounts);
  // The Account column of the lists, which name the account of each row with all accounts
  // shown, when the page offers several (#121): null when they name none
  const accountColumn = accountColumnOf(accounts, selectedAccount, t);
  // What the page shows, all accounts or the account selected, as the report's title names
  // it when the page offers several (#124): null when it names none
  const scope = scopeLabel(accounts, selectedAccount, t);
  // Whether the page projects the month in progress (#214), page-wide, and what turns it on or
  // off: the Trends tab shows it next to its period selector, and its trends follow it (#217)
  const projection = useMonthInProgressProjection();

  // The months billed to the account shown
  const { data: months = [], isSuccess: monthsLoaded } = useQuery(accountQuery(selectedAccount, {
    key: ['months'],
    fetch: fetchMonths,
  }));

  // Whether the months billed to the account shown hold the month selected: not while they
  // load, nor when the user selected an account not billed that month, until the page selects
  // its latest month (below). The queries of that month wait until they do: the tab hooks get
  // it from here, rather than check it again (#120).
  const holdsSelectedMonth = holdsMonth(months, selectedMonth);

  // The figures of the month selected, once the account shown has it
  const { data: summary, isLoading: loadingSummary } = useQuery(accountQuery(selectedAccount, {
    key: ['summary', selectedMonth?.from, selectedMonth?.to],
    fetch: (account) => fetchSummary(selectedMonth.from, selectedMonth.to, account),
    enabled: holdsSelectedMonth,
  }));

  // The month just before the selected one in the calendar, as the months list gives it:
  // none when nothing was billed that month, as before the first billed month. The "vs
  // previous month" KPI compares the selected month with its summary (#50), under the key of
  // the Compare tab's month A when they are the same month, for all accounts. Month A
  // defaults to the second latest billed month (months[1]): the month before the latest,
  // unless that one had no bill.
  const previousMonth = selectedMonth
    ? months.find((m) => m.from === shiftMonths(selectedMonth.from, -1))
    : undefined;
  const { data: previousSummary, isLoading: loadingPreviousSummary } = useQuery(
    accountQuery(selectedAccount, {
      key: ['summary', previousMonth?.from, previousMonth?.to],
      fetch: (account) => fetchSummary(previousMonth.from, previousMonth.to, account),
      enabled: !!previousMonth,
    }),
  );

  // The Overview's figures of the month selected, once the account shown has it, as its
  // summary (#118): the Markdown report and other tabs read them too
  const { data: byService = [] } = useQuery(accountQuery(selectedAccount, {
    key: ['byService', selectedMonth?.from, selectedMonth?.to],
    fetch: (account) => fetchByService(selectedMonth.from, selectedMonth.to, account),
    enabled: holdsSelectedMonth,
  }));

  // Its costs by project, undefined until they load: the Public Cloud tab's list of projects
  // waits for them (#180)
  const { data: byProjectOfMonth, isError: byProjectFailed } = useQuery(
    accountQuery(selectedAccount, {
      key: ['byProject', selectedMonth?.from, selectedMonth?.to],
      fetch: (account) => fetchByProject(selectedMonth.from, selectedMonth.to, account),
      enabled: holdsSelectedMonth,
    }),
  );
  const byProject = byProjectOfMonth ?? [];

  const { data: byResourceType = [] } = useQuery(accountQuery(selectedAccount, {
    key: ['byResourceType', selectedMonth?.from, selectedMonth?.to],
    fetch: (account) => fetchByResourceType(selectedMonth.from, selectedMonth.to, account),
    enabled: holdsSelectedMonth,
  }));

  // GPU costs of the selected month, for the Overview and the Public Cloud tab
  const { data: gpuSummary } = useQuery(accountQuery(selectedAccount, {
    key: ['gpuSummary', selectedMonth?.from, selectedMonth?.to],
    fetch: (account) => fetchGpuSummary(selectedMonth.from, selectedMonth.to, account),
    enabled: holdsSelectedMonth,
  }));

  const { data: importStatus } = useQuery({
    queryKey: ['importStatus'],
    queryFn: fetchImportStatus,
    // Poll while an import is in progress so the footer follows it, every
    // 30 s to stay well below the general API rate limit (100 requests per
    // 15 minutes per IP by default)
    refetchInterval: (query) => (query.state.data?.running ? 30000 : false)
  });

  // The current month's consumption so far and its month-end forecast, for the KPI cards: the
  // account shown's, or the sum of the accounts' for all accounts (#116)
  const { data: consumptionCurrent } = useQuery(accountQuery(selectedAccount, {
    key: ['consumptionCurrent'],
    fetch: fetchConsumptionCurrent,
  }));

  const { data: consumptionForecast } = useQuery(accountQuery(selectedAccount, {
    key: ['consumptionForecast'],
    fetch: fetchConsumptionForecast,
  }));

  // The services of the account shown that expire within 30 days, or already have, whatever
  // the month: the header counts them, and the Overview lists them (#123)
  const { data: expiringServices = [] } = useQuery(accountQuery(selectedAccount, {
    key: ['expiringServices'],
    fetch: (account) => fetchExpiringServices(30, account),
  }));

  // Each tab's state and queries, in the order of the tab bar: its hook runs on every render,
  // before the loading screen, so that the tab keeps them while another one is open (ADR 0001)

  const overviewTab = useOverviewTab({ selectedMonth, holdsSelectedMonth, accountColumn });
  // What the month billed each project, which the Public Cloud tab's list of projects gives
  // (#180): by account while the lists name the account of each project, as the Overview's
  // breakdown does, from the projects by account that the Overview hook loads, or else the costs
  // by project of the account shown. Undefined until they load, or when they cannot: the list
  // then gives no amount, rather than show that nothing was billed.
  const billedProjects = accountColumn
    ? (overviewTab.projectsByAccountLoaded ? overviewTab.projectsByAccount : undefined)
    : byProjectOfMonth;
  // Whether they could not load, which the list says rather than leave its amounts blank
  const billedProjectsFailed = accountColumn
    ? overviewTab.projectsByAccountFailed
    : byProjectFailed;

  const compareTab = useCompareTab({ months, activeTab, selectedAccount, accountColumn });

  const trendsTab = useTrendsTab({
    months, selectedMonth, holdsSelectedMonth, selectedAccount, activeTab,
    projectsMonthInProgress: projection.projectsMonthInProgress,
  });

  const publicCloudTab = usePublicCloudTab({
    selectedMonth, holdsSelectedMonth, activeTab, selectedProject, selectedAccount,
  });

  const webCloudTab = useWebCloudTab({
    selectedMonth, holdsSelectedMonth, activeTab, selectedAccount,
  });

  const infrastructureTab = useInfrastructureTab({
    selectedMonth, holdsSelectedMonth, activeTab, selectedResourceType, selectedAccount,
    accountColumn,
  });

  const backupTab = useBackupTab({
    selectedMonth, holdsSelectedMonth, activeTab, selectedAccount,
  });

  const carbonTab = useCarbonTab({
    selectedMonth, holdsSelectedMonth, activeTab, selectedAccount,
  });

  // Update budget when config loads
  useEffect(() => {
    if (configData?.budget) {
      setDashboardBudget(configData.budget);
    }
  }, [configData]);

  // Select the latest month when the months list loads without the month selected: when the
  // page opens, as useCompareTab sets months A and B then, in the same commit, and when the
  // account selected was not billed that month (#115). useCompareTab sets months A and B
  // again when the list of the account selected lacks one of them, or when they are the same
  // month (#119).
  useEffect(() => {
    if (months.length > 0 && !holdsSelectedMonth) {
      setSelectedMonth(months[0]);
    }
  }, [months, holdsSelectedMonth]);

  // The browser gives a printed page's PDF the page's title, which names what the page shows
  // after its own while the browser prints it, from the PDF export or from its own print
  // command, as the Markdown report's title does (#124). The browser tells the page before
  // and after it prints, whatever becomes of the print. A single-account page, which names
  // no account, keeps its title.
  useEffect(() => {
    if (!scope) return undefined;
    // The page's own title while the browser prints, null otherwise
    let pageTitle = null;
    const nameScope = () => {
      if (pageTitle === null) pageTitle = document.title;
      document.title = `${pageTitle} - ${scope}`;
    };
    const restoreTitle = () => {
      if (pageTitle === null) return;
      document.title = pageTitle;
      pageTitle = null;
    };
    window.addEventListener('beforeprint', nameScope);
    window.addEventListener('afterprint', restoreTitle);
    return () => {
      restoreTitle();
      window.removeEventListener('beforeprint', nameScope);
      window.removeEventListener('afterprint', restoreTitle);
    };
  }, [scope]);

  const queryClient = useQueryClient();

  // Once the latest import has finished, refresh every query built from
  // imported data (all of them but config, user and the import status): the
  // accounts among them, with the budget that each one's import records (#117).
  // The latest import: undefined until the import status loads, null when there was none
  const latestImport = importStatus ? (importStatus.latest ?? null) : undefined;
  const previousImport = useRef(latestImport);
  useEffect(() => {
    const previous = previousImport.current;
    previousImport.current = latestImport;
    if (previous === undefined || !latestImport || latestImport.status === 'running') return;
    // Over since the status was last read: another import, the one that was running, or the
    // first one ever, which the refresh 8 s after a resync can find over already (#51)
    if (!previous || previous.id !== latestImport.id || previous.status === 'running') {
      queryClient.invalidateQueries({
        predicate: (query) => !['config', 'user', 'importStatus'].includes(query.queryKey[0])
      });
    }
  }, [latestImport, queryClient]);

  // The oldest month of the list: there is no month before it to compare with
  const isFirstBilledMonth = selectedMonth?.value === months[months.length - 1]?.value;
  // Whether the month selected is the month in progress, whose cost lacks that of the recurring
  // services that it has not billed yet (#216), as the months list marks it now
  const selectedMonthInProgress = isMonthInProgress(months, selectedMonth);

  // Calculations
  const total = summary?.total || 0;
  // The budget that the Overview's budget card and the month-end forecast compare the figures
  // shown with (#117), and whether the user may change it: the dashboard budget for all
  // accounts, or else the account's own, which config.json sets, null when it has none. The
  // accounts route gives it, as the account's last import recorded it: the page reloads it
  // with the accounts once an import is over.
  const budget = budgetOf(accounts, selectedAccount, dashboardBudget);
  // The "vs previous month" variation, from the month before (#50), as the page shows it: its
  // text and its tone, as in the Compare and Trends tabs (#87), or, as there, the key of the
  // tooltip that says why it shows none: the month in progress, which it would compare, partial,
  // with a complete month (#216), or a month before at 0 € or less, or without a bill, so at
  // 0 € (#65)
  const variation = comparedVariation(
    comparedMonthsOf(months, previousMonth, selectedMonth), previousSummary?.total ?? 0, total,
    language, { notComputable: 'vsPreviousMonthNotComputable' },
  );

  // Nothing billed yet, as on a new account or before its first import (#51): with no month
  // to select, there is no dashboard to show. Say so, rather than load forever, and offer the
  // resync of the header when the server runs imports. For an account selected, whose first
  // import may have failed, the account selector stays, to select another (#115).
  if (monthsLoaded && months.length === 0) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 p-4 flex">
        <div className="m-auto max-w-md text-center space-y-4">
          <h2 className="text-2xl font-bold text-gray-900">{t('noDataYet')}</h2>
          <p className="text-gray-500">{t('noDataYetHint')}</p>
          <AccountSelector
            accounts={accounts} selectedAccount={selectedAccount} onSelect={selectAccount} t={t}
          />
          {importsEnabled && <ResyncButton t={t} />}
        </div>
      </div>
    );
  }

  // Loading state, until the months list of the account shown holds the selected month, as
  // while it loads for another account, and the KPI cards have both months they compare (#50)
  if (!holdsSelectedMonth || loadingSummary || loadingPreviousSummary) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 flex items-center justify-center">
        <div className="text-center">
          <div className="text-4xl mb-4">{t('loadingTitle')}</div>
          <p className="text-gray-500">{t('loading')}</p>
        </div>
      </div>
    );
  }

  // The accounts whose last synchronisation the footer shows, one line each, when the page
  // offers several (#124): every account but the Unknown account, which no import reads, in
  // the order of the accounts route. Null when the page offers none, or before any account's
  // import has ended, as during the first run of several accounts, which records them all
  // before it imports any.
  const syncedAccounts = accounts && offersAccounts(accounts)
    && accounts.some(({ lastImport }) => lastImport !== null)
    ? accounts.filter(({ unknown }) => !unknown)
    : null;

  // Calculate days since last import
  const daysSinceLastImport = importStatus?.latest?.completed_at
    ? Math.floor((new Date() - new Date(importStatus.latest.completed_at)) / DAY_MS)
    : null;
  // With the accounts' lines, the banner warns of each configured account whose last import
  // that succeeded ended too long ago, or which none has, with its age in days, null for
  // never: not of the latest run, which a run that some accounts failed keeps recent (#124).
  // An account no longer configured is no longer imported. Null without the accounts' lines:
  // the banner then warns of the latest run, as before several accounts.
  const staleAccounts = syncedAccounts && syncedAccounts
    .filter(({ configured }) => configured)
    .map((account) => ({
      ...account,
      days: account.lastSuccessAt === null
        ? null
        : Math.floor((new Date() - parseSqliteDate(account.lastSuccessAt)) / DAY_MS),
    }))
    .filter(({ days }) => days === null || days > SYNC_WARNING_DAYS);
  const showSyncWarning = !syncWarningDismissed && (staleAccounts
    ? staleAccounts.length > 0
    : daysSinceLastImport !== null && daysSinceLastImport > SYNC_WARNING_DAYS);
  // The footer shows the latest import's line alone without them, as before several
  // accounts. With them, it shows it while an import runs: the cue that the page asks every
  // 30 s whether it is over (#51).
  const showsLatestImport = Boolean(importStatus?.latest)
    && (syncedAccounts === null || !importStatus.latest.completed_at);
  const importHistorySorting = sortingOf('importHistory');

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 p-4 md:p-6">
      <div className="max-w-7xl mx-auto space-y-6">

        {/* Sync Warning Banner */}
        {showSyncWarning && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-amber-600 text-xl">⚠️</span>
              <p className="text-amber-800 text-sm">
                {staleAccounts ? (
                  // Each account as the account selector names it, and its age
                  <>
                    {t('staleAccountsWarning')} {SYNC_WARNING_DAYS}{' '}
                    {t('staleAccountsWarningDays')}{' '}
                    {staleAccounts.map(({ days, ...account }, index) => (
                      <Fragment key={account.id}>
                        {index > 0 && ', '}
                        <strong>{accountLabel(account, t)}</strong>
                        {' ('}{days === null ? t('lastSyncNever') : `${days} ${t('days')}`}{')'}
                      </Fragment>
                    ))}.{' '}
                  </>
                ) : (
                  <>
                    {t('syncWarning')} <strong>{daysSinceLastImport}</strong>{' '}
                    {t('syncWarningDays')}.{' '}
                  </>
                )}
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
          <div className="flex items-center gap-3 shrink-0">
            {/* What the logo and the tab bar keep open: ADR 0001 (#56) */}
            <button
              onClick={() => {
                setActiveTab('overview');
                setSelectedProject(null);
                setSelectedResourceType(null);
              }}
              className="cursor-pointer"
            >
              <Logo className="h-14" />
            </button>
            {/* The title, and the subtitle under it, each on one line */}
            <div className="whitespace-nowrap">
              <h1 className="text-2xl font-bold text-gray-900">{t('appTitle')}</h1>
              <p className="text-gray-500 text-sm">{t('appSubtitle')}</p>
            </div>
          </div>
          {/* The controls, 8 px apart so as to share the title's line from a 1280 px screen up.
              When they lack room, the last ones go whole to a line of their own, rather than
              squeeze the title or wrap a name. Below md, under the title, they align left */}
          <div className="flex flex-wrap items-center md:justify-end gap-2">
            {/* Manual resync */}
            {importsEnabled && <ResyncButton t={t} />}
            {/* Expiration badge */}
            {expiringServices.length > 0 && (
              <div className="flex items-center gap-1 px-3 py-1.5 bg-orange-100 text-orange-700 rounded-lg text-sm font-medium">
                <span>{expiringServices.length}</span>
                <span>{t('expiringSoon')}</span>
              </div>
            )}
            {/* User info */}
            {userData?.id && (
              <div
                className={'flex items-center gap-2 px-3 py-1.5 bg-gray-100 rounded-lg'
                  + ' whitespace-nowrap'}
              >
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
            {/* The account the page shows, on every tab, when the instance knows two at
                least (#115) */}
            <AccountSelector
              accounts={accounts} selectedAccount={selectedAccount} onSelect={selectAccount} t={t}
            />
            {activeTab !== 'compare' && (
              <>
                <HeaderSelect
                  value={selectedMonth.value}
                  onChange={(e) => {
                    const month = months.find(m => m.value === e.target.value);
                    setSelectedMonth(month);
                  }}
                >
                  {months.map(m => (
                    <option key={m.value} value={m.value}>
                      {formatMonthLabel(m.value, language)}
                    </option>
                  ))}
                </HeaderSelect>
                {/* The export, named by its placeholder */}
                <select
                  onChange={(e) => {
                    const format = e.target.value;
                    if (format === 'md') {
                      // The figures of the account shown, which the shell holds (#115, #118),
                      // of a month that the report says is in progress, when it is (#216)
                      const md = generateMarkdownReport(
                        summary, byService, byProject, selectedMonth, language, {
                          scope,
                          inProgressLabel: selectedMonthInProgress ? t('monthInProgress') : null,
                        },
                      );
                      const blob = new Blob([md], { type: 'text/markdown' });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = reportFileName(selectedMonth.value, selectedAccount);
                      a.click();
                      URL.revokeObjectURL(url);
                    } else if (format === 'pdf') {
                      // Under a title that names what the page shows (see above, #124)
                      window.print();
                    }
                    e.target.value = '';
                  }}
                  className={'px-3 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium'
                    + ' cursor-pointer'}
                  defaultValue=""
                >
                  <option value="" disabled>{t('export')}</option>
                  <option value="md">{t('markdown')}</option>
                  <option value="pdf">{t('pdf')}</option>
                </select>
              </>
            )}
            {/* The page's language, last of the controls, with the look of the other selectors */}
            <HeaderSelect value={language} onChange={(e) => setLanguage(e.target.value)}>
              <option value="fr">FR</option>
              <option value="en">EN</option>
            </HeaderSelect>
          </div>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white rounded-xl p-5 shadow-sm border-2 border-blue-500">
            <div className="flex justify-between items-start mb-3">
              <span className="text-gray-500 text-sm font-medium">{t('totalCost')}</span>
              {/* The month in progress says so: its cost lacks bills to come (#216) */}
              {selectedMonthInProgress && (
                <span
                  className={'px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 text-xs'
                    + ' font-medium'}
                >
                  {t('monthInProgress')}
                </span>
              )}
            </div>
            <div className="text-2xl font-bold text-gray-900">{fmt(total)}€</div>
            {!variation.why ? (
              <div className={`flex items-center mt-2 text-sm ${VARIATION_TONES[variation.tone]}`}>
                {variation.text} {t('vsPreviousMonth')}
              </div>
            ) : isFirstBilledMonth ? (
              <div className="flex items-center mt-2 text-sm text-gray-400">
                {t('noPreviousData')}
              </div>
            ) : (
              // "—", with a tooltip that says why, as in the Compare and Trends tabs (#65, #216)
              <div
                className="flex items-center mt-2 text-sm text-gray-400" title={t(variation.why)}
              >
                — {t('vsPreviousMonth')}
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
                  <span className="text-xs text-gray-400">
                    {formatMonthLabel(yearMonthOf(new Date()), language)}
                  </span>
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
                  {/* None for an account without a budget of its own */}
                  {budget !== null && consumptionForecast.forecast_total > budget.amount
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
              { id: 'carbon', labelKey: 'carbon' },
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
            <TrendsPeriodSelector {...trendsTab} {...projection} t={t} />
          )}
        </div>

        {/* Tab Content - Overview */}
        {activeTab === 'overview' && (
          <OverviewTab
            {...overviewTab} language={language} t={t} fmt={fmt}
            accountColumn={accountColumn}
            summary={summary} total={total} byService={byService} byProject={byProject}
            byResourceType={byResourceType} gpuSummary={gpuSummary}
            expiringServices={expiringServices} budget={budget} setBudget={setDashboardBudget}
            setActiveTab={setActiveTab} setSelectedProject={setSelectedProject}
            setSelectedResourceType={setSelectedResourceType}
          />
        )}

        {/* Tab Content - Compare */}
        {activeTab === 'compare' && (
          <CompareTab
            {...compareTab} language={language} t={t} fmt={fmt}
            months={months} accountColumn={accountColumn}
          />
        )}

        {/* Tab Content - Trends */}
        {activeTab === 'trends' && (
          <TrendsTab {...trendsTab} months={months} language={language} t={t} fmt={fmt} />
        )}

        {/* Tab Content - Web Cloud */}
        {activeTab === 'webcloud' && (
          <WebCloudTab
            {...webCloudTab} language={language} t={t} fmt={fmt} accountColumn={accountColumn}
          />
        )}

        {/* Tab Content - Public Cloud */}
        {activeTab === 'inventory' && (
          <PublicCloudTab
            {...publicCloudTab} language={language} t={t} fmt={fmt} locale={locale}
            selectedMonth={selectedMonth}
            setSelectedProject={setSelectedProject} byResourceType={byResourceType}
            gpuSummary={gpuSummary} accountColumn={accountColumn} cloudTotal={summary?.cloudTotal}
            billedProjects={billedProjects} billedProjectsFailed={billedProjectsFailed}
          />
        )}

        {/* Tab Content - Infrastructure */}
        {activeTab === 'infrastructure' && (
          <InfrastructureTab
            {...infrastructureTab} language={language} t={t} fmt={fmt}
            accountColumn={accountColumn}
            selectedMonth={selectedMonth} byResourceType={byResourceType}
            selectedResourceType={selectedResourceType}
            setSelectedResourceType={setSelectedResourceType}
          />
        )}

        {/* Tab Content - Backup */}
        {activeTab === 'backup' && (
          <BackupTab
            {...backupTab} language={language} t={t} fmt={fmt}
            selectedMonth={selectedMonth} summary={summary} byResourceType={byResourceType}
          />
        )}

        {/* Tab Content - Carbon footprint (#147) */}
        {activeTab === 'carbon' && (
          <CarbonTab
            {...carbonTab} language={language} t={t} fmt={fmt}
            accountImport={importStateOf(accounts, selectedAccount)} accountColumn={accountColumn}
          />
        )}

        {/* Footer */}
        <div className="text-center text-sm text-gray-400 pt-4 pb-2">
          <p>{t('syncedVia')}</p>
          {/* The version of OCM that runs, which the configuration route gives, on a line of its
              own, apart from the synchronisations below, linked to its release notes, so that
              whoever uses the page knows which version is deployed (#188): none from a server
              that gives none */}
          {configData?.version && (
            <div className="mt-1">
              <a
                href={`${RELEASE_TAG_URL}/v${configData.version}`}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-gray-600 hover:underline"
              >
                {t('appTitle')} v{configData.version}
              </a>
            </div>
          )}
          {showsLatestImport && (
            <p className="mt-1">
              {t('lastSync')}: {importStatus.latest.completed_at ? (
                <>
                  {parseSqliteDate(importStatus.latest.completed_at).toLocaleString(locale)}
                  {' '}({importStatus.latest.bills_imported} {t('bills')})
                </>
              ) : t('importStatusRunning')}
            </p>
          )}
          {syncedAccounts?.map(({ lastImport, lastSuccessAt, ...account }) => (
            // Each account as the account selector names it, and when its last import that
            // succeeded ended: its data is as that import left it, whatever the imports that
            // failed since. When its last import failed, when, with why over it, as the
            // import history says it of a run (#113).
            <p key={account.id} className="mt-1">
              {accountLabel(account, t)} — {t('lastSync')}:{' '}
              {lastSuccessAt
                ? parseSqliteDate(lastSuccessAt).toLocaleString(locale)
                : t('lastSyncNever')}
              {lastImport?.status === 'failed' && (
                <>
                  {' ('}
                  <ImportStatus status={lastImport.status} error={lastImport.error} t={t}>
                    {t('lastImportFailedOn')}{' '}
                    {parseSqliteDate(lastImport.at).toLocaleString(locale)}
                  </ImportStatus>
                  {')'}
                </>
              )}
            </p>
          ))}

          {/* Import history */}
          <details className="mt-3 max-w-2xl mx-auto text-left">
            <summary className="cursor-pointer text-gray-500 hover:text-gray-700 text-center">
              {t('importHistory')}
            </summary>
            {importStatus?.history?.length > 0 ? (
              <table className="w-full mt-2 text-xs border-collapse">
                <thead>
                  <tr className="text-gray-500 border-b border-gray-200">
                    <SortableHeader
                      column="date" kind="date" sorting={importHistorySorting} t={t}
                      className="text-left py-1 px-2"
                    >
                      {t('importDate')}
                    </SortableHeader>
                    <SortableHeader
                      column="type" kind="text" sorting={importHistorySorting} t={t}
                      className="text-left py-1 px-2"
                    >
                      {t('importType')}
                    </SortableHeader>
                    <SortableHeader
                      column="status" kind="text" sorting={importHistorySorting} t={t}
                      className="text-left py-1 px-2"
                    >
                      {t('importStatusLabel')}
                    </SortableHeader>
                    <SortableHeader
                      column="bills" kind="number" sorting={importHistorySorting} t={t}
                      className="text-right py-1 px-2"
                    >
                      {t('importBills')}
                    </SortableHeader>
                  </tr>
                </thead>
                <tbody>
                  {sortRows(
                    importStatus.history, importHistorySorting.sort, importHistoryValues(t),
                    language,
                  ).map((h) => (
                    <tr key={h.id} className="border-b border-gray-100">
                      <td className="py-1 px-2 text-gray-600">
                        {importDateOf(h).toLocaleString(locale)}
                      </td>
                      <td className="py-1 px-2 text-gray-600">{importTypeName(h, t)}</td>
                      <td className="py-1 px-2">
                        {/* Why it failed or ended partial, which names the accounts that
                            failed (#113) */}
                        <ImportStatus status={h.status} error={h.error_message} t={t} />
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
      <WebCloudTabModals
        {...webCloudTab} language={language} t={t} fmt={fmt} accountColumn={accountColumn}
      />

      <PublicCloudTabModals
        {...publicCloudTab} language={language} t={t} fmt={fmt} locale={locale}
        selectedMonth={selectedMonth} accountColumn={accountColumn}
      />

      <InfrastructureTabModals
        {...infrastructureTab} language={language} t={t} accountColumn={accountColumn}
      />
    </div>
  );
}
