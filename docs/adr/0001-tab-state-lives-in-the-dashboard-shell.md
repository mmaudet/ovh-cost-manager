# Tab state and queries live in hooks called by the dashboard shell

When `Dashboard.jsx` is split into one module per tab, each tab keeps its state and its
data queries in a hook (`useTrendsTab`, `useCompareTab`…) that the dashboard shell calls
on every render. The tab component only renders what its hook returns. Moving that state
into the tab components would be simpler, but a tab unmounts when another one is opened:
its selections (compared months, trend period, selected project…) would reset on every
tab switch, and the queries that load at page start would only start when their tab is
opened. Both would change what users see, so the state stays above the tabs.

A tab component also receives, as props, what the shell already holds for the whole
page: the language, `t`, `fmt`, the selected month, and the data that loads at page
start for the KPI cards and several tabs, such as the month's summary and its costs by
resource type. That data is passed on as it is, neither queried again nor routed through
the tab's hook, so that each query keeps a single owner and a hook returns only what its
tab owns.

Shared state that a tab changes along with other parts of the page stays in the shell,
and reaches the tab with its setter: the Public Cloud project whose detail is open, and
the resource type whose bill lines are open on the Infrastructure tab. When a tab reads
data that another tab's hook owns, that hook returns it and the shell passes it on, so
that the query keeps a single owner and its loading condition: the Compare tab lists the
dedicated servers that the Infrastructure hook loads, on its own tab and on Compare (#35).
The shell reads no tab hook's result for what it shows itself: the "vs previous month" KPI
runs its own query of the summary of the month before the selected one (#50). When a month
the Compare tab compares is one the shell loads, as both are when the page opens, the
Compare hook's queries of that month share their keys with those the shell and the Backup
hook run for it: month B, the selected month, its summary, costs by resource type and
Veeam backups (`summary`, `byResourceType`, `backupStats`), and month A, the month before,
its summary. The Compare hook owns the months it picks, and a shared key only means a
shared cache, not a shared owner.

What stays open depends on how the user moves around the page (#56):

- the tab bar keeps the open project and resource type;
- the logo goes back to the Overview and closes both;
- the Overview's link to the Infrastructure tab opens its summary, with no resource type
  open;
- the Overview's other links open their target, a project on the Public Cloud tab or the
  Web Cloud tab, and keep the rest.

A tab module may also export pieces that the shell renders in place, outside the tab, so
that the page's markup stays as it is: the Trends period selector (`TrendsPeriodSelector`),
which sits in the tab bar, and "show all" modals. A tab whose panels open such modals
exports a component for them (`WebCloudTabModals`…), which the shell renders where the
modals were: after the page column, whatever the tab. Inside the tab, a modal would sit
in that column, whose spacing pushes its fixed backdrop down and leaves a strip of the
page neither darkened nor blocked. Once the split is done, a portal in `Modal` would let
the modals fold back into their tab.
