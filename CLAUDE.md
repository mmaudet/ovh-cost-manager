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
    adding an `addColumnIfNotExists` call for existing databases.
  - `classify.js` — pure functions (`classifyService`, etc.) mapping a bill line's
    description to a service type. **Classification runs at import time** and the result is
    stored in `bill_details.service_type`; the server reads the stored value, it does not
    re-classify. Changing classification rules requires a re-import to take effect on old data.
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
  which are ES modules.
- **`dashboard/`** — Vite + React SPA (Recharts, TanStack Query, Tailwind, axios). In dev,
  Vite proxies `/api` to `:3001` (see `dashboard/vite.config.js`). i18n is FR/EN
  (`src/i18n/translations.js`). The page, `src/pages/Dashboard.jsx`, is a shell: each tab
  lives in `src/tabs/` as a `useXxxTab` hook plus an `XxxTab` component, per ADR 0001
  (`docs/adr/`). Shared components are in `src/components/`, helpers in `src/utils/`.

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
`--include-inventory`, `--include-cloud-details`, or `--all` for everything.

A run imports every configured account, one after the other, under one import log entry;
each differential import starts from that account's own latest bill. An account that
fails does not stop the others: the run then ends `partial`, or `failed` when all did.
`--account <NIC handle>` limits a run to one configured account; not with `--full` yet,
which clears every account.

### Tests

Two suites:

- **Node tests**: Jest, limited to `tests/` (`jest.roots` in the root `package.json`).
  They exercise the pure logic layer (classification, validation, CSV export, inventory,
  consumption, the auth rules), and the auth middlewares on small Express apps
  (`tests/support/http.js`). Jest cannot load `openid-client` and `jose`, ES modules, so
  the tests of `server/index.js` itself start the real server in a child process
  (`tests/support/ocm-server.js`, with a throwaway HOME and DATA_DIR, and the
  repository's `config.json` hidden): its startup settings, rate limiting, the CORS
  check, the accounts route over a database that the test seeds, and the OIDC sign-in,
  which `tests/auth-oidc-flow.test.js` goes through against a fake OpenID provider served
  in the test's process (`tests/support/fake-provider.js`).
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
https://eu.api.ovh.com/createToken/, then request a consumerKey with GET access to the
paths listed in the README. Minimum useful scope is `GET /me`, `/me/*` and `/cloud/*`:
every import reads the account it imports from `GET /me`, which `/me/*` does not cover.
The other paths enable the infrastructure inventory.

## Agent skills

### Issue tracker

Issues and specs live in the repo's GitHub Issues, used through the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five default triage labels (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single context: `CONTEXT.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.
