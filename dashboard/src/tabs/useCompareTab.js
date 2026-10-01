// The Compare tab's state and data queries, in a hook that the dashboard shell calls on
// every render: see docs/adr/0001-tab-state-lives-in-the-dashboard-shell.md

import { useState, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTableSorts } from '../components/SortableHeader.jsx';
import { useUnfoldedRows } from '../components/UnfoldingRow.jsx';
import {
  fetchSummary, fetchByService, fetchByResourceType, fetchBackupStats,
  fetchBackupServices, fetchBackupServicesByAccount, fetchProjectProducts, fetchLogsDataPlatform,
} from '../services/api.js';
import { listQuery, projectedQuery } from '../utils/accounts.js';
import { BY_MONTH_A, comparedMonthsOf } from '../utils/monthComparison.js';
import { holdsMonth, isMonthInProgress } from '../utils/months.js';
import { projectsQuery } from './projectsByAccountQueries.js';
// Under the module's name: the hook gives the same name to its own query of a resource type's
// services, which asks for them as the page shows them, on the tab
import * as servicesQueries from './resourceTypeServicesQueries.js';

/**
 * The state and data queries of the Compare tab, which compares two months of the account
 * shown in the header (#119). Months A and B are months of the months list, that account's
 * (#115), which the tab's dropdowns list. They get their defaults when the list first loads:
 * the shell then selects the latest month, in the same commit. When the list of an account
 * selected since loads, they stay if it holds both and they are two months, and get that
 * account's defaults otherwise.
 * @param {object} shell - What the dashboard shell passes on, on every render
 * @param {object[]} shell.months - The months billed to the account shown, the latest first
 * @param {string} shell.activeTab - The tab open: the queries run on the Compare tab only
 * @param {?string|undefined} shell.selectedAccount - The account shown (useSelectedAccount()):
 *   null for all accounts, undefined while the page does not know it, which the queries wait
 *   for
 * @param {?{ label: string, nameOf: function(?string): string }} shell.accountColumn - The
 *   Account column of the lists (accountColumnOf()), null when they name no account: while
 *   it shows, the comparison by project names the account of each project, and the services
 *   of the rows that the tab unfolds name theirs (#194)
 * @param {boolean} [shell.projectsMonthInProgress] - The page's setting that projects the month
 *   in progress (useMonthInProgressProjection()), off by default: while it is on, the figures of
 *   the month in progress, as the months list marks it, are its projected cost (#218), those of
 *   the projects and of their products included (#219)
 * @returns {object} Months A and B and their setters, what the comparison knows of them, which
 *   decides the tab's variations (comparedMonths: see comparedMonthsOf()), the sort order of the
 *   tab's tables (sortingOf(), see useTableSorts()), the rows unfolded into what they add up
 *   (unfoldingOf(), see useUnfoldedRows()), the figures of both months, which the tab shows,
 *   the query of a project's products in a month (projectProductsQuery(projectId, month)),
 *   which the comparison of the project's products runs once opened, and the queries of a
 *   resource type's services in a month (resourceTypeServicesQuery(resourceType, month)), of
 *   a backup row's (backupServicesQuery(kind, month)) and of the Logs Data Platform charges
 *   (logsDataPlatformChargesQuery(month), #248), which the row runs once unfolded
 */
