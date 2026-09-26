# Contributing to OVH Cost Manager

First off, thank you for considering contributing to OVH Cost Manager! It's people like you that make it such a great tool.

## Code of Conduct

This project and everyone participating in it is governed by our [Code of Conduct](CODE_OF_CONDUCT.md). By participating, you are expected to uphold this code.

## How Can I Contribute?

### Reporting Bugs

Before creating bug reports, please check the existing issues to avoid duplicates. When you create a bug report, include as many details as possible:

- **Use a clear and descriptive title**
- **Describe the exact steps to reproduce the problem**
- **Provide specific examples** (command lines, configuration files)
- **Describe the behavior you observed and what you expected**
- **Include your environment** (Node.js version, OS, etc.)

To report a security vulnerability, do not open an issue: see [SECURITY.md](SECURITY.md).

### Suggesting Enhancements

Enhancement suggestions are tracked as GitHub issues. When creating an enhancement suggestion:

- **Use a clear and descriptive title**
- **Provide a detailed description of the suggested enhancement**
- **Explain why this enhancement would be useful**
- **List any alternatives you've considered**

### Pull Requests

1. **Fork** the repository
2. **Create a branch** from `main` for your changes:
   ```bash
   git checkout -b feature/my-new-feature
   ```
3. **Make your changes** and commit them with clear messages:
   ```bash
   git commit -m "feat: add the Web Cloud tab"
   ```
4. **Push** to your fork:
   ```bash
   git push origin feature/my-new-feature
   ```
5. **Open a Pull Request** against the `main` branch

### Commit Messages

- Use the present tense ("Add feature" not "Added feature")
- Use the imperative mood ("Move cursor to..." not "Moves cursor to...")
- Limit the first line to 72 characters or less
- Reference issues and pull requests when relevant

## Pull Requests and the Changelog

The title of a pull request becomes its line in the [changelog](CHANGELOG.md)
and in the release notes: write it for users, saying what changes for them.

Each pull request also needs one category label, which files it under a
heading of the release notes:

| Label                                          | Heading                                         |
| ---------------------------------------------- | ----------------------------------------------- |
| `feature`                                      | New features                                    |
| `security`                                     | Security                                        |
| `bug`                                          | Bug fixes                                       |
| `maintenance`, `dependencies`, `documentation` | Maintenance                                     |
| `skip-changelog`                               | Left out, for instance the release pull request |

A title starting with a [Conventional Commits](https://www.conventionalcommits.org/)
prefix gets its label automatically: `feat:` → `feature`, `fix:` → `bug`,
`security:` → `security`, and `chore:`, `ci:`, `build:`, `docs:`, `refactor:`,
`test:` or `perf:` → `maintenance`. Otherwise a maintainer sets it during the
review: the **PR labels** check fails until the pull request has one.

Dependabot pull requests are labelled `dependencies`. When one fixes a
vulnerability, add the `security` label so that it is listed under Security.

## Releases

Maintainers release from an up-to-date `main`:

```bash
npm run release -- 2.3.0 --dry-run   # preview the release notes
npm run release -- 2.3.0             # open the "Release 2.3.0" pull request
npm run release -- --tag             # once it is merged: tag main
```

The release pull request adds the notes to `CHANGELOG.md` and bumps the
version: review it and add upgrade notes if needed. Pushing the tag builds and
publishes the Docker image, then creates the GitHub release from the
`CHANGELOG.md` section.

## Checking the dashboard on real data

A change that must not change what users see, such as a step of a refactoring,
can be checked on the maintainer's own data: a script builds the dashboard
before and after the change, serves both on the same frozen snapshot of the
database, and reports every difference in what they show. It runs on the
maintainer's machine only, never in CI.

### Taking a snapshot

A snapshot is a complete import, every dataset included, into a data directory
of its own:

```bash
DATA_DIR=~/ovh-cost-manager-snapshots/2026-09-26 node data/import.js --full --all
```

The import calls the OVH API with the credentials of your `config.json`. Take
the snapshot once, before the refactoring starts, and never import into it
again while the refactoring is in progress: every step must be compared on the
same data. The comparison only reads the snapshot, and works on copies.

### Running the comparison

```bash
npm run compare:dashboard -- --data ~/ovh-cost-manager-snapshots/2026-09-26
```

This compares `main` with your working tree, uncommitted changes included. Use
`--base` and `--head` to compare two refs, and `--help` for all the options. The
script:

- copies the snapshot database once: as plain files when nothing has it open,
  or with SQLite's backup API when an import may be writing to it (a `-shm`
  file exists), which updates the snapshot's `-shm` index, never its data.
  Each side gets its own copy, which its server migrates as it starts;
- builds the base in a temporary git worktree (`npm ci`, native binaries of
  better-sqlite3 and esbuild, `npm run build`), and the working tree in place;
