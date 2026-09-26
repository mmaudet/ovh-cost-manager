// Compares the dashboard built from two versions of the code, on a frozen copy of a
// snapshot of real data: every tab, every "show all" modal and every export, under a frozen
// clock. For the maintainer's machine only, never for CI: see CONTRIBUTING.md.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { captureDashboard, launchBrowser } from './capture.mjs';
import { compareCaptures, describeCoverage, formatDifferences } from './report.mjs';
import {
  DB_FILE, build, createWorktree, ensureNativeBinaries, freezeSnapshot, git, loadBetterSqlite,
  startServer, stopChildren,
} from './sides.mjs';

const USAGE = `Usage: npm run compare:dashboard -- --data <dir> [options]

Builds the dashboard from a base and from a head, serves each one on its own copy of a
snapshot database, and compares what they show: every tab, "show all" modal and export,
under a frozen clock. Exits with 0 when nothing differs, 1 when something does, 2 when the
comparison could not be completed.

  --data <dir>        snapshot data directory, holding ${DB_FILE} (required, never written to)
  --base <ref>        the code before the change (default: main)
  --head <ref>        the code after it (default: the working tree, uncommitted changes included)
  --out <dir>         where to write the captures and the report (default: a new temporary
                      directory)
  --clock <date>      the time the page sees, as YYYY-MM-DD or an ISO date-time (default: the
                      date of the latest bill, at noon UTC)
  --lang <language>   fr, en or both (default: fr)
  --months <list>     months to capture, comma-separated: "default" for the month the page
                      opens on, YYYY-MM for a month picked in the month selector (default: the
                      month the page opens on and the same month a year earlier)
  --projects <n>      Public Cloud projects to open: all, or the first <n> of the list
                      (default: all)
  --help              show this help`;

class UsageError extends Error {}

// Cleanup steps, run last to first, once, however the run ends
const cleanups = [];
const defer = (step) => cleanups.push(step);
let cleaning = null;
function cleanup() {
  cleaning ??= (async () => {
    await stopChildren();
    for (const step of cleanups.reverse()) {
      try {
        await step();
      } catch (error) {
        console.error(`Cleanup: ${error.message}`);
      }
    }
  })();
  return cleaning;
}

let interrupted = null;
class Interrupted extends Error {}

// After a signal nothing new starts: the cleanup is under way
function stopIfInterrupted() {
  if (interrupted) throw new Interrupted();
}

async function finish(code) {
  await cleanup();
  process.exit(interrupted ?? code);
}

function stop(error) {
  if (!interrupted) {
    console.error(error instanceof UsageError
      ? `${error.message}\n\n${USAGE}`
      : `\nThe comparison stopped: ${error.stack ?? error}`);
  }
  return finish(2);
}

