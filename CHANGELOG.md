# Changelog

All notable changes to OVH Cost Manager, newest first. The section of each
version is also the body of its [GitHub release](https://github.com/mmaudet/ovh-cost-manager/releases).

Changes are grouped into **New features**, **Security**, **Bug fixes** and
**Maintenance** (dependency upgrades, CI, build, documentation and tooling).
From 2.3.0 on, each section is generated from the labels of the merged pull
requests when the release is prepared, then reviewed (see
[CONTRIBUTING.md](CONTRIBUTING.md#pull-requests-and-the-changelog)). Earlier
sections were written afterwards from the git history.

<!-- scripts/release.sh inserts each new version above the first version heading. -->

## 3.4.0 - 2026-10-01

The month in progress, projected. OVHcloud bills some accounts late in the month, so the month of today may still lack services that every month bills. 3.3.3 marked that month as in progress; 3.4.0 can also count its projected cost:

- **« Projeter le mois en cours »** (#212, #214). A checkbox in the Trends and Compare tabs counts each recurring service that the month in progress has not billed yet at its cost of the month before.
  - It changes the Trends tab's line charts and cards.
  - In the Compare tab, it changes the totals, the service type chart, the infrastructure, Private Cloud, backup and project comparisons, and their services, products and charges.
  - They then show the month at its projected cost, in italics and marked « projeté ».
  - It is off by default, one setting for the whole page, which the browser remembers. The header's cards and the other tabs never project.
- **The services about to expire** (#225).
  - The header's « Expirations proches » badge now leads to their card in the Overview.
  - The card's title counts them all.
  - Its « Tout afficher » lists every one of them in a table that sorts and exports as CSV.
- **The budget card on a phone** (#235) sets the budget apart from the consumed amount, which ran together.

### Upgrade notes

- **No migration and no re-import.** The projection reads the bills already imported, when the server reads them.
- **API.** The routes of the Trends and Compare tabs take `projected=true`, which gives each row its projected part. Without it, they answer as before: see the README's API section.
- **Issues.** New issues go through a bug report or a feature request form, and are triaged together about once a week: see CONTRIBUTING.md.

### New features
* feat: project the month in progress in the Trends tab by @mmaudet in https://github.com/mmaudet/ovh-cost-manager/pull/233
* feat: lead from the header's badge to the services about to expire by @mmaudet in https://github.com/mmaudet/ovh-cost-manager/pull/234
* feat: project the month in progress in the Compare tab's totals, infrastructure and backup by @mmaudet in https://github.com/mmaudet/ovh-cost-manager/pull/238
* feat: project the month in progress in the Compare tab's projects and their products by @mmaudet in https://github.com/mmaudet/ovh-cost-manager/pull/240
### Bug fixes
* fix: set the budget apart from the consumed amount on a phone by @mmaudet in https://github.com/mmaudet/ovh-cost-manager/pull/239
### Maintenance
* docs: add issue forms and describe how issues are handled by @mmaudet in https://github.com/mmaudet/ovh-cost-manager/pull/237
* docs: document the month in progress and its projection by @mmaudet in https://github.com/mmaudet/ovh-cost-manager/pull/241

**Full Changelog**: https://github.com/mmaudet/ovh-cost-manager/compare/v3.3.3...v3.4.0

## 3.3.3 - 2026-09-30

Three fixes that a user of 3.3.2 reported, and the month in progress told apart:

- **The backups are counted once** (#223). OVH bills each VM that it backs up with Veeam
  Enterprise on one line, which OCM counted both as the VM and as a licence, doubling the
  backups' cost.
- **The consumption cards read the Public Cloud projects** (#224). « Consommation en cours »
  and « Prévision fin de mois » now read the projects, as OVH's Public Cloud page does, where
  they read the account-wide consumption, which OVH may leave frozen. The forecast adds up
  each project's own forecast from OVH, and never falls below what the month already
  consumed.
- **The dashboard fits phones and tablets** (#226). The tab bar wraps and scrolls, the cards
  stack, the tables scroll within their card, the pies leave out the labels they cannot
  place, and print keeps its layout.
- **The month in progress is told apart** (#212, #216). The month of today is in progress
  while a service billed in each of the three months before has not been billed yet.
  Meanwhile, the « Coût total du mois » card says « en cours », and the variations that
  involve that month read « — », rather than compare a partial month with a complete one.
  The Compare tab's month selectors mark it « (en cours) ». A projection of its cost comes
  with 3.4.0.

### Upgrade notes

- **The forecast comes with the cloud details.** Each project's forecast is imported with
  `--include-cloud-details`, which `--all` and the Docker image's default import include.
  Until such an import runs, the forecast card extrapolates the projects' consumption.
- **A new table,** `project_forecasts`, which the server creates on its own: no migration to
  run, no re-import.

### New features
* feat: tell the month in progress apart by @mmaudet in https://github.com/mmaudet/ovh-cost-manager/pull/228
### Bug fixes
* fix: count a VM's Veeam Enterprise backup once by @mmaudet in https://github.com/mmaudet/ovh-cost-manager/pull/229
* fix: read the Public Cloud projects' consumption and forecast in the header cards by @mmaudet in https://github.com/mmaudet/ovh-cost-manager/pull/230
* fix: fit the dashboard to phone and tablet screens by @mmaudet in https://github.com/mmaudet/ovh-cost-manager/pull/231

**Full Changelog**: https://github.com/mmaudet/ovh-cost-manager/compare/v3.3.2...v3.3.3

## 3.3.2 - 2026-09-30

The dashboard's header holds on one line again, from 1280 px wide screens up: the
title, its subtitle, the user's name and every control, the language selector now
last and level with the others. A user reported it wrapped and misaligned once the
account selector and the resync had joined it.

- **A wider page.** The page is 1280 px wide at most, where it was 1152 px, so the
  other tabs get wider too.
- **The export select** reads « Exporter… » ("Export…"), in place of its « Export: »
  label and « Choisir... ».
- **On narrower screens,** the last controls go whole to a line of their own.

### Bug fixes
* fix: align the dashboard's header on one line from 1280 px wide screens by @mmaudet in https://github.com/mmaudet/ovh-cost-manager/pull/213
### Maintenance
* docs: add Month in progress, Recurring service and Projected cost to the glossary by @mmaudet in https://github.com/mmaudet/ovh-cost-manager/pull/221

**Full Changelog**: https://github.com/mmaudet/ovh-cost-manager/compare/v3.3.1...v3.3.2

## 3.3.1 - 2026-09-29

The dashboard's footer now shows the version of OCM that runs, « OVH Cost
Manager v3.3.1 », linked to its release notes, so that whoever uses it knows
which version is deployed (#188).

- **Where it comes from.** The server gives the version on `/api/config`,
  behind authentication as the rest of the API. `/api/health`, which answers
  without authentication, does not give it.
- **Outside the dashboard.** The Docker images also carry their version, as
  the OCI label `org.opencontainers.image.version`.

### New features
* feat: show the version of OCM in the dashboard's footer by @mmaudet in https://github.com/mmaudet/ovh-cost-manager/pull/210

**Full Changelog**: https://github.com/mmaudet/ovh-cost-manager/compare/v3.3.0...v3.3.1

## 3.3.0 - 2026-09-29

Two features, which a user of 3.2.0 asked for:

- **The Compare tab's rows unfold into what they add up** (#182, #189).
  - The rows of the infrastructure, Private Cloud and backup comparisons unfold into their services: each dedicated server, VPS, domain, IP block, Private Cloud host or datastore, each Veeam VM and licence.
  - A Public Cloud project's products unfold into their charges: an instance's monthly plan, a flavor's hourly use in a region, a bucket's storage, an AI Endpoints model's tokens.
  - Each gives the amount of month A, the amount of month B and the variation, and names its account while all accounts are shown.
  - The list of the dedicated servers that the inventory holds today leaves the Compare tab, where it compared nothing.

  See [Month Comparison](https://github.com/mmaudet/ovh-cost-manager/blob/v3.3.0/README.md#month-comparison) in the README.
- **AI Endpoints by model** (#183, #190).
  - The Public Cloud tab lists the AI Endpoints models that the month's bills name, with their input tokens, their output tokens and their cost.
  - The Trends tab charts each model's monthly cost.

  See [AI Endpoints Models](https://github.com/mmaudet/ovh-cost-manager/blob/v3.3.0/README.md#ai-endpoints-models) in the README.

### Upgrade notes

- **No re-import.** Both features read the bills already imported, when the server reads them.
- **New route:** `/api/analysis/backup-services`.
- **New route:** `/api/analysis/ai-endpoints`.
- **Changed answer:** `/api/projects/:id/products` gives each product's `charges`.

### New features
* feat: list the month's AI Endpoints models in the Public Cloud tab by @mmaudet in https://github.com/mmaudet/ovh-cost-manager/pull/201
* feat: unfold the infrastructure comparison's rows into their services by @mmaudet in https://github.com/mmaudet/ovh-cost-manager/pull/202
* feat: chart the monthly cost of each AI Endpoints model in the Trends tab by @mmaudet in https://github.com/mmaudet/ovh-cost-manager/pull/203
* feat: name each service's account in the Compare tab, and drop its inventory list by @mmaudet in https://github.com/mmaudet/ovh-cost-manager/pull/205
* feat: unfold a project's products into their charges in the Compare tab by @mmaudet in https://github.com/mmaudet/ovh-cost-manager/pull/206
* feat: unfold the backup comparison's rows into their VMs and licences by @mmaudet in https://github.com/mmaudet/ovh-cost-manager/pull/207
### Maintenance
* docs: add Service, Charge and AI Endpoints model to the glossary by @mmaudet in https://github.com/mmaudet/ovh-cost-manager/pull/200
* docs: document the AI Endpoints models by @mmaudet in https://github.com/mmaudet/ovh-cost-manager/pull/204
* docs: document the unfolding rows of the Compare tab by @mmaudet in https://github.com/mmaudet/ovh-cost-manager/pull/208

**Full Changelog**: https://github.com/mmaudet/ovh-cost-manager/compare/v3.2.1...v3.3.0

## 3.2.1 - 2026-09-29

Three fixes, which users of 3.2.0 reported:

- **The carbon footprint imports again** (#179). OVHcloud's carbon calculator
  accepts the request of the file with 202 Accepted, which the OVH API client
  that OCM uses took for an error, whatever the key's rights: the import now
  makes those calls itself.
- **The Public Cloud tab's list of projects adds up to the month's
  « Total Cloud »** (#180). A column gives what the month selected billed each
  project, next to its current consumption, which is not billed yet; a
  « Total Cloud » row closes the list, and a project that the month billed but
  the list lacks gets a row of its own, marked †.
- **The Compare tab compares a Public Cloud project's products from the bills**
  (#181), for every billed month, where it read the consumption that each import
  records, which only covers the month in which the import ran: the detail of a
  project was empty for most months.

### Upgrade notes

- **Nothing to configure.** To import the carbon footprint, each account's key
  needs `GET /me`, as every import does since 3.0.0, and the rule
  `POST /me/carbonCalculator/csv` (see the README's "Carbon Footprint"). The
  next import that includes it (`--all`, the Docker default) fetches it.
- **API.** `GET /api/projects/:id/products?from=&to=` is new: the products of a
  project over a period, from its bills, with the credit that they used apart.
  Unlike the other routes of one project, it takes the `account` parameter, as a
  project's bill lines belong to the account of their bill.

### Bug fixes
* fix: import the carbon footprint when the calculator answers 202 by @mmaudet in https://github.com/mmaudet/ovh-cost-manager/pull/184
* fix: compare a Public Cloud project's products from the bills by @mmaudet in https://github.com/mmaudet/ovh-cost-manager/pull/185
* fix: give each Public Cloud project what it was billed in the month by @mmaudet in https://github.com/mmaudet/ovh-cost-manager/pull/186

**Full Changelog**: https://github.com/mmaudet/ovh-cost-manager/compare/v3.2.0...v3.2.1

## 3.2.0 - 2026-09-29

The dashboard's lists now sort by any of their columns, with a click on a
header (#146): text from A to Z, figures, sizes and dates from the largest or
the latest, and a second click reverses it. Each list keeps its usual order
until then, and its CSV export keeps it whatever the order shown.

The Public Cloud tab's figures now add up (#145). A project's current
consumption counts all that it uses, where it counted little more than its
instances. The cards and the Cloud credit add up to the month's cloud total,
with a new « Autres services » card for the products without a card of their
own, such as databases, load balancers or volume backups. A project's detail
lists its other services, its registry among them. An empty bucket reads
« Vide » rather than « Inconnu », as OVHcloud gives a class to each object,
never to a bucket.

### Upgrade notes

- **Nothing to configure.** The figures read from the bills, the cards and the
  other services, are right at once.
- **The projects' current consumption fills in at the next import that reads
  the cloud details**: `--all`, the Docker containers' default `IMPORT_FLAGS`,
  which the dashboard's resync button uses too, or `--include-cloud-details`.
  Until then, it keeps the partial figures of the last import. So do the
  header's current consumption and forecast when they come from the projects,
  as when OVH tells no consumption.
- **That forecast counts the monthly charges once**, such as the monthly plans
  and the savings plans, rather than extrapolating them over the month: with
  monthly plans, it may drop.
- **API.**
  - `GET /api/analysis/public-cloud-stats` gains `other`, the products without
    a card of their own with their cost, and `credits`, the credit that the
    bills used. Its cards count the lines of the Public Cloud projects only,
    each line in one card; `aiml` and `loadBalancers` count the lines of their
    products.
  - `GET /api/projects/:id/other-services` is new: the products of a project
    over a period that its detail lists no section of its own for.
  - The rows of `GET /api/projects/:id/consumption` gain kinds, such as
    `storage`, `snapshot`, `savings_plan` or the types of the newer products,
    as OVH names them.

### New features
* feat: sort the dashboard's tables by any of their columns by @mmaudet in https://github.com/mmaudet/ovh-cost-manager/pull/176
### Bug fixes
* fix: count every part of a Public Cloud project's current usage by @mmaudet in https://github.com/mmaudet/ovh-cost-manager/pull/172
* fix: add the Public Cloud cards up to the month's cloud total by @mmaudet in https://github.com/mmaudet/ovh-cost-manager/pull/173
* fix: say that an empty bucket has no class, and name the archive classes by @mmaudet in https://github.com/mmaudet/ovh-cost-manager/pull/174
* fix: name the typed resources of a project's consumption by @mmaudet in https://github.com/mmaudet/ovh-cost-manager/pull/177
### Maintenance
* docs: show the carbon footprint tab in the README by @mmaudet in https://github.com/mmaudet/ovh-cost-manager/pull/175

**Full Changelog**: https://github.com/mmaudet/ovh-cost-manager/compare/v3.1.0...v3.2.0

## 3.1.0 - 2026-09-28

OVH Cost Manager now imports the carbon footprint that OVHcloud's carbon
calculator attributes to each account's services, and shows it next to what
those services cost, in a new Carbon footprint tab (« Bilan carbone » in
French). The tab shows each month's footprint by emission source, its trend
over 12 months, and each dedicated server, instance flavor and volume type
with its cost and carbon intensity. It also shows the share of the month's
cost that the footprint covers, as OVHcloud does not compute the footprint of
all its services. The figures are OVHcloud's estimates, in kgCO2e: OCM
computes none of its own. See
[Carbon Footprint](https://github.com/mmaudet/ovh-cost-manager/blob/v3.1.0/README.md#carbon-footprint)
in the README.

### Upgrade notes

- **Nothing changes until you enable it.** The first start adds the
  footprint's table to the database. The other tabs, routes and exports are
  unchanged.
- **Enabling it takes a new consumer key for each account.** A key keeps the
  rules it was created with: request one with the command of
  [Generate Consumer Key](https://github.com/mmaudet/ovh-cost-manager/blob/v3.1.0/README.md#2-generate-consumer-key),
  which now lists `POST /me/carbonCalculator/csv`, and replace the account's
  `consumerKey` in `config.json`. With Docker, do it before you start 3.1.0,
  or restart the container afterwards: the compose files mount `config.json`
  as a single file.
- **The imports then fetch it.** `--include-carbon` imports it, and `--all`
  includes it: `--all` is the Docker containers' default `IMPORT_FLAGS`, which
  the dashboard's resync button uses too. Each import asks OVHcloud for the
  last 24 months again, and keeps the older months, even with `--full`.
- **Without the rule,** the import writes one line that names it and imports
  the rest, and the run's status does not change. The tab then says how to
  enable the footprint.
- **API.** `GET /api/carbon/footprint`, `/api/carbon/trend`,
  `/api/carbon/by-server` and `/api/export/carbon` are new. They take the
  `account` parameter, as the other data routes do.

### New features
* feat: import the carbon footprint and show a month's footprint by @mmaudet in https://github.com/mmaudet/ovh-cost-manager/pull/160
* feat: say why the carbon footprint could not be imported by @mmaudet in https://github.com/mmaudet/ovh-cost-manager/pull/161
* feat: show the latest carbon footprint and the market-based total by @mmaudet in https://github.com/mmaudet/ovh-cost-manager/pull/162
* feat: say why an account has no carbon footprint by @mmaudet in https://github.com/mmaudet/ovh-cost-manager/pull/163
* feat: show the carbon footprint's 12-month trend by @mmaudet in https://github.com/mmaudet/ovh-cost-manager/pull/164
* feat: list the carbon footprint's lines with their cost by @mmaudet in https://github.com/mmaudet/ovh-cost-manager/pull/165
* feat: export the carbon footprint's list to CSV by @mmaudet in https://github.com/mmaudet/ovh-cost-manager/pull/166
* feat: show the carbon footprint's covered cost by @mmaudet in https://github.com/mmaudet/ovh-cost-manager/pull/167
* feat: name the carbon tab "Bilan carbone" in French by @mmaudet in https://github.com/mmaudet/ovh-cost-manager/pull/169
* feat: name the carbon tab "Carbon footprint" in English by @mmaudet in https://github.com/mmaudet/ovh-cost-manager/pull/170
### Maintenance
* docs: add the carbon footprint vocabulary and ADR 0003 by @mmaudet in https://github.com/mmaudet/ovh-cost-manager/pull/148
* refactor: read Public Cloud instance lines in one place by @mmaudet in https://github.com/mmaudet/ovh-cost-manager/pull/159
* docs: document the carbon footprint by @mmaudet in https://github.com/mmaudet/ovh-cost-manager/pull/168

**Full Changelog**: https://github.com/mmaudet/ovh-cost-manager/compare/v3.0.0...v3.1.0

## 3.0.0 - 2026-09-27

OVH Cost Manager now imports several OVH accounts into one instance (#106).
The dashboard's header gains an account selector. Every tab, card, list,
export and report then shows one account, or all of them with an Account
column in the lists. Each account can have its own budget, and the footer
tells when each account was last synchronised. A single-account installation
keeps its configuration, and its dashboard looks the same. The version is
major because the first start migrates the database for good, and the
configuration and the API gain the account.

### Upgrade notes

Read [Upgrading to several accounts](https://github.com/mmaudet/ovh-cost-manager/blob/v3.0.0/docs/deployment.md#upgrading-to-several-accounts)
in the deployment guide before upgrading. In short:

- **Back up the database first.** The first start of 3.0.0 adds an account
  column to the tables. Going back to 2.4.x with a database that 3.0.0 has
  migrated is not supported.
- **Every key needs `GET /me`.** Each import reads the account it imports
  from `GET /me`, which `/me/*` does not cover. A key without that right fails
  every import, with a message that names it: request a new consumer key with
  the README's command.
- **The first import after the upgrade gives the existing data its account.**
  There is nothing to run by hand. The container runs it at its next periodic
  import (`IMPORT_INTERVAL`); the dashboard's resync button runs it at once.
  Until then, the dashboard looks as before.
- **Upgrade with the one account you had, then add the others.** With a
  single account in `config.json`, that account gets all the existing data.
  Data that no configured account claims shows as the Unknown account
  ("Compte inconnu") in the selector, and stays until an account claims it:
  no import deletes it.
- **To add accounts**, replace the `credentials` section of `config.json`
  with an `accounts` list, as `config.accounts.example.json` does.
  - Each entry takes an optional `name` and `budget`.
  - Each entry's `credentials` now need an `endpoint`, such as `ovh-eu`.
    Without one, the server stops at start and names the setting.
  - All accounts must bill in one currency.
- **API.** Every route that lists or adds up data takes an optional `account`
  parameter: a NIC handle, or `unknown` for the Unknown account.
  - Without it, a route answers for all accounts, so a single-account
    installation gets the same answers, except for an `account` field that
    some rows gain.
  - With several accounts, the CSV exports gain a last `account` column.
  - `GET /api/accounts` is new: it lists the accounts with their last import
    and budget.

### New features
* feat: record the account of every imported row by @mmaudet in https://github.com/mmaudet/ovh-cost-manager/pull/126
* feat: configure and import several OVH accounts in one run by @mmaudet in https://github.com/mmaudet/ovh-cost-manager/pull/127
* feat: select the account in the dashboard header by @mmaudet in https://github.com/mmaudet/ovh-cost-manager/pull/128
* feat: Trends follows the account by @mmaudet in https://github.com/mmaudet/ovh-cost-manager/pull/129
* feat: Public Cloud follows the account by @mmaudet in https://github.com/mmaudet/ovh-cost-manager/pull/130
* feat: Web Cloud follows the account by @mmaudet in https://github.com/mmaudet/ovh-cost-manager/pull/131
* feat: Overview follows the account by @mmaudet in https://github.com/mmaudet/ovh-cost-manager/pull/132
* feat: keep each account's inventory, history and snapshots apart by @mmaudet in https://github.com/mmaudet/ovh-cost-manager/pull/133
* feat: name the account in the report and the footer by @mmaudet in https://github.com/mmaudet/ovh-cost-manager/pull/134
* feat: Compare follows the account by @mmaudet in https://github.com/mmaudet/ovh-cost-manager/pull/135
* feat: consumption, forecast and balance follow the account by @mmaudet in https://github.com/mmaudet/ovh-cost-manager/pull/136
* feat: Infrastructure and Backup follow the account by @mmaudet in https://github.com/mmaudet/ovh-cost-manager/pull/138
* feat: budget per account by @mmaudet in https://github.com/mmaudet/ovh-cost-manager/pull/139
* feat: the API's CSV exports follow the account by @mmaudet in https://github.com/mmaudet/ovh-cost-manager/pull/141
* feat: the bills and daily trend routes follow the account by @mmaudet in https://github.com/mmaudet/ovh-cost-manager/pull/142
### Maintenance
* docs: record the multi-account decisions in the glossary and ADR 0002 by @mmaudet in https://github.com/mmaudet/ovh-cost-manager/pull/111
* docs: document several accounts by @mmaudet in https://github.com/mmaudet/ovh-cost-manager/pull/143

**Full Changelog**: https://github.com/mmaudet/ovh-cost-manager/compare/v2.4.3...v3.0.0

## 2.4.3 - 2026-09-27

`TRUST_PROXY` can now count the proxies in front of OCM, so that rate limiting
tells users apart behind a TLS terminator and the SSO relay. The compose files
pass the settings that the deployment guide documents, and a refused CORS
origin gets a 403 instead of a 500.

### Upgrade notes

- **Check your `.env`.** The compose files used to ignore some of the settings
  the guide documents. They now pass them, so a value that `.env`, or the
  shell, sets for them takes effect:
  - `docker-compose.yml`: `TRUST_PROXY`, the `RATE_LIMIT_*` settings,
    `ALLOWED_ORIGINS`, `OIDC_ENABLED`, `OIDC_ISSUER`, `OIDC_CLIENT_ID`,
    `OIDC_CLIENT_SECRET`, `OIDC_BASE_URL`, `SESSION_SECRET` and
    `COOKIE_SECURE`;
  - `docker-compose.sso.yml`: `TRUST_PROXY` (still `true` when unset),
    `OIDC_BASE_URL`, the `RATE_LIMIT_*` settings and the `IMPORT_*` ones.

  Left unset, they change nothing: `config.json` and the defaults still apply.
  With the simple stack, whose port is published directly, leave `TRUST_PROXY`
  unset.
- **`TRUST_PROXY` counts proxies.** `TRUST_PROXY`, or `rateLimit.trustProxy`
  in `config.json`, takes `true`, `false` or a number of proxies from 1 to 10;
  `true` still means one. Behind a TLS terminator in front of the SSO relay,
  set `TRUST_PROXY=2`, provided the terminator adds to `X-Forwarded-For` and
  the relay can be reached through it alone (see
  [HTTPS](https://github.com/mmaudet/ovh-cost-manager/blob/v2.4.3/docs/deployment.md#https)).
- **Refused CORS origins get a 403.** A request from an origin that is neither
  the dashboard's own nor listed now gets a 403 with a short JSON error, where
  it got a 500, and logs one line without a stack trace. Monitoring that
  counted these as server errors will see them as refusals.

### New features
* feat: let TRUST_PROXY name how many proxies OCM trusts by @mmaudet in https://github.com/mmaudet/ovh-cost-manager/pull/108
### Bug fixes
* fix: answer 403 to a refused CORS origin, without a stack trace by @mmaudet in https://github.com/mmaudet/ovh-cost-manager/pull/107

**Full Changelog**: https://github.com/mmaudet/ovh-cost-manager/compare/v2.4.2...v2.4.3

## 2.4.2 - 2026-09-27

This release brings the new logo of OVH Cost Manager: its pictogram in the
dashboard's header and as its favicon, and the whole logo in the README, with
a variant for GitHub's dark theme. The README's screenshots are new too, taken
on anonymised data, with the Public Cloud and Web Cloud tabs. Nothing changes
in the configuration or the data: pull the new image and recreate the
container.

### New features
* feat: use the new logo in the dashboard, its favicon and the README, with new screenshots by @mmaudet in https://github.com/mmaudet/ovh-cost-manager/pull/104

**Full Changelog**: https://github.com/mmaudet/ovh-cost-manager/compare/v2.4.1...v2.4.2

## 2.4.1 - 2026-09-26

This release fixes the issues open after 2.4.0. It hardens the OIDC
authentication and the reading of the settings, stops the Docker image from
wiping its database at each start under authentication, keeps the consumption
history, completes the Compare tab and the French formats, and brings the SSO
documentation in line with the LemonLDAP-NG relay and OIDC setup. Read the
upgrade notes before upgrading a deployment that uses OIDC, `AUTH_REQUIRED` or
custom settings: the
[deployment guide](https://github.com/mmaudet/ovh-cost-manager/blob/v2.4.1/docs/deployment.md#upgrading-to-241)
details them.

### Upgrade notes

- **Database wiped at startup under authentication (Docker).** Up to 2.4.0,
  with OIDC or `AUTH_REQUIRED=true`, the container ran a full import, which
  clears the database, at every start. The consumption and balance history,
  which OVH cannot return again, was lost each time. It now counts the bills in
  the database and imports in full only when there is none. History lost before
  this version comes back only from a backup of the `ocm-data` volume.
- **Everyone signs in again once (OIDC).** The session cookie is now signed with
  `SESSION_SECRET`, and named `__Host-ocm.sid` over HTTPS. Set `SESSION_SECRET`
  to 32 random characters or more (`openssl rand -hex 32`): changing it signs
  everyone out. A sign-in must start on the host of `OIDC_BASE_URL` and end
  within 10 minutes. Back-channel logout now works; the provider's logout
  tokens must hold `exp`.
- **OIDC fails closed.** With OIDC enabled, the server no longer falls back to
  the `Auth-User` header: a missing setting stops it at startup, and while the
  provider cannot be discovered, sign-in and the API answer 503 (`/api/health`
  still answers). `OIDC_ENABLED=false` now overrides `auth.enabled: true` in
  `config.json`.
- **Strict settings.** The true/false settings (`OIDC_ENABLED`,
  `AUTH_REQUIRED`, `TRUST_PROXY`, `RATE_LIMIT_ENABLED`, `IMPORT_ENABLED`…) take
  `true` or `false`, in any case, and JSON booleans in `config.json`; the rate
  limits take positive integers; `allowedOrigins` takes an array or a
  comma-separated string. Any other value, or a `config.json` that is not valid
  JSON, now stops the server with an error naming the setting, where it used to
  be misread. `TRUST_PROXY=TRUE` and `IMPORT_ENABLED=FALSE` now mean what they
  say.
- **Header mode needs its proxy.** Without OIDC, OCM takes the user from
  `Auth-User` on any request. `AUTH_REQUIRED=true` protects the API only behind
  a proxy that sets that header and removes the client's. On the simple compose
  stack, which has no such proxy, it only keeps out clients that send none.
- **Log lines.** The request log writes the user as a JSON string, `["alice"]`
  where it was `[alice]`, and the CORS and OIDC lines quote the texts they did
  not write. A tool that parses these lines may need its pattern updated.
- **`ALLOWED_HOSTS`** (new, opt-in) lists the host names the server answers to,
  against DNS rebinding. Unset, nothing changes.
- **SSO stack.** `docker-compose.sso.yml` is used on its own, not stacked on
  `docker-compose.yml`, which published the dashboard's port outside the
  LemonLDAP-NG relay. Behind a TLS terminator, the dashboard no longer goes
  blank, though the relay passes port 80. Rate limiting then sees every user at
  the terminator's address (#101): raise `RATE_LIMIT_API_MAX` meanwhile.
- **Consumption history** now builds up month by month: an import replaces only
  the month it imports, and `--full` keeps the history. Months before the
  upgrade are not backfilled.
- **Inventory.** The VPS operating system is read from
  `/vps/{name}/images/current`, as OVH removes `/vps/{name}/distribution` on
  2026-10-15; it used to hold the disk size. Dedicated servers, VPS and NetApp
  storage that OVH no longer lists are removed. Both take effect at the next
  inventory import (`--include-inventory` or `--all`, the Docker default).
- **Dashboard.**
  - The "vs previous month" KPI compares the selected month with the calendar
    month before it, where it read month B of the Compare tab.
  - The Compare tab fills its Infrastructure, Backup and Private Cloud
    accordions and lists the projects of both months.
  - A variation from a month at 0 € or below shows "—" everywhere.
  - Percentages, sizes and month names follow the interface language:
    `+20,0 %`, `Go`, "septembre 2026" in French.
  - With no billed month, the dashboard says so instead of loading forever.

### Security
* security: let deployments restrict the host names the server answers to by @mmaudet in https://github.com/mmaudet/ovh-cost-manager/pull/92
* security: harden OIDC sign-in, sessions and back-channel logout, and read the settings strictly by @mmaudet in https://github.com/mmaudet/ovh-cost-manager/pull/98
### Bug fixes
* fix: complete the Compare tab: accordions, dedicated servers and projects of both months by @mmaudet in https://github.com/mmaudet/ovh-cost-manager/pull/89
* fix: loading and error states, and localised sizes and shares, in the Web Cloud, Backup and Public Cloud tabs by @mmaudet in https://github.com/mmaudet/ovh-cost-manager/pull/90
* fix: keep each month's project consumption, store the VPS OS, and log import failures by @mmaudet in https://github.com/mmaudet/ovh-cost-manager/pull/91
* fix: stop the Docker cron from re-importing everything under authentication by @mmaudet in https://github.com/mmaudet/ovh-cost-manager/pull/93
* fix: translate the month labels, the logout tooltip and the Markdown report by @mmaudet in https://github.com/mmaudet/ovh-cost-manager/pull/94
* fix: list expiring services by date, remove cancelled ones, and merge the 'other' costs by @mmaudet in https://github.com/mmaudet/ovh-cost-manager/pull/95
* fix: compare the total cost KPI with the previous month, and say when there is no data by @mmaudet in https://github.com/mmaudet/ovh-cost-manager/pull/96
* fix: write percentages and sizes the French way, and harden the dashboard tests by @mmaudet in https://github.com/mmaudet/ovh-cost-manager/pull/97
* fix: accept the dashboard's https origin when the SSO relay passes port 80 by @mmaudet in https://github.com/mmaudet/ovh-cost-manager/pull/100
### Maintenance
* docs: describe the LemonLDAP-NG relay and OIDC setup of the SSO stack by @mmaudet in https://github.com/mmaudet/ovh-cost-manager/pull/99

**Full Changelog**: https://github.com/mmaudet/ovh-cost-manager/compare/v2.4.0...v2.4.1

## 2.4.0 - 2026-09-26

The dashboard page is now split into one module per tab, pinned down by 375
dashboard tests. The split itself changes nothing users see. This release also
fixes a blank page in production and changes how the Trends tab counts its
periods.

### Upgrade notes

- **Blank page in production.** With `NODE_ENV=production`, as in the compose
  files, the dashboard stayed blank unless `ALLOWED_ORIGINS` listed its own URL.
  It now always accepts its own origin, so `ALLOWED_ORIGINS` is only needed for
  other sites. `TRUST_PROXY=true` also makes it trust `X-Forwarded-Host` and
  `X-Forwarded-Proto` for this check (see
  [docs/deployment.md](https://github.com/mmaudet/ovh-cost-manager/blob/v2.4.0/docs/deployment.md)).
  In development, only `localhost`, `127.0.0.1` and `[::1]` are accepted, where
  any origin containing `localhost` used to be.
- **Trends periods.** A period of N months now covers N calendar months, the
  current one included, and ends on the month selected in the header. Before, it
  covered N+1 months and always ended today. Months without any bill show at
  0 €. The growth over the period shows "—" when the first month costs 0 € or
  less.
- **Trends API.** `GET /api/analysis/monthly-trend` and
  `/api/analysis/monthly-trend-by-category` accept `end=YYYY-MM`, the last month
  of the window, which defaults to the latest billed month. `months` must be an
  integer from 1 to 240: other values now get a 400.
- **Navigation.** The tab bar keeps the open Public Cloud project and the open
  resource type detail; the logo closes both.

### Bug fixes
* fix: stop the CORS check from blanking the dashboard in production by @mmaudet in https://github.com/mmaudet/ovh-cost-manager/pull/79
* fix: make the logo and the tab bar reset navigation consistently by @mmaudet in https://github.com/mmaudet/ovh-cost-manager/pull/82
* fix: make a trend period of N months cover N months, ending on the selected month by @mmaudet in https://github.com/mmaudet/ovh-cost-manager/pull/83
* fix: show unbilled months at 0 € and no growth over a first month at 0 € or below by @mmaudet in https://github.com/mmaudet/ovh-cost-manager/pull/84
### Maintenance
* build: update development dependencies with known vulnerabilities (Vite 6) by @mmaudet in https://github.com/mmaudet/ovh-cost-manager/pull/31
* docs: add the domain glossary, ADR 0001 and the agent skills setup by @mmaudet in https://github.com/mmaudet/ovh-cost-manager/pull/37
* test: add a dashboard test harness and pin down the shell, Web Cloud, Trends and Backup tabs by @mmaudet in https://github.com/mmaudet/ovh-cost-manager/pull/52
* test: pin down the Infrastructure, Compare, Public Cloud and Overview tabs by @mmaudet in https://github.com/mmaudet/ovh-cost-manager/pull/58
* test: compare the dashboard before and after a change on a real-data snapshot by @mmaudet in https://github.com/mmaudet/ovh-cost-manager/pull/53
* refactor: move the pure helpers and the resource tables out of the dashboard page by @mmaudet in https://github.com/mmaudet/ovh-cost-manager/pull/61
* refactor: move the Web Cloud tab into its own module by @mmaudet in https://github.com/mmaudet/ovh-cost-manager/pull/63
* refactor: move the Backup tab into its own module by @mmaudet in https://github.com/mmaudet/ovh-cost-manager/pull/67
* refactor: move the Trends tab into its own module by @mmaudet in https://github.com/mmaudet/ovh-cost-manager/pull/68
* refactor: move the Infrastructure tab into its own module by @mmaudet in https://github.com/mmaudet/ovh-cost-manager/pull/69
* refactor: move the Public Cloud tab into its own module by @mmaudet in https://github.com/mmaudet/ovh-cost-manager/pull/72
* refactor: move the Compare tab into its own module by @mmaudet in https://github.com/mmaudet/ovh-cost-manager/pull/73
* refactor: move the Overview tab into its own module by @mmaudet in https://github.com/mmaudet/ovh-cost-manager/pull/75
* refactor: reduce the dashboard page to its shell by @mmaudet in https://github.com/mmaudet/ovh-cost-manager/pull/77

**Full Changelog**: https://github.com/mmaudet/ovh-cost-manager/compare/v2.3.1...v2.4.0

## 2.3.1 - 2026-09-26

Security release. It updates the production dependencies that had known
vulnerabilities (express, express-rate-limit, axios, lodash) and removes uuid.
No configuration change is needed: pull the new image and recreate the
container.

### Security
* security: update runtime dependencies with known vulnerabilities by @mmaudet in https://github.com/mmaudet/ovh-cost-manager/pull/28

**Full Changelog**: https://github.com/mmaudet/ovh-cost-manager/compare/v2.3.0...v2.3.1

## 2.3.0 - 2026-09-26

### Upgrade notes

- **Docker volume.** The `ocm-data` volume moves from `/app/data` to `/data`
  (`DATA_DIR=/data`). Mounted on `/app/data`, it had frozen a copy of the
  data-layer code at the first start, so later images never updated that code.
  With the compose files of this release, the existing database is picked up as
  is: recreate the container. If you run the image with your own `docker run`
  command or compose file, make the same change (see
  [Volume Mounts](https://github.com/mmaudet/ovh-cost-manager/blob/v2.3.0/README.md#volume-mounts)).
- **Docker image tags** now start with `v`: pull `v2.3.0`, `v2.3`, `v2` or
  `latest`. The tags without `v` (`2`, `2.2`...) no longer move.
- **Reclassify past bills.** Classification fixes only apply to bills imported
  afterwards. Re-import the history once:
  `docker exec ovh-cost-manager node /app/data/import.js --from 2025-01-01 --all`.
- **New inventories.** Object Storage buckets, volumes, snapshots and Swift
  containers appear after the next import with `--include-cloud-details` or
  `--all`, which the Docker cron uses by default.
- **Node 24.** The image now runs Node 24. Local development needs Node 22 or
  later.

### New features
* Trends: month i18n, cost-by-category chart, manual resync by @guillaume-gambs in https://github.com/mmaudet/ovh-cost-manager/pull/10
* Object Storage inventory and per-resource cost across Public Cloud by @guillaume-gambs in https://github.com/mmaudet/ovh-cost-manager/pull/12
* Web Cloud tab: domains, DNS zones, hosting, email by @guillaume-gambs in https://github.com/mmaudet/ovh-cost-manager/pull/13
### Bug fixes
* Fix BILL_COUNT check by @albundy83 in https://github.com/mmaudet/ovh-cost-manager/pull/7
* Fix for missing v in the version on docker hub by @albundy83 in https://github.com/mmaudet/ovh-cost-manager/pull/8
* Fixes: dead code, Cloud Disk Array classification, health rate-limit, DB volume shadowing by @guillaume-gambs in https://github.com/mmaudet/ovh-cost-manager/pull/9
* Pre-release fixes: OVH 5xx retries, month bounds, CI by @mmaudet in https://github.com/mmaudet/ovh-cost-manager/pull/14
### Maintenance
* chore/docs: rewrite CLAUDE.md, untrack credentials.json template by @guillaume-gambs in https://github.com/mmaudet/ovh-cost-manager/pull/11
* Move to Node 24 (Docker image and CI) by @mmaudet in https://github.com/mmaudet/ovh-cost-manager/pull/15
* Changelog, release notes by category and Dependabot by @mmaudet in https://github.com/mmaudet/ovh-cost-manager/pull/16

### New contributors
* @guillaume-gambs made their first contribution in https://github.com/mmaudet/ovh-cost-manager/pull/11
* @mmaudet made their first contribution in https://github.com/mmaudet/ovh-cost-manager/pull/14

**Full Changelog**: https://github.com/mmaudet/ovh-cost-manager/compare/v2.2.2...v2.3.0

## 2.2.2 - 2026-03-02

### Bug fixes

- Docker: build the image in two stages so that npm and Node run natively on
  the build host. Node itself crashed under QEMU emulation, which broke the
  arm64 image. The runtime image no longer carries the build toolchain.

**Full Changelog**: https://github.com/mmaudet/ovh-cost-manager/compare/v2.2.1...v2.2.2

## 2.2.1 - 2026-03-02

No Docker image was published for this version: its arm64 build failed. Use
2.2.2 or later.

### Bug fixes

- Docker: download the prebuilt better-sqlite3 binary of the target platform
  instead of compiling it during the arm64 build.

**Full Changelog**: https://github.com/mmaudet/ovh-cost-manager/compare/v2.2.0...v2.2.1

## 2.2.0 - 2026-03-02

No Docker image was published for this version: its arm64 build failed. Use
2.2.2 or later.

### New features

- The database location can be set with `dataDir` in `config.json` or the
  `DATA_DIR` environment variable (#3, @albundy83).
- API rate limiting can be configured in `config.json` or through environment
  variables (#5, @RomainValmo).

### Bug fixes

- The OVH API access rules given in the README now include the root paths
  (`/me`, `/cloud`, `/vps`...), without which some calls were refused
  (#4, @albundy83).
- Rate limiting: a `0` value in `config.json` is now honoured, and invalid
  values in environment variables are rejected.

### Maintenance

- README in English, and documentation of the 2.1.0 features.

**Full Changelog**: https://github.com/mmaudet/ovh-cost-manager/compare/v2.1.0...v2.2.0

## 2.1.0 - 2026-02-20

Improved service classification and new dashboard views.

### New features

- Service classification: new AI/ML, Licenses, Support and Backup categories,
  and detection of Kubernetes, S3 object storage, the container registry,
  Private Cloud hosts, datastores and management fees, bare metal ranges,
  Windows and SQL Server licenses, Veeam backup and premium support
  (#2, @opernes).
- Resource types derived from the billing lines, with Backup and Private Cloud
  views.
- Public Cloud and backup statistics, and a page comparing the consumption of a
  project between two months.
- Faster imports: OVH API calls run in parallel batches, and are retried with
  exponential backoff when rate limited.

### Bug fixes

- Public Cloud and Private Cloud services are no longer classified as "Other".
- Fix an operator precedence error in the Compute classification rule.
- Fix the "undefined -> undefined" label in the dashboard.

### Maintenance

- The classification rules move to a shared module, `data/classify.js`, used by
  the import and the tests.
- Resource types are computed at import time only, instead of every time the
  database is opened.

**Full Changelog**: https://github.com/mmaudet/ovh-cost-manager/compare/v2.0.0...v2.1.0

## 2.0.0 - 2026-01-26

Multi-service cost visibility: besides Public Cloud, the dashboard now covers
dedicated servers, VPS and storage, with real-time consumption.

### New features

- Current month consumption and end-of-month forecast.
- Account balance and credits.
- Infrastructure inventory of dedicated servers, VPS and storage, with Domains
  and IP addresses cards. Each KPI card opens the cost detail of its resource
  type.
- Public Cloud project detail: instances, quotas and consumption, and GPU costs
  (L4, L40S, A100, H100) with a monthly GPU trend.
- Separate Public Cloud and Infrastructure tabs.
- CSV exports of bills, bill details and costs by project.
- New import options: `--include-consumption`, `--include-inventory`,
  `--include-cloud-details` and `--all`.
- Docker: a differential import runs every 24 hours (`IMPORT_ENABLED`,
  `IMPORT_INTERVAL`, `IMPORT_FLAGS`).

### Security

- OIDC back-channel logout tokens are verified: signature, expiration, issuer
  and audience.
- CORS is restricted to an explicit list of origins (`allowedOrigins` or
  `ALLOWED_ORIGINS`).
- API rate limiting: 100 requests per 15 minutes, 20 for authentication.
  Pending authentications are capped.
- Expired sessions are cleaned up every hour.

### Bug fixes

- Infrastructure KPI cards no longer show 0: the counts come from the billing
  data.
- Dates sent to the API are validated, and invalid dates such as `2026-0-25`
  are no longer produced.
- Each bill is written with its details in a single transaction during imports.

### Maintenance

- Jest test suite: date validation, service classification, CSV export,
  consumption and inventory.
- The CLI downloads bills in parallel, 5 at a time, with a progress indicator.

**Full Changelog**: https://github.com/mmaudet/ovh-cost-manager/compare/v1.2.0...v2.0.0

## 1.2.0 - 2026-01-15

### New features

- Official OVH Cost Manager logo in the dashboard and the README.

**Full Changelog**: https://github.com/mmaudet/ovh-cost-manager/compare/v1.1.0...v1.2.0

## 1.1.0 - 2026-01-15

### New features

- Sign-in with OpenID Connect (OIDC), including back-channel logout
  (#1, @guimard).
- `docker-compose.sso.yml` can be used on its own.

### Maintenance

- The Docker Compose files document how to build the image locally and which
  environment variables SSO needs.

**Full Changelog**: https://github.com/mmaudet/ovh-cost-manager/compare/v1.0.0...v1.1.0

## 1.0.0 - 2026-01-15

First release of OVH Cost Manager, grown from the
[ovh-bill](https://github.com/somanos/ovh-bill) invoice downloader by Somanos Sar.

### New features

- Web dashboard over a local SQLite database fed by the OVH API: KPI cards,
  budget progress, costs by service and by project, daily trend,
  month-to-month comparison and historical trends. Sortable tables, a French
  and English interface, and a warning when the last import is more than 30
  days old.
- Import script with full, period and differential modes, and an Express API
  serving the analyses.
- Command-line tools: invoice download with a Markdown summary, cost split by
  Public Cloud project, and bills by project or by month.
- Docker image and Docker Compose deployment, with an optional SSO setup based
  on LemonLDAP-NG. Images for amd64 and arm64 are published on Docker Hub for
  each version.

**Full Changelog**: https://github.com/mmaudet/ovh-cost-manager/commits/v1.0.0
