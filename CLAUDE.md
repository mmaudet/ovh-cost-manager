# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

OVH Cost Manager (OCM) is a self-hosted dashboard for analyzing OVHcloud billing and
infrastructure. It pulls data from the OVH API into a local SQLite database, exposes it
through an Express API, and renders it in a React/Vite dashboard. It started as a
single-file invoice downloader (`cli/index.js`) and grew into a 4-workspace monorepo.

## Architecture

npm workspaces monorepo. Data flows in one direction:

```
OVH API ──> data/import.js ──> SQLite (ovh-bills.db) ──> server/index.js (Express :3001) ──> dashboard (Vite React :5173)
```

- **`cli/`** — standalone command-line tools that hit the OVH API directly (invoice
  downloader, project cost splitter) or the local DB (`bills-by-project.js`). Not part of
  the dashboard runtime.
- **`data/`** — the data layer, shared by everything.
  - `import.js` — the only writer to the DB. Fetches from OVH API and upserts. Has retry
    with backoff (`withRetry`) and batching (`runInBatches`) to respect API rate limits.
  - `db.js` — connection singleton (`getDb()`). Opens SQLite in WAL mode, runs
    `schema.sql`, then applies idempotent runtime migrations via `addColumnIfNotExists`.
    There is no migration framework; schema changes are made by editing `schema.sql` AND
    adding an `addColumnIfNotExists` call for existing databases. A new table needs none:
    `getDb()` runs `schema.sql` at each open, whose `CREATE TABLE IF NOT EXISTS` adds it.
  - `migrations.js` — what `getDb()` migrates with: `addColumnIfNotExists()`,
    `migrateWhenNeeded()`, which takes the write lock only when the database needs the
    migration, as the import may hold that lock while the server opens the database, and
    `rekeyTable()`, for a table whose key changes, as SQLite cannot change a key in place.
  - `ownership.js` — which account each row belongs to (ADR 0002): the claims of the rows
    stored before the accounts, their attribution, the take-over of a service that two
    accounts list, and the clearing of one account. Its functions take the database;
    `db.js` exposes them on `db.accounts` and `db.clearAccount()`.
  - `sql-conditions.js` — the conditions that the queries join to their WHERE clause: that
    of an account, `accountCondition()`, with `UNKNOWN_ACCOUNT`, which `db.js` re-exports,
    that of a list of ids from the OVH API, `idInList()`, and those of the bill lines of the
    Veeam backups, `ofBackupLines`, the VMs backed up and the Enterprise licences, which
    `getBackupStats()` counts and `getBackupServices()` lists (#197). Without side effects:
    the tests load `UNKNOWN_ACCOUNT` from it without the database.
  - `classify.js` — pure functions (`classifyService`, etc.) mapping a bill line's
    description to a service type. **Classification runs at import time** and the result is
    stored in `bill_details.service_type`; the server reads the stored value, it does not
    re-classify. Changing classification rules requires a re-import to take effect on old data.
  - `carbon-footprint.js` — pure functions reading the file that OVHcloud's carbon
    calculator generates (`readFootprintFile()`), and the 24 months that each import asks
    for again (`footprintMonths()`). The import stores its lines in
    `carbon_footprint_lines`, which `db.carbon` reads; the server gives them under
    `/api/carbon/*` and `/api/export/carbon`, and the Carbon footprint tab shows them.
  - `carbon-ties.js` — pure: ties a month's footprint lines to the bill lines of its month
    of use (`CONTEXT.md`), which `billLinesOfUse()` in `db.js` selects, giving each line its
    cost and carbon intensity, and the month its covered cost and covered share. **The ties
    run when the server reads them**, unlike classification: changing them needs no
    re-import.
  - `public-cloud-lines.js` — parses the Public Cloud bill lines of instances and volumes,
    for the ties and for `db.js`.
  - `cloud-usage.js` — pure: the rows of a Public Cloud project's current consumption, from
    what OVH's `usage/current` answers, one per resource and cloud resource kind. Every part
    counts, the typed resources such as the registry included, and `other` holds what no
    part names, so that a project's rows add up to the total OVH gives it (#145). And its
    month-end forecast, the `totalPrice` that `usage/forecast` answers, of the month that its
    own `period` gives (`readForecast()`): the import keeps each project's latest in
    `project_forecasts` (#224).
  - `public-cloud-products.js` — pure: the Public Cloud product of a bill line (`CONTEXT.md`),
    and what lines add up to by product (`productFigures()`), for the Public Cloud cards, a
    project's other services, and the products of a project that the Compare tab compares
    month by month (#181). Each line has one; those without a card of their own go to the
    other services, so that the cards and the credit add up to the month's cloud total (#145).
    And the charge of a line (`chargeOf()`, `CONTEXT.md`): its description without the period
    that ends it in brackets on some accounts' bills, its apostrophes straight, so that the
    lines of one charge name it alike in every month; each product gives its charges, what its
    lines add up to by charge, which the Compare tab unfolds the product into (#195). The
    credit has none. **Products and charges are read when the server reads the bills**, like
    the ties: changing the rules needs no re-import.
  - `ai-endpoints.js` — pure: the AI Endpoints model of a bill line (`CONTEXT.md`), read from
    its charge (`chargeOf()`), and what the line counts, the model's input or output tokens or
    its cost only, and what lines add up to by model (`modelFigures()`), for
    `/api/analysis/ai-endpoints` and the Public Cloud tab's table of the models (#193), and
    month by month, for the Trends tab's chart (#196). **Models are read when the server reads
    the bills**, like the products: no re-import.
  - `month-in-progress.js` — pure: the month in progress (`CONTEXT.md`, #216), the month of
    today, as the server's local date gives it (`monthOfDate()` in `months.js`), while a
    recurring service, one that bills of each of the three months before charged, by identifier
    and account, has no bill line in it that any account's bill names.
    `db.details.getBilledServices()` reads the services that the bills charged, with the ids of
    their lines, `recurringServicesNotBilled()` tells those not billed yet, and
    `db.bills.getMonthInProgress()` composes the two for `GET /api/months`, which marks the
    month `inProgress: true` for the account asked. Its projection (#217): each service not
    billed yet comes with its projected lines, its bill lines of the month before, which
    `linesOfPeriod()` in `db.js` adds, dated on the month's first day, to the lines that a
    query of costs adds up, when asked and when its period covers the month in progress: the
    projected cost (`CONTEXT.md`). **Read when the server reads the bills**, like the
    products: no re-import.
  - `storage-classes.js` — pure: the names of the storage classes that OVH gives the objects
    of a bucket, for the import and for the buckets an earlier import stored (#145).
- **`server/`** — read-only Express API over the DB. `index.js` is the single ~1300-line
  route file. `auth/` guards the API in one of two modes. With OIDC (openid-client v6):
  PKCE sign-in bound to the browser by a signed cookie per state, SQLite-backed sessions
  in cookies signed with `SESSION_SECRET`, back-channel logout tokens verified with
  `jose`. Without it, header mode reads `Auth-User` from the SSO proxy, required with
  `AUTH_REQUIRED`. It fails closed: with OIDC enabled it never falls back to header mode,
  a missing or malformed setting stops the server, and `/api` and `/auth` answer 503
  until the provider is discovered. Its decisions live in small pure modules
  (`config.js`, `session-cookie.js`, `login-state.js`, `logout-token.js`, `provider.js`,
  `health.js`…); only `oidc-client.js` and `routes.js` load `openid-client` and `jose`,
  which are ES modules. Besides each tab's figures, the routes give what the Compare tab's
  rows unfold into (#189): the services of a resource type,
  `/api/analysis/resource-type-details`, which the Infrastructure tab lists too, and those
  of the Veeam backups, the VMs backed up and the Enterprise licences,
  `/api/analysis/backup-services` (#197), both once for each account with `byAccount=true`;
  and a project's products with their charges, `/api/projects/:id/products` (#181, #195).
  The routes of the Trends and Compare tabs take `projected=true` (`projectedParameter`,
  #214): the monthly trends, the summary, the costs by service type, resource type and
  project, a resource type's services, the Veeam backups and their services, and a project's
  products. With it, when their period covers the month in progress, they count its
  projected cost, and each row gives its projected part, `projected` (`projectedPartOf()`);
  without it, they answer as before.
  The consumption and forecast cards read `/api/consumption/current` and `/forecast`, which
  `consumption.js` answers from an account's Public Cloud projects whenever they consumed in
  the month of its current consumption, as OVH's Public Cloud page does (#224): their
  consumption, and the sum of each project's forecast (`getProjectFigures()` in `db.js`),
  the month-end forecast that OVH gives it, or else its consumption extrapolated over its own
  days, what OVH gives for the whole month counted once (#145); never below what it consumed,
  as OVH's forecast estimates the next bill, which can fall below it as the month ends.
  Otherwise from the account's `/me/consumption` snapshot, which can stay on one transaction
  for days while the projects consume.
- **`dashboard/`** — Vite + React SPA (Recharts, TanStack Query, Tailwind, axios). In dev,
  Vite proxies `/api` to `:3001` (see `dashboard/vite.config.js`). i18n is FR/EN
  (`src/i18n/translations.js`). The page, `src/pages/Dashboard.jsx`, is a shell: each tab
  lives in `src/tabs/` as a `useXxxTab` hook plus an `XxxTab` component, per ADR 0001
  (`docs/adr/`). Shared components are in `src/components/`, helpers in `src/utils/`.
  The tables that list rows all sort one way, through `src/components/SortableHeader.jsx`
  (#146): a `SortableHeader` per column, `sortRows()` for the rows, by their raw values,
  and the order in the tab's hook, with `useTableSorts()`; a table keeps its own order
  until a header is clicked, and its CSV export keeps it whatever the order shown.
  The Compare tab's rows unfold into what they add up, their services or a product's
  charges (#189), through `src/components/UnfoldingRow.jsx`: `UnfoldingRow` draws a row
  whose chevron unfolds it, `DetailRow` each service or charge under it, `sortUnfolded()`
  orders those within their row, and `useUnfoldedRows()`, in the tab's hook, holds the rows
  unfolded. In `CompareTab.jsx`, `drawServicesRow()` draws a row of the infrastructure,
  Private Cloud or backup comparison, which `UnfoldedRowServices.jsx` unfolds into its
  services, from the query of a month that its `servicesQueryOf` prop gives, run once the
  row unfolds; `ProjectProductComparison.jsx` unfolds a product into its charges, which come
  with the products. `src/utils/monthComparison.js` pairs what months A and B gave
  (`pairMonths()`), a service by its identifier and its account (`byNameAndAccount()`), and
  gives the value of a row in the columns that sort it (`comparisonValues()`).

### Accounts

One database holds every account's data (ADR 0002; `CONTEXT.md` defines Account and
Unknown account). An account is its NIC handle, which each import reads from `GET /me`.
In every layer, all accounts is the absence of a filter, and one account a filter on its
NIC handle:

- **Data layer.** The root tables fed by the OVH API hold the NIC handle in an `account`
  column; bill lines and a project's resources, consumption, forecasts and quotas reach it
  through their bill or project. Their writers require the account (`requireAccount()`), so
  a row without one was stored before the accounts: the Unknown account's. A query that can
  keep one account's rows takes an `account` argument, `null` for all accounts,
  `UNKNOWN_ACCOUNT` or a NIC handle, and joins `accountCondition()` to its WHERE clause.
  The carbon footprint's lines always carry their account: no claim reaches them.
- **API.** Every route that lists or adds up data takes the optional `account` parameter
  through the `accountParameter` middleware (`server/account-parameter.js`), into
  `req.account`: a NIC handle that the `accounts` table records, `unknown`, or none for all
  accounts; anything else gets a 400. The routes of one bill or one project need none, as
  that bill or project belongs to one account, but for `/api/projects/:id/products`, which
  breaks down what `/api/analysis/by-project` gives a project for an account: a project's
  bill lines belong to the account of their bill, which may not be the project's own.
  Without it, a route answers as before the accounts, and the account-wide figures
  (consumption, forecast, balance, consumption history, carbon footprint) add up the
  accounts. `byAccount=true` opts a list of projects or services into one row per account,
  and the CSV exports gain a last `account` column once `/api/accounts` lists two entries
  (`sendCsv()`). `GET /api/accounts` lists the recorded accounts, then the Unknown account
  while rows without an account remain.
- **Dashboard.** The shell holds the selected account (`useSelectedAccount()`, remembered
  in the browser, per ADR 0001) and passes `selectedAccount` to the tab hooks: `null` for
  all accounts, the default, or the `id` that `/api/accounts` gives. A query that follows
  it is built with `accountQuery()` (`src/utils/accounts.js`): its request and its key name
  the account only when one is selected, after the other parts of the key. A list that
  follows the Account column too is built with `listQuery()`, next to it, the one factory
  of such queries: while the column shows, it asks for the rows of all accounts by account,
  a project or a service once for each account that billed it; otherwise, for those of the
  account shown, as `accountQuery()` does. A query of the month in progress that may count
  its projected cost is built with `projectedQuery()`, next to them: its key names the flag
  (`projected`) only while the page projects the month, after the other parts and before the
  account (ADR 0001). The shell holds that setting, `useMonthInProgressProjection()`,
  remembered in the browser and off by default (#214): the Trends and Compare tabs show it
  as a checkbox, and their queries of the month in progress follow it; the header's cards
  and the other tabs never project. The selector
  shows when `/api/accounts` lists two entries or more (`offersAccounts()`), the Unknown
  account and the accounts no longer configured included. The same module gives the
  Account column of the lists and CSV exports with all accounts shown, the budget the page
  compares with, and the scope the report names.

A single-account installation sends the same requests as before the accounts, under the
same query keys, plus `GET /api/accounts` under `['accounts']`, while the page does not project
the month in progress, and shows the same page:
`dashboard/test/shell-queries.test.jsx` pins the keys, and the real-data comparison of
`CONTRIBUTING.md` checks the page.

### Configuration resolution

Two settings are resolved with the same priority pattern, used independently in `db.js`
and `server/index.js`. Each of them, and the import, loads the config file on its own;
what they share is how values are checked: `data/strict-settings.js`, which
`server/settings.js` builds on, and `data/accounts-config.js` for the accounts.

- **config file**: `./config.json` first, then `~/my-ovh-bills/config.json`. Legacy flat
  `credentials.json` is still accepted. The server stops when the first one that exists
  cannot be parsed, rather than run without its settings.
- **`dataDir`** (where `ovh-bills.db` lives): `DATA_DIR` env var > `config.json` `dataDir` > the `data/` directory.
- **rate limiting / auth / etc.**: environment variables override `config.json` values.
  These settings go through one strict parser (`server/settings.js`). The booleans of
  authentication, rate limiting and `IMPORT_ENABLED` take `true` or `false`, in any case
  in the environment, JSON booleans in `config.json`, and `auto` for the cookie's `Secure`
  flag; `TRUST_PROXY`, these or the number of proxies to trust, from 1 to 10, `true` for
  one; the rate limits and `auth.session.maxAge`, positive integers; the `auth` and
  `rateLimit` sections, and those under them, objects; the lists, such as
  `allowedOrigins`, arrays of strings or comma-separated strings. Anything else stops the
  server, naming the setting. The rate limiting settings are resolved in
  `server/rate-limit-config.js`.
- **OVH accounts**: the `accounts` array (each entry an optional unique `name`, an
  optional positive integer `budget`, and its `credentials`, `endpoint` included), or,
  as before, the single `credentials` section or the legacy flat form, where `endpoint`
  is optional; never `accounts` with either of those. They have no environment override:
  their secrets stay in `config.json`, which the compose files mount read-only. One
  strict reader, `data/accounts-config.js`, serves the import, which reads them from the
  first config file that gives any, and the server, which only checks them at startup: it
  never uses the keys, and names each account as its last import recorded it in the
  `accounts` table.

When adding a configurable option, follow this same env-over-file pattern and apply it in
the relevant workspace's own loader.

## Commands

```bash
npm install              # installs all workspaces

# Data import (writes to SQLite) — see flags below
npm run import:full      # full import, all history
npm run import:diff      # differential since last import
npm run import -- --from 2025-01-01 --all   # date range + all extra datasets

# Dev (run both, or separately)
npm run dev              # server (:3001) + dashboard (:5173) concurrently
npm run dev:server
npm run dev:dashboard

npm run build            # build the dashboard for production

# CLI tools (note the `--` to pass args through npm)
npm run cli -- --from=2025-01-01 --to=2025-12-31
npm run split -- --from 2025-12-01 --to 2025-12-31 --format md
npm run bills -- --project "AI" --format md
```

### import.js flags

`--full` (clears + reimports) | `--diff` [`--since DATE`] | `--from`/`--to` | and the extra
datasets, off by default: `--include-consumption`, `--include-account`,
`--include-inventory`, `--include-cloud-details`, `--include-carbon`, or `--all` for
everything.

`--include-cloud-details` imports each Public Cloud project's inventory, its consumption of
the month (`usage/current`), and its month-end forecast (`usage/forecast`, #224), dated by
its own period: the month can turn between the two calls. A forecast call that fails keeps
the forecast stored, as a failed call keeps a project's stored volumes, and the import goes
on. `--full` keeps the forecasts, as it keeps the projects' consumption, which the cards
read with them: an import without the cloud details fetches neither again.

`--include-carbon` asks OVHcloud's carbon calculator for each account's footprint of the
last 24 months: it calls `POST /me/carbonCalculator/csv`, which the key needs a rule for,
polls the task every 3 seconds, for 2 minutes at most, and downloads the file from its
pre-signed link. The calculator accepts the request with 202, which the `ovh` client takes
for an error, losing the task's id: the import makes these calls itself, with the client's
keys (`data/ovh-accepting-request.js`, #179). It replaces those months and keeps the older
ones, which OVHcloud no longer gives, `--full` included (ADR 0003). A key without the rule
gets a warning; any other failure, a wait that runs out included, counts among the failed
items, and replaces nothing.

A run imports every configured account, one after the other, under one import log entry;
each differential import starts from that account's own latest bill. An account that
fails does not stop the others: the run then ends `partial`, or `failed` when all did.
`--account <NIC handle>` limits a run to one configured account. What acts on a whole
table acts on the imported account only: the removal of the services OVH no longer
lists, the replacement of the consumption history, and the clearing of `--full`, which
clears each account it can import, or the one of `--account`. A service that two accounts
list is stored once: it belongs to the account that bills it, or else to the first
configured account that lists it. An account removed from the configuration keeps its
data, and is no longer imported.

The rows stored before the accounts (#112) carry no account. A single configured account,
in a database that has only ever known that account, gets them all at its first import: a
run whose configuration lists several entries marks the database for good. Otherwise each
account claims those that its API lists: its bills, from its whole bill list, its projects
and services, and its credit movements, the very ones its API gives. Once no bill is left
without an account, and all those claimed went to one account, the database was that
account's, which gets the rest, and its own older copies go (ADR 0002). The rest stay
without an account, as the Unknown account's (`CONTEXT.md`), and the balance and
consumption snapshots go.

### Tests

Two suites:

- **Node tests**: Jest, limited to `tests/` (`jest.roots` in the root `package.json`).
  They exercise the pure logic layer (classification, validation, CSV export, inventory,
  consumption, the auth rules), and the auth middlewares on small Express apps
  (`tests/support/http.js`). Jest cannot load `openid-client` and `jose`, ES modules, so
  the tests of `server/index.js` itself start the real server in a child process
  (`tests/support/ocm-server.js`, with a throwaway HOME and DATA_DIR, and the
  repository's `config.json` hidden): its startup settings, rate limiting, the CORS
  check, the accounts and carbon routes over a database that the test seeds, and the OIDC
  sign-in, which `tests/auth-oidc-flow.test.js` goes through against a fake OpenID
  provider served in the test's process (`tests/support/fake-provider.js`).
- **Dashboard tests**: Vitest and Testing Library in jsdom, in `dashboard/test/`. The page
  tests render the whole dashboard with the API service module replaced by synthetic
  fixtures, act like a user and check what is visible. They pin the dashboard's behaviour:
  change them only when the behaviour is meant to change. The hook and unit tests, in
  `dashboard/test/unit/`, pin the modules. "Today" is frozen on 15 September 2026, in
  Europe/Paris time.

```bash
npm test
npm test -- tests/classification.test.js          # single file
npm test -- -t "classifies instance types"        # single test by name
npm run test:coverage
npm test --workspace=dashboard                    # dashboard tests
npm test --workspace=dashboard -- test/web-cloud.test.jsx
npm run lint                                      # ESLint, no-undef only (eslint.config.mjs)
```

CI (`.github/workflows/ci.yml`) runs lint, both test suites and the dashboard build on
every pull request and push to main.

## Releases and changelog

Every change goes through a pull request: its title is its changelog line, and it needs
one category label (`feature`, `security`, `bug`, `maintenance`, `dependencies`,
`documentation`, or `skip-changelog`). `.github/workflows/pr-labels.yml` sets it from a
Conventional Commits title prefix and fails otherwise; `.github/release.yml` maps the
labels to the release-note headings.

`npm run release -- X.Y.Z` (`scripts/release.sh`) generates the notes from those labels,
inserts them in `CHANGELOG.md`, bumps the version and opens the release PR;
`npm run release -- --tag` tags main once it is merged. The tag runs
`docker-publish.yml`, which publishes the image and creates the GitHub release from the
`CHANGELOG.md` section. Since #8, Docker image tags keep the `v` prefix (`v2.3.0`);
up to 2.2.2 they did not (`2.2.2`).

## Docker

`scripts/entrypoint.sh` runs `cron-import.sh` in the background (periodic differential
import, default 24h, controlled by `IMPORT_*` env vars) and the Express server in the
foreground. At start, the cron runs a full import only when the DB holds no bill: it
counts them with `data/count-bills.js`, straight from the DB, since OCM's own API needs a
login under authentication. When the count fails, `scripts/import-decision.sh` picks a
differential import rather than a full one, which would clear the data first.
`IMPORT_FLAGS` applies to every run, the first included.

- `docker-compose up -d --build` — simple mode, dashboard on `:3001`. OCM runs in header
  mode there (OIDC off by default) with no proxy in front: any client can send its own
  `Auth-User`, so `AUTH_REQUIRED=true` keeps out only the clients that send none.
- `docker-compose -f docker-compose.sso.yml up -d --build` — SSO mode, a standalone file:
  LemonLDAP-NG is the OIDC provider and, through its RELAY (its built-in reverse proxy),
  the only way in to OCM, which signs users in itself with OIDC. The
  `yadd/lemonldap-ng-portal` image has no Manager: OCM's relying party comes from
  `demo/sso/`, mounted at `/over` as config overrides (`demo/README.md`).

**`TRUST_PROXY` is required behind any reverse proxy / Kubernetes ingress**: `true` for
one proxy, or their number, up to 10, such as `2` for a TLS terminator in front of the
SSO relay. Otherwise rate limiting buckets all users under a proxy's single IP and
everyone shares one limit. With one or more, the server also trusts `X-Forwarded-Host`
and `X-Forwarded-Proto` for the CORS check (`server/cors.js`), and the last
`X-Forwarded-Host` for the `ALLOWED_HOSTS` check (`server/hosts.js`); the CORS check
always accepts the dashboard's own origin.

See `docs/deployment.md` for full SSO/OIDC setup.

## OVH API credentials

Three values (`appKey`, `appSecret`, `consumerKey`) plus `endpoint` (e.g. `ovh-eu`), stored
under `credentials` in `config.json`, or under that of each entry of `accounts` for several
accounts (see Configuration resolution). Generate appKey/appSecret at
https://eu.api.ovh.com/createToken/, then request a consumerKey with the access rules
listed in the README: GET on its paths, and the optional `POST /me/carbonCalculator/csv`.
Minimum useful scope is `GET /me`, `/me/*` and `/cloud/*`: every import reads the account
it imports from `GET /me`, which `/me/*` does not cover. The other paths enable the
infrastructure inventory, and the POST rule the carbon footprint.

## Agent skills

### Issue tracker

Issues and specs live in the repo's GitHub Issues, used through the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five default triage labels (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single context: `CONTEXT.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.