async function main(argv) {
  const options = parseOptions(argv);
  if (options.help) {
    console.log(USAGE);
    return 0;
  }
  const started = Date.now();
  const repo = git(['rev-parse', '--show-toplevel'], process.cwd());
  const sides = [
    describeSide('base', options.base, repo),
    describeSide('head', options.head, repo),
  ];

  const { dir: out, created } = outputDirectory(options);
  const logs = path.join(out, 'logs');
  fs.mkdirSync(logs, { recursive: true });
  // A run that stops before writing anything leaves no empty directory of its own behind
  defer(async () => {
    const own = [logs];
    for (let dir = out; created && dir !== path.dirname(dir); dir = path.dirname(dir)) {
      own.push(dir);
      if (dir === created) break;
    }
    for (const dir of own) {
      try {
        fs.rmdirSync(dir);
      } catch {
        // Not empty: kept
      }
    }
  });
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'ocm-compare-'));
  defer(async () => fs.rmSync(work, { recursive: true, force: true }));

  // This script reads the snapshot with the working tree's better-sqlite3
  await ensureNativeBinaries(repo, path.join(logs, 'setup.log'), { esbuild: false });
  const frozen = path.join(work, DB_FILE);
  const snapshot = await freezeSnapshot(options.data, frozen, loadBetterSqlite(repo));
  const clock = resolveClock(options.clock, snapshot.latestBill);
  const { months, openingMonth } = resolveMonths(options.months, snapshot.months);

  const state = describeSnapshot(snapshot, clock, new Date());
  const monthList = months
    .map((month) => (month === openingMonth ? `${month} (the page opens on it)` : month));
  const projects = options.projects === Infinity ? 'all' : `the first ${options.projects}`;
  const header = [
    `Snapshot  ${options.data}: ${snapshot.bills} bills, the latest on ${snapshot.latestBill}`,
    `Import    ${state.lastImport}`,
    `Empty     ${state.empty}`,
    `Clock     ${clock.toISOString()} in the browser, frozen; `
      + `the real date is ${state.realDate} (UTC)`,
    `Base      ${sides[0].label}`,
    `Head      ${sides[1].label}`,
    `Captures  ${options.languages.join(', ')}; months ${monthList.join(', ')}; `
      + `${projects} Public Cloud projects`,
    `Output    ${out}`,
    ...state.warnings.map((warning) => `Warning   ${warning}`),
  ];
  console.log(`${header.join('\n')}\n`);

  stopIfInterrupted();
  await Promise.all(sides.map((side) => prepare(side, { repo, work, logs })));
  shareSettings(sides, repo);
  for (const side of sides) {
    stopIfInterrupted();
    const dataDir = path.join(work, `${side.name}-data`);
    fs.mkdirSync(dataDir);
    fs.copyFileSync(frozen, path.join(dataDir, DB_FILE));
    const log = path.join(logs, `${side.name}-server.log`);
    side.url = await startServer({ dir: side.dir, dataDir, log, defer });
  }
  const prepared = Date.now();

  stopIfInterrupted();
  const { browser, name, note } = await launchBrowser();
  defer(() => browser.close());
  if (note) console.log(note);
  const browserName = `${name} ${browser.version()}`;
  console.log(`Capturing with ${browserName}…`);
  const captures = await Promise.all(sides.map(async (side) => {
    const start = Date.now();
    const result = await captureDashboard(browser, {
      url: side.url,
      clock,
      languages: options.languages,
      months,
      openingMonth,
      projects: options.projects,
      onProgress: (step, count) => {
        if (interrupted) return;
        console.log(`[${side.name}] ${step}: ${count} sections (${duration(Date.now() - start)})`);
      },
    });
    return {
      side: side.name,
      code: side.label,
      commit: side.commit,
      browser: browserName,
      clock: clock.toISOString(),
      languages: options.languages,
      months,
      projects: options.projects === Infinity ? 'all' : options.projects,
      snapshot: state.stored,
      failures: result.failures,
      sections: result.sections,
    };
  }));
  // Closing the browser on a signal makes every step left fail: that is no capture
  stopIfInterrupted();
  const captured = Date.now();
  for (const capture of captures) {
    const file = path.join(out, `${capture.side}.json`);
    fs.writeFileSync(file, `${JSON.stringify(capture, null, 2)}\n`);
  }

  const { total, differences } = compareCaptures(captures[0], captures[1]);
  const failures = captures
    .flatMap((capture) => capture.failures.map((failure) => `[${capture.side}] ${failure}`));
  const verdict = differences.length
    ? `${differences.length} of ${total} sections differ.`
    : `No difference in ${total} sections.`;
  const incomplete = failures.length
    ? [`${failures.length} capture step(s) failed, the comparison is incomplete:`,
      ...failures.map((failure) => `  ${failure}`)]
    : [];
  const coverage = describeCoverage(captures[0], captures[1]);
  fs.writeFileSync(path.join(out, 'report.txt'), [
    ...header,
    '',
    formatDifferences(differences),
    ...incomplete,
    ...coverage,
    verdict,
    '',
  ].join('\n'));
  if (differences.length) console.log(`\n${formatDifferences(differences, 40)}`);
  for (const line of ['', ...incomplete, ...coverage, verdict]) console.log(line);
  console.log(`Prepared in ${duration(prepared - started)}, `
    + `captured in ${duration(captured - prepared)}, ${duration(Date.now() - started)} in all.`);
  console.log(`Captures and report: ${out}`);
  if (differences.length) return 1;
  return failures.length ? 2 : 0;
}

