# Tab state and queries live in hooks called by the dashboard shell

When `Dashboard.jsx` is split into one module per tab, each tab keeps its state and its
data queries in a hook (`useTrendsTab`, `useCompareTab`…) that the dashboard shell calls
on every render. The tab component only renders what its hook returns. Moving that state
into the tab components would be simpler, but a tab unmounts when another one is opened:
its selections (compared months, trend period, selected project…) would reset on every
tab switch, and the queries that load at page start would only start when their tab is
opened. Both would change what users see, so the state stays above the tabs.

A tab whose panels open "show all" modals also exports a component for them
(`WebCloudTabModals`…), which the shell renders where the modals were: after the page
column, whatever the tab. Inside the tab, a modal would sit in that column, whose
spacing pushes its fixed backdrop down and leaves a strip of the page neither darkened
nor blocked. Once the split is done, a portal in `Modal` would let the modals fold back
into their tab.
