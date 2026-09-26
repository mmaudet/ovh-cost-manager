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
