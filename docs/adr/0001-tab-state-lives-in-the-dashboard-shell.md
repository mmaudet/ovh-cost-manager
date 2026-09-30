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

Shared state that a tab changes along with other parts of the page stays in the shell, and
reaches the tab with its setter: the Public Cloud project whose detail is open, and the
resource type whose bill lines are open on the Infrastructure tab. When a tab reads data
that another tab's hook owns, that hook returns it and the shell passes it on, so that the
query keeps a single owner and its loading condition: while the lists show the Account
column, with all accounts shown, the Public Cloud tab's list of projects gives what the
month billed each project from the projects by account that the Overview hook loads (#180).
The shell reads no tab hook's result for what it shows itself: the "vs previous month" KPI
runs its own query of the summary of the month before the selected one (#50). When a month
the Compare tab compares is one the shell loads, the Compare hook's queries of that month
share their keys with those the shell and the Backup hook run for it, but for the month in
progress while the page projects it (#218): the Compare hook then asks for its figures at
its projected cost, under keys of their own, which the shell and the Backup hook, whose
figures are never projected, do not share. When the page opens, month B is the latest
month, the selected one: its summary, costs by resource type and Veeam backups share their
keys (`summary`, `byResourceType`, `backupStats`), unless projected. Month A is the
second latest billed month (`months[1]`): when it is the month just before the latest one,
as it is unless nothing was billed that month, its summary shares its key with the shell's
month before. While the lists show the Account column, with all accounts shown, the Compare
hook asks for the projects of its months by account, under the key of the Overview hook's
projects by account (`projectsByAccount`, #119), but for the month in progress while the page
projects it (#219): the Overview's projects, which the Public Cloud tab's list reads too (#180),
are never projected. The services of a resource type that the
Compare tab lists under a row it unfolds, for a month and the account shown, share the key
of the bill lines that the Infrastructure hook loads for the same resource type, month and
account (`resourceTypeDetails`, #192), and while the lists show the Account column, with
all accounts shown, both ask for them by account, under one key again
(`resourceTypeDetailsByAccount`, #194): both hooks take their query from
`tabs/resourceTypeServicesQueries.js`, which picks the query and its key, and the Compare
hook gives its options, which the row runs once unfolded, as a project's comparison runs
those of its products (#181). The Compare hook owns the months it picks, and a shared key
only means a shared cache, not a shared owner. A query that follows the account selected in
the header carries that account in its key, after the other parts, and none when all
accounts are shown, as its request names the account or not (#115): two queries share a key
only for the same account, or both for all accounts. A query of the month in progress at
its projected cost names the flag in its key (`projected`), after the other parts and
before the account, as its request asks for it (#217, #218): it shares no key with a query
of what the month billed, such as the Infrastructure hook's services of a resource type.

What stays open depends on how the user moves around the page (#56):

- the tab bar keeps the open project and resource type;
- the logo goes back to the Overview and closes both;
- the header's badge of the services about to expire opens the Overview on their card, and
  keeps both, as the tab bar does (#225);
- the Overview's link to the Infrastructure tab opens its summary, with no resource type
  open;
- the Overview's other links open their target, a project on the Public Cloud tab or the
  Web Cloud tab, and keep the rest;
- the account selector keeps the open project open while the account shown lists it: with
  an account that does not, no project is open, until one that lists it is shown (#121);
- it keeps the months that the Compare tab compares while the account shown was billed in
  both and they are two months: with an account that lacks either, or after one billed in
  a single month, the tab compares the months it opens on for that account, its second
  latest billed month and its latest one (#119). The user may pick one month for both.

A tab module may also export pieces that the shell renders in place, outside the tab, so
that the page's markup stays as it is: the Trends period selector (`TrendsPeriodSelector`),
which sits in the tab bar, and "show all" modals. A tab whose panels open such modals
exports a component for them (`WebCloudTabModals`…), which the shell renders where the
modals were: after the page column, whatever the tab. Inside the tab, a modal would sit
in that column, whose spacing pushes its fixed backdrop down and leaves a strip of the
page neither darkened nor blocked. Once the split is done, a portal in `Modal` would let
the modals fold back into their tab.
