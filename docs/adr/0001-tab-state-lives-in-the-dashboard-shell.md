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
and reaches the tab with its setter: the Infrastructure tab opens the bill lines of a
resource type, which the logo and the Overview's link close (#56). When a tab reads
data that another tab's hook owns, that hook returns it and the shell passes it on, so
that the query keeps a single owner and its loading condition: the Compare tab lists the
dedicated servers that the Infrastructure hook loads, only on its own tab (#35). The shell
itself reads a tab hook's result the same way: the "vs previous month" KPI reads the
summary of month B from what the Compare hook returns (#50).

A tab module may also export pieces that the shell renders in place, outside the tab, so
that the page's markup stays as it is: the Trends period selector (`TrendsPeriodSelector`),
which sits in the tab bar, and "show all" modals. A tab whose panels open such modals
exports a component for them (`WebCloudTabModals`…), which the shell renders where the
modals were: after the page column, whatever the tab. Inside the tab, a modal would sit
in that column, whose spacing pushes its fixed backdrop down and leaves a strip of the
page neither darkened nor blocked. Once the split is done, a portal in `Modal` would let
the modals fold back into their tab.