function parseOptions(argv) {
  let values;
  try {
    ({ values } = parseArgs({
      args: argv,
      options: {
        data: { type: 'string' },
        base: { type: 'string', default: 'main' },
        head: { type: 'string' },
        out: { type: 'string' },
        clock: { type: 'string' },
        lang: { type: 'string', default: 'fr' },
        months: { type: 'string' },
        projects: { type: 'string', default: 'all' },
        help: { type: 'boolean', short: 'h' },
      },
    }));
  } catch (error) {
    throw new UsageError(error.message);
  }
  if (values.help) return { help: true };
  if (!values.data) throw new UsageError('--data is required: the snapshot data directory.');
  const languages = { fr: ['fr'], en: ['en'], both: ['fr', 'en'] }[values.lang];
  if (!languages) throw new UsageError(`--lang ${values.lang}: fr, en or both.`);
  const projects = values.projects === 'all' ? Infinity : Number(values.projects);
  if (projects !== Infinity && (!Number.isInteger(projects) || projects < 0)) {
    throw new UsageError(`--projects ${values.projects}: all, or a whole number.`);
  }
  return { ...values, data: path.resolve(expandHome(values.data)), languages, projects };
}

const expandHome = (value) => (value === '~' || value.startsWith('~/')
  ? path.join(os.homedir(), value.slice(1))
  : value);

function describeSide(name, ref, repo) {
  if (!ref) {
    const commit = git(['rev-parse', 'HEAD'], repo);
    const changed = git(['status', '--porcelain'], repo) !== '';
    const changes = changed ? ' + uncommitted changes' : '';
    return { name, commit, label: `working tree (${commit.slice(0, 7)}${changes})` };
  }
  let commit;
  try {
    if (ref.startsWith('-')) throw new Error();
    commit = git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], repo);
  } catch {
    throw new UsageError(`--${name} ${ref}: no such branch, tag or commit.`);
  }
  return { name, ref, commit, label: `${ref} (${commit.slice(0, 7)})` };
}

// Captures hold real billing data: never where git could pick them up, nor in the snapshot.
// Returns the directory and the first directory the script had to create, if any.
function outputDirectory({ out, data }) {
  if (!out) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ocm-dashboard-comparison-'));
    return { dir, created: dir };
  }
  // Through the symbolic links, to where the files will really be written
  const dir = realPath(expandHome(out));
  const relative = path.relative(realPath(data), dir);
  if (!relative.startsWith('..') && !path.isAbsolute(relative)) {
    throw new UsageError(`--out ${out} is in the snapshot directory, which is never written to.`);
  }
  // In the work tree of any repository, another checkout of this one included, only where
  // git ignores it
  let workTree = null;
  try {
    workTree = git(['rev-parse', '--show-toplevel'], nearestExisting(dir));
  } catch {
    // Not in a work tree
  }
  if (workTree !== null && !ignoredByGit(workTree, dir)) {
    throw new UsageError(`--out ${out} is in the work tree ${workTree} and git does not ignore it: `
      + 'the captures hold real billing data, pick a directory outside any repository.');
  }
  return { dir, created: fs.mkdirSync(dir, { recursive: true }) };
}

function nearestExisting(target) {
  let existing = path.resolve(target);
  while (!fs.existsSync(existing)) existing = path.dirname(existing);
  return existing;
}

// The path with the symbolic links of its existing part resolved
function realPath(target) {
  const absolute = path.resolve(target);
  const existing = nearestExisting(absolute);
  return path.join(fs.realpathSync(existing), path.relative(existing, absolute));
}

function ignoredByGit(workTree, target) {
  try {
    git(['check-ignore', '--quiet', target], workTree);
    return true;
  } catch {
    return false;
  }
}