- serves each side with imports turned off (`IMPORT_ENABLED=false`), without
  authentication or rate limiting, and lets the page read only: any other
  request, such as a resync, is refused and recorded as a section of its own.
  Nothing calls the OVH API, even with older commits that ignore
  `IMPORT_ENABLED`;
- opens both in Google Chrome, or in Playwright's Chromium if Chrome is missing
  (`npx playwright install chromium`), with the clock frozen at the date of the
  latest bill (`--clock`) and the page in French (`--lang en` or `--lang both`);
- for the month the page opens on and the same month a year earlier
  (`--months`), captures the visible text of the shell (header, KPI cards, tab
  bar, footer), of every tab and of every "show all" modal, and the content of
  the CSV exports and of the Markdown report; it also opens the Compare
  accordions, every Public Cloud project (`--projects 3` for the first three
  only) and every resource type of the Infrastructure tab, then the Compare tab
  again, which only lists the dedicated servers once the Infrastructure tab has
  loaded them;
- compares the two captures section by section, normalising nothing but runs
  of spaces, tabs and line breaks (the no-break spaces of amounts are kept),
  prints the differences, and exits with 1 when there is any, 0 otherwise, or
  2 when it could not complete. The one exception is the section of the page's
  console errors: each message keeps its first line only, with the server's
  address and the bundle's file names replaced, and its number of occurrences;
- ends the report with its coverage: every table the page can show in full and
  export, flagged when no capture reached its modal or its CSV, as for a table
  the snapshot never fills (savings plans, or dedicated servers without an
  inventory), then the sections empty on both sides, which were not compared.

A run takes about two and a half minutes, twice that with `--lang both`. The
captures (`base.json`, `head.json`), the report and the logs go to the
temporary directory it prints, or to `--out`. A refactoring step is ready to
merge only when the comparison finds no difference.

The comparison does not see everything: styles, tooltips and chart shapes are
not captured. Nor is the server's clock frozen: the months of the Trends tab
(SQLite's `date('now')`) and the services about to expire follow the real
date. Both sides see the same, but as real time passes during a refactoring,
the Trends tab shows fewer and fewer months of the snapshot. The report starts
with the state of the snapshot (bills, last import, empty datasets) and both
dates, and warns when an import is running or has failed, and when the real
month is past the latest bill. When the working tree holds a `config.json`, the
base reads it too, so that both show the same budget.

Snapshots, database copies and captures hold real billing data: never commit
them, nor attach them to an issue or a pull request. The script refuses an
output directory in the snapshot, or in the work tree of any repository where
git does not ignore it, symbolic links followed.

## Development Setup

1. Clone your fork:
   ```bash
   git clone https://github.com/YOUR_USERNAME/ovh-cost-manager.git
   cd ovh-cost-manager
   ```

2. Install dependencies (Node.js 22 or later):
   ```bash
   npm install
   ```

3. Set up your credentials (see [README.md](README.md#configuration))

4. Check your changes, as the CI does on each pull request:
   ```bash
   npm run lint
   npm test                          # Node tests (Jest), in tests/
   npm test --workspace=dashboard    # dashboard tests (Vitest), in dashboard/test/
   npm run build
   ```

### Dashboard tests

The dashboard tests render the whole page in jsdom, without a browser, with
[Vitest](https://vitest.dev/) and [Testing Library](https://testing-library.com/):

```bash
npm test --workspace=dashboard                               # all of them
npm test --workspace=dashboard -- test/web-cloud.test.jsx    # one file
npm test --workspace=dashboard -- -t "closes with Escape"    # by name
```

- They act like a user (open a tab, change the month, open a "show all"
  modal, export a CSV) and check what the user sees: text, amounts, table
  rows, file contents. No DOM snapshots, and nothing inside the charts.
- Only the API service module (`dashboard/src/services/api.js`) is replaced,
  once for every test file, in `dashboard/test/setup.js`. Its stand-in answers
  from the small, synthetic fixtures of `dashboard/test/fixtures/`. Never put
  real billing data there.
- "Today" is frozen on 15 September 2026 and the timezone on Europe/Paris, so
  that dates read the same on every machine.

Besides these page tests, the pure helpers split out of the page have unit
tests in `dashboard/test/unit/`: each helper is called through what its module
exports, and checked against literal values. So does the hook of each tab, in
`dashboard/test/unit/use-*-tab.test.jsx`: `renderTabHook()` calls it as the
shell does, with the API stand-in, and the tests check what it requests and
returns.

## Style Guide

- Use 2 spaces for indentation
- Use semicolons
- Use single quotes for strings
- Add trailing commas in multiline objects/arrays
- Keep lines under 100 characters when possible

## Questions?

Feel free to open an issue with your question or reach out to the maintainers.

Thank you for contributing!
