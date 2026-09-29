// The Compare tab's state and data queries, in a hook that the dashboard shell calls on
// every render: see docs/adr/0001-tab-state-lives-in-the-dashboard-shell.md

import { useState, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTableSorts } from '../components/SortableHeader.jsx';
import { useUnfoldedRows } from '../components/UnfoldingRow.jsx';
import {
  fetchSummary, fetchByProject, fetchByService, fetchByResourceType, fetchBackupStats,
  fetchProjectProducts,
} from '../services/api.js';
import { accountQuery } from '../utils/accounts.js';
import { BY_MONTH_A } from '../utils/monthComparison.js';
import { holdsMonth } from '../utils/months.js';
import { projectsByAccountQuery } from './projectsByAccountQueries.js';
// Under the module's name: the hook gives its query, for the account shown, the same name
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
 *   it shows, the comparison by project names the account of each project
 * @returns {object} Months A and B and their setters, the sort order of the tab's tables
 *   (sortingOf(), see useTableSorts()), the rows unfolded into their services (unfoldingOf(),
 *   see useUnfoldedRows()), the figures of both months, which the tab shows, the query of a
 *   project's products in a month (projectProductsQuery(projectId, month)), which the
 *   comparison of the project's products runs once opened, and the query of a resource type's
 *   services in a month (resourceTypeServicesQuery(resourceType, month)), which its row runs
 *   once unfolded
 */
const useCompareTab = ({ months, activeTab, selectedAccount, accountColumn }) => {
  const [compareMonthA, setCompareMonthA] = useState(null);
  const [compareMonthB, setCompareMonthB] = useState(null);
  // The sort order of its tables, by table (#146): the comparison by project, by month A, the
  // most expensive first, until the user sorts it by another column, the infrastructure
  // comparison, and the comparison of each project's products, by project
  const sortingOf = useTableSorts({ projects: BY_MONTH_A });
  // The rows unfolded into their services, by comparison (#192)
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

  // A figure of month A or B, for the account shown (#119), which fetchFigure(from, to,
  // account) requests. Its key is that of the same figure of the shell or of the Backup tab,
  // for the same month and account (ADR 0001).
  const figureOf = (name, month, fetchFigure) => accountQuery(selectedAccount, {
    key: [name, month?.from, month?.to],
    fetch: (account) => fetchFigure(month.from, month.to, account),
    enabled: asksFor(month),
  });

  // Comparison data
  const { data: compareDataA } = useQuery(figureOf('summary', compareMonthA, fetchSummary));
  const { data: compareDataB } = useQuery(figureOf('summary', compareMonthB, fetchSummary));

  const { data: byServiceA = [] } = useQuery(
    figureOf('byService', compareMonthA, fetchByService),
  );
  const { data: byServiceB = [] } = useQuery(
    figureOf('byService', compareMonthB, fetchByService),
  );

  // The projects of month A or B: once each, for the account shown, or, while the comparison
  // names the account of each project, with all accounts shown, once for each account that
  // billed them, with that account (#119). Those are the Overview's projects by account,
  // under the same key (#118): its query and this one share a month's answer.
  const projectsOf = (month) => (accountColumn
    ? projectsByAccountQuery(month, asksFor(month))
    : figureOf('byProject', month, fetchByProject));

  const { data: byProjectA = [] } = useQuery(projectsOf(compareMonthA));
  const { data: byProjectB = [] } = useQuery(projectsOf(compareMonthB));

  // What the infrastructure, backup and Private Cloud comparisons show (#32): the costs of
  // each resource type, under the key of those the page loads for its selected month, and
  // the Veeam backups, under the key of those the Backup tab loads for it
  const { data: byResourceTypeA = [] } = useQuery(
    figureOf('byResourceType', compareMonthA, fetchByResourceType),
  );
  const { data: byResourceTypeB = [] } = useQuery(
    figureOf('byResourceType', compareMonthB, fetchByResourceType),
  );

  const { data: backupStatsA } = useQuery(
    figureOf('backupStats', compareMonthA, fetchBackupStats),
  );
  const { data: backupStatsB } = useQuery(
    figureOf('backupStats', compareMonthB, fetchBackupStats),
  );

  // The options of the query of a project's products in month A or B, for useQuery: what the
  // bills of the month charged the project, for the account shown, as its cost in the
  // comparison by project (#181). The comparison of the project's products runs it once
  // opened, as the other figures of the month run: on the tab, for a month of the months list.
  const projectProductsQuery = (projectId, month) => accountQuery(selectedAccount, {
    key: ['projectProducts', projectId, month?.from, month?.to],
    fetch: (account) => fetchProjectProducts(projectId, month.from, month.to, account),
    enabled: asksFor(month),
  });

  // The options of the query of a resource type's services in month A or B, for useQuery: those
  // that the Infrastructure tab lists for the resource type in the month, as it asks for them,
  // under the same key: the services of the account shown (#192), or, while the lists name the
  // account of each service, those of every account by account (#194). The row of the resource
  // type runs it once unfolded, as the other figures of the month run: on the tab, for a month
  // of the months list.
  const resourceTypeServicesQuery = (resourceType, month) => servicesQueries
    .resourceTypeServicesQuery(selectedAccount, accountColumn, resourceType, month, asksFor(month));

  return {
    compareMonthA,
    setCompareMonthA,
    compareMonthB,
    setCompareMonthB,
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
  };
};

export { useCompareTab };