// What the snapshot holds, and what the real date does to the comparison: the browser's
// clock is frozen, the server's is not
function describeSnapshot(snapshot, clock, now) {
  const { lastImport, emptyTables, latestBill } = snapshot;
  const realDate = now.toISOString().slice(0, 10);
  const warnings = [];
  if (lastImport?.status === 'running') {
    warnings.push('the last import has not ended: it is still running, or it stopped halfway, and '
      + 'the snapshot may lack data');
  }
  if (lastImport?.status === 'failed' || lastImport?.status === 'partial') {
    warnings.push(`the last import ${lastImport.status === 'failed' ? 'failed' : 'was partial'}`
      + `${lastImport.error_message ? `: ${lastImport.error_message}` : ''}`);
  }
  if (realDate.slice(0, 7) !== latestBill.slice(0, 7)) {
    // SQLite's date('now') for the Trends months, JavaScript's for the services to expire
    warnings.push(`the latest bill is from ${latestBill.slice(0, 7)} but the real month is `
      + `${realDate.slice(0, 7)}: the server takes the months of the Trends tab and the services `
      + 'about to expire from the real date, so the Trends tab shows fewer months of the snapshot '
      + 'as time passes');
  }
  const empty = Object.entries(emptyTables)
    .map(([dataset, tables]) => `${dataset} (${tables.join(', ')})`);
  return {
    lastImport: lastImport
      ? `${lastImport.type} import, ${lastImport.status}, started ${lastImport.started_at} UTC`
        + (lastImport.completed_at ? `, ended ${lastImport.completed_at} UTC` : '')
      : 'none recorded',
    empty: empty.join('; ') || 'no dataset',
    realDate,
    warnings,
    stored: {
      bills: snapshot.bills,
      latestBill,
      lastImport,
      emptyTables,
      clock: clock.toISOString(),
      realDate,
      warnings,
    },
  };
}

// Noon UTC: the same calendar day from UTC-11 to UTC+11
function resolveClock(option, latestBill) {
  const value = option ?? latestBill;
  const clock = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00Z` : value);
  if (Number.isNaN(clock.getTime())) throw new UsageError(`--clock ${option}: not a date.`);
  return clock;
}

function resolveMonths(option, available) {
  // The dashboard opens on its latest month
  const openingMonth = available[0];
  const [year, month] = openingMonth.split('-');
  const yearBefore = `${Number(year) - 1}-${month}`;
  const requested = option
    ? option.split(',').map((item) => item.trim()).filter(Boolean)
      .map((item) => (item === 'default' ? openingMonth : item))
    // A year earlier, or the closest older month with bills, or the oldest one
    : [openingMonth, available.find((m) => m <= yearBefore) ?? available.at(-1)];
  for (const item of requested) {
    if (!/^\d{4}-\d{2}$/.test(item)) {
      throw new UsageError(`--months: ${item} is neither "default" nor YYYY-MM.`);
    }
    if (!available.includes(item)) {
      throw new UsageError(`--months: no bill in ${item}, the snapshot has bills from `
        + `${available.at(-1)} to ${available[0]}.`);
    }
  }
  return { months: [...new Set(requested)], openingMonth };
}

async function prepare(side, { repo, work, logs }) {
  const log = path.join(logs, `${side.name}.log`);
  fs.writeFileSync(log, '');
  const step = async (label, action) => {
    const start = Date.now();
    await action();
    console.log(`[${side.name}] ${label} (${duration(Date.now() - start)})`);
  };
  if (side.ref) {
    side.dir = path.join(work, side.name);
    await step('worktree and npm ci',
      () => createWorktree({ repo, dir: side.dir, commit: side.commit, log, defer }));
  } else {
    side.dir = repo;
  }
  await step('native binaries', () => ensureNativeBinaries(side.dir, log));
  await step('build', () => build(side.dir, log));
}

// The page shows the budget of the config.json its server reads. A temporary worktree has
// none; when the working tree has one, the worktrees get a link to it.
function shareSettings(sides, repo) {
  const settings = path.join(repo, 'config.json');
  if (sides.every((side) => side.ref) || !fs.existsSync(settings)) return;
  for (const side of sides.filter((s) => s.ref)) {
    fs.symlinkSync(settings, path.join(side.dir, 'config.json'));
  }
  console.log(`Both servers read ${settings}.`);
}

function duration(ms) {
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  const seconds = Math.round(ms / 1000);
  return `${Math.floor(seconds / 60)} min ${seconds % 60} s`;
}

for (const [signal, code] of [['SIGINT', 130], ['SIGTERM', 143], ['SIGHUP', 129]]) {
  process.on(signal, () => {
    if (interrupted) return;
    interrupted = code;
    console.error(`\n${signal}: stopping and cleaning up…`);
    cleanup().finally(() => process.exit(code));
  });
}
process.on('uncaughtException', (error) => stop(error));

main(process.argv.slice(2)).then(finish, stop);
