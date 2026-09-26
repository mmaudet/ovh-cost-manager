import { describe, it, expect } from 'vitest';
import { renderDashboard } from './support/render.jsx';

// The keys the page caches the answers of its queries under. Each period keeps its own
// answers, and the end of an import invalidates them by the name of their query (see
// shell.test.jsx): a key that changes, or a query that comes or goes, shows here. The hook
// tests pin the keys of each tab's queries (unit/use-*-tab.test.jsx), none those of the
// queries that stay in the shell.

// A key as text, where undefined and null, 3 and '3' read apart
const textOf = (key) => key
  .map((part) => (typeof part === 'string' ? `'${part}'` : String(part)))
  .join(', ');

// Keys in the order of their text: the order in which the shell and the tab hooks register
// their queries does not count, since users cannot see it
const sorted = (keys) => [...keys].sort((a, b) => {
  if (textOf(a) === textOf(b)) return 0;
  return textOf(a) < textOf(b) ? -1 : 1;
});

describe('query keys', () => {
  it('caches every query of the shell and of the tab hooks under its key', async () => {
    const { allKeys } = await renderDashboard();

    // Open on the Overview of September 2026. On the first render, before the months list
    // loaded, the queries of a month were built without one: disabled, they never ran. They
    // stay in the cache only because the tests' client keeps every query (gcTime: Infinity).
    expect(sorted(allKeys())).toEqual(sorted([
      // The shell's, which load at page start: the header, the KPI cards, the footer and
      // several tabs read them
      ['config'],
      ['user'],
      ['months'],
      ['summary', undefined, undefined],
      ['summary', '2026-09-01', '2026-09-30'],
      // And the summary of August, the month before, which the "vs previous month" KPI
      // compares September with (#50)
      ['summary', '2026-08-01', '2026-08-31'],
      ['byService', undefined, undefined],
      ['byService', '2026-09-01', '2026-09-30'],
      ['byProject', undefined, undefined],
      ['byProject', '2026-09-01', '2026-09-30'],
      ['byResourceType', undefined, undefined],
      ['byResourceType', '2026-09-01', '2026-09-30'],
      ['gpuSummary', undefined, undefined],
      ['gpuSummary', '2026-09-01', '2026-09-30'],
      ['importStatus'],
      ['consumptionCurrent'],
      ['consumptionForecast'],
      ['expiringServices'],
      // The Compare tab's: month A, August, whose summary shares the key of the shell's
      // month before (#50). Month B, September, shares the shell's keys.
      ['byService', '2026-08-01', '2026-08-31'],
      ['byProject', '2026-08-01', '2026-08-31'],
      // And the costs by resource type and the Veeam backups of month A (#32): month B
      // shares the key of the shell's costs, and that of the Backup tab's backups
      ['byResourceType', '2026-08-01', '2026-08-31'],
      ['backupStats', '2026-08-01', '2026-08-31'],
      // The Trends tab's: over 3 months, the only period offered before a month is selected,
      // then the longest that the three billed months up to September allow
      ['monthlyTrend', 3, undefined],
      ['monthlyTrend', 3, '2026-09'],
      ['monthlyTrendByCategory', 3, undefined],
      ['monthlyTrendByCategory', 3, '2026-09'],
      // And the GPU trend over those months, which only runs on the tab
      ['gpuTrend', undefined, undefined],
      ['gpuTrend', '2026-07-01', '2026-09-30'],
      // The Public Cloud tab's, while no project is selected
      ['projectsEnriched'],
      ['projectConsumption', undefined],
      ['projectQuotas', undefined],
      ['projectInstances', undefined, undefined, undefined],
      ['projectInstances', undefined, '2026-09-01', '2026-09-30'],
      ['projectInstanceTotal', undefined, undefined, undefined],
      ['projectInstanceTotal', undefined, '2026-09-01', '2026-09-30'],
      ['projectBuckets', undefined, undefined, undefined],
      ['projectBuckets', undefined, '2026-09-01', '2026-09-30'],
      ['projectVolumes', undefined, undefined, undefined],
      ['projectVolumes', undefined, '2026-09-01', '2026-09-30'],
      ['projectSnapshots', undefined, undefined, undefined],
      ['projectSnapshots', undefined, '2026-09-01', '2026-09-30'],
      ['projectSavingsPlans', undefined, undefined, undefined],
      ['projectSavingsPlans', undefined, '2026-09-01', '2026-09-30'],
      ['publicCloudStats', undefined, undefined],
      ['publicCloudStats', '2026-09-01', '2026-09-30'],
      // The Web Cloud tab's: the 12 months that end on the selected one
      ['webCloudSummary', undefined, undefined],
      ['webCloudSummary', '2025-10-01', '2026-09-30'],
      ['webCloudItems', undefined, undefined],
      ['webCloudItems', '2025-10-01', '2026-09-30'],
      // The Infrastructure tab's, while no resource type is open
      ['inventoryServers'],
      ['inventoryVps'],
      ['inventoryStorage'],
      ['resourceTypeDetails', null, undefined, undefined],
      ['resourceTypeDetails', null, '2026-09-01', '2026-09-30'],
      // The Backup tab's
      ['backupStats', undefined, undefined],
      ['backupStats', '2026-09-01', '2026-09-30'],
    ]));
  });
});
