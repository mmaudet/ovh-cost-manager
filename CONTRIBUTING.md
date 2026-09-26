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

## Style Guide

- Use 2 spaces for indentation
- Use semicolons
- Use single quotes for strings
- Add trailing commas in multiline objects/arrays
- Keep lines under 100 characters when possible

## Questions?

Feel free to open an issue with your question or reach out to the maintainers.

Thank you for contributing!