const useCompareTab = ({
  months, activeTab, selectedAccount, accountColumn, projectsMonthInProgress = false,
}) => {
  const [compareMonthA, setCompareMonthA] = useState(null);
  const [compareMonthB, setCompareMonthB] = useState(null);
  // The sort order of its tables, by table (#146): the comparison by project, by month A, the
  // most expensive first, until the user sorts it by another column, the infrastructure
  // comparison, and the comparison of each project's products, by project
  const sortingOf = useTableSorts({ projects: BY_MONTH_A });
  // The rows unfolded, by comparison: into their services (#192, #197), or a project's products
  // into their charges (#195)
  const unfoldingOf = useUnfoldedRows();

  // Whether the months list holds each month compared: not before months A and B have their
  // defaults, nor while the list of the account just selected loads, nor when that account
  // was not billed that month
  const holdsMonthA = holdsMonth(months, compareMonthA);
  const holdsMonthB = holdsMonth(months, compareMonthB);

  // The months list that months A and B were last checked against. The tab checks them when
  // another list loads, not when the user picks one: the user may compare a month with itself.
  const checkedMonths = useRef(null);

  // Months A and B by default: the second latest billed month and the latest one, or the only
  // month twice. Once a list has loaded, the tab keeps them only if it holds both and they
  // are two months (#119). It compares the months it opens on otherwise, rather than a month
  // that its dropdowns do not list, as the shell selects the latest month of an account that
  // lacks the month selected (#115), or one month with itself, as a single-month account
  // left them.
  useEffect(() => {
    if (months.length === 0 || months === checkedMonths.current) return;
    checkedMonths.current = months;
    const keeps = holdsMonthA && holdsMonthB && compareMonthA.value !== compareMonthB.value;
    if (!keeps) {
      setCompareMonthA(months[1] ?? months[0]);
      setCompareMonthB(months[0]);
    }
  }, [months, holdsMonthA, holdsMonthB, compareMonthA, compareMonthB]);

  // Whether the queries of month A or B may run: once the tab is open, and once the months
  // list holds the month, as the shell's queries of its month wait for it. No request goes
  // out for a month that the account lacks, before the tab moves to one it was billed in.
  const asksFor = (month) => activeTab === 'compare' && holdsMonth(months, month);

  // Whether the figures of month A or B are its projected cost (#218): those of the month in
  // progress, as the months list marks it, while the page projects it. Their requests and their
  // keys name the flag only then (projectedQuery()), so that the page keeps its keys while the
  // setting is off, and never shares the answer of a month at its projected cost with the shell,
  // whose figures are never projected.
  const isProjected = (month) => projectsMonthInProgress && isMonthInProgress(months, month);

  // What the comparison knows of months A and B, which the tab's variations and the sort of its
  // tables read (comparedMonthsOf()): whether either is the month in progress, which leaves no
  // variation to compute, as it would compare a partial month with a complete one (#216), unless
  // its figures are its projected cost, while the page projects it (#218), those of the projects
  // and of their products included (#219)
  const comparedMonths = comparedMonthsOf(months, compareMonthA, compareMonthB, {
    projected: projectsMonthInProgress,
  });

  // A figure of month A or B, for the account shown (#119), under a key that starts with `key`,
  // its name and what it is of, such as a project, and names the month, which fetchFigure(from,
  // to, account) requests: under the key of the same figure that the shell loads for its selected
  // month, or the Backup tab for the Veeam backups, for the same account (ADR 0001); and for the
  // month in progress while the page projects it, at its projected cost, which fetchFigure(from,
  // to, account, { projected: true }) requests, under a key of its own (#218, #219)
  const figureOf = (key, month, fetchFigure) => projectedQuery(selectedAccount, {
    key: [...key, month?.from, month?.to],
    fetch: (account, ...options) => fetchFigure(month.from, month.to, account, ...options),
    projected: isProjected(month),
    enabled: asksFor(month),
  });

  // Comparison data
  const { data: compareDataA } = useQuery(figureOf(['summary'], compareMonthA, fetchSummary));
  const { data: compareDataB } = useQuery(figureOf(['summary'], compareMonthB, fetchSummary));

  const { data: byServiceA = [] } = useQuery(
    figureOf(['byService'], compareMonthA, fetchByService),
  );
  const { data: byServiceB = [] } = useQuery(
    figureOf(['byService'], compareMonthB, fetchByService),
  );

  // The projects of month A or B: once each, for the account shown, under the key of the
  // shell's, or, while the comparison names the account of each project, with all accounts
  // shown, once for each account that billed them, with that account (#119). Those are the
  // Overview's projects by account, under the same key (#118): its query and this one share a
  // month's answer. But for the month in progress while the page projects it, at its projected
  // cost, under a key of its own (#219): the shell, the Overview and the Public Cloud tab, which
  // lists the projects that the shell or the Overview loads (#180), never project.
  const projectsOf = (month) => projectsQuery(
    selectedAccount, accountColumn, month, asksFor(month), { projected: isProjected(month) },
  );

  const { data: byProjectA = [] } = useQuery(projectsOf(compareMonthA));
  const { data: byProjectB = [] } = useQuery(projectsOf(compareMonthB));

  // What the infrastructure, backup and Private Cloud comparisons show (#32): the costs of
  // each resource type, under the key of those the page loads for its selected month, and
  // the Veeam backups, under the key of those the Backup tab loads for it
  const { data: byResourceTypeA = [] } = useQuery(
    figureOf(['byResourceType'], compareMonthA, fetchByResourceType),
  );
  const { data: byResourceTypeB = [] } = useQuery(
    figureOf(['byResourceType'], compareMonthB, fetchByResourceType),
  );

  const { data: backupStatsA } = useQuery(
    figureOf(['backupStats'], compareMonthA, fetchBackupStats),
  );
  const { data: backupStatsB } = useQuery(
    figureOf(['backupStats'], compareMonthB, fetchBackupStats),
  );

  // The options of the query of a project's products in month A or B, for useQuery: what the
  // bills of the month charged the project, for the account shown, as its cost in the
  // comparison by project (#181), a figure of the month, under a key of its own. The comparison
  // of the project's products runs it once opened, as the other figures of the month run: on the
  // tab, for a month of the months list. Those of the month in progress, while the page projects
  // it, at its projected cost, as the comparison by project asks for it (#219).
  const projectProductsQuery = (projectId, month) => figureOf(
    ['projectProducts', projectId], month,
    (...request) => fetchProjectProducts(projectId, ...request),
  );

  // The options of the query of a resource type's services in month A or B, for useQuery: those
  // that the Infrastructure tab lists for the resource type in the month, as it asks for them,
  // under the same key: the services of the account shown (#192), or, while the lists name the
  // account of each service, those of every account by account (#194). The row of the resource
  // type runs it once unfolded, as the other figures of the month run: on the tab, for a month
  // of the months list. Those of the month in progress, while the page projects it, at its
  // projected cost, under a key of their own (#218).
  const resourceTypeServicesQuery = (resourceType, month) => servicesQueries
    .resourceTypeServicesQuery(
      selectedAccount, accountColumn, resourceType, month, asksFor(month),
      { projected: isProjected(month) },
    );

  // The options of the query of the services of the Veeam backups of month A or B, for
  // useQuery, as the lists show them (listQuery()): those of the account shown, or, while the
  // lists name the account of each service, those of every account by account (#197). Those of
  // the month in progress, while the page projects it, at its projected cost (#218).
  const backupServicesOf = (month) => listQuery(accountColumn, {
    byAccount: {
      key: ['backupServicesByAccount', month?.from, month?.to],
      fetch: (...options) => fetchBackupServicesByAccount(month.from, month.to, ...options),
    },
    ofAccountShown: {
      account: selectedAccount,
      key: ['backupServices', month?.from, month?.to],
      fetch: (account, ...options) => fetchBackupServices(
        month.from, month.to, account, ...options,
      ),
    },
    projected: isProjected(month),
    enabled: asksFor(month),
  });

  // The options of the query of a backup row's services in month A or B, for useQuery: the
  // Veeam VMs backed up (kind 'vms') or the Enterprise licences ('enterprise') of the month
  // (#197). Both rows' come in one answer a month, asked for once, of which each row selects
  // its own. The row runs it once unfolded, as the other figures of the month run: on the tab,
  // for a month of the months list. They are as many as the row counts, but in three cases,
  // which getBackupServices() in data/db.js names: a VM refunded to 0 € or less, counted but
  // not listed, a line without an identifier, listed but not counted, and a VM that two
  // accounts billed, counted once but listed for each, while the lists name the account.
  const backupServicesQuery = (kind, month) => ({
    ...backupServicesOf(month),
    select: (services) => services[kind],
  });

  // The options of the query of the Logs Data Platform charges of month A or B, for useQuery
  // (#248): those that the Infrastructure tab lists for the month, as it asks for them, under the
  // same key, the services together, as the row of their resource type adds them up. Those of the
  // account shown, and every account's added up when all are shown, whatever the Account column
  // of the lists, as the charges name no account. The row runs it once unfolded, as the other
  // figures of the month run: on the tab, for a month of the months list. Those of the month in
  // progress, while the page projects it, at its projected cost, under a key of their own, which
  // the Infrastructure tab, whose charges are never projected, does not share.
  const logsDataPlatformChargesQuery = (month) => figureOf(
    ['logsDataPlatform'], month, fetchLogsDataPlatform,
  );

  return {
    compareMonthA,
    setCompareMonthA,
    compareMonthB,
    setCompareMonthB,
    comparedMonths,
    sortingOf,
    unfoldingOf,
    compareDataA,
    compareDataB,
    byServiceA,
    byServiceB,
    byProjectA,
    byProjectB,
    byResourceTypeA,
    byResourceTypeB,
    backupStatsA,
    backupStatsB,
    projectProductsQuery,
    resourceTypeServicesQuery,
    backupServicesQuery,
    logsDataPlatformChargesQuery,
  };
};

export { useCompareTab };
