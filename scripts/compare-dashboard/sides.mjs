// The two sides of the comparison: the code of each one (a temporary git worktree, or the
// working tree), built, and served on its own copy of the snapshot.

import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import net from 'node:net';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { waitFor } from './wait.mjs';

export const DB_FILE = 'ovh-bills.db';

// Child processes still running, stopped on cleanup; none starts once it has begun
const running = new Set();
let stopping = false;

function checkNotStopping(command) {
  if (stopping) throw new Error(`${command} not started: the comparison is stopping`);
}

// npm, npx and the servers run on the Node.js that runs this script
const childEnvironment = () => ({
  ...process.env,
  PATH: [path.dirname(process.execPath), process.env.PATH].join(path.delimiter),
});

export function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

/** Starts a child process whose output goes to `log`, stopped on cleanup if still running. */
function spawnLogged(command, args, { cwd, env = childEnvironment(), log, truncate = false }) {
  checkNotStopping(command);
  const output = fs.openSync(log, truncate ? 'w' : 'a');
  const child = spawn(command, args, { cwd, env, stdio: ['ignore', output, output] });
  fs.closeSync(output);
  running.add(child);
  child.on('error', () => running.delete(child));
  child.on('exit', () => running.delete(child));
  return child;
}

/** Runs a command whose output goes to a log file; the error quotes the end of the log. */
function run(command, args, { cwd, log }) {
  return new Promise((resolve, reject) => {
    fs.appendFileSync(log, `\n$ ${command} ${args.join(' ')}   (in ${cwd})\n`);
    const child = spawnLogged(command, args, { cwd, log });
    child.on('error', (error) => reject(new Error(`${command} could not start: ${error.message}`)));
    child.on('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(' ')} failed (${signal ?? `exit code ${code}`}), `
        + `end of ${log}:\n${tail(log)}`));
    });
  });
}

const tail = (file, lines = 15) => fs.readFileSync(file, 'utf8').trimEnd().split('\n').slice(-lines).join('\n');

/** Stops the commands still running, as on an interruption, and any later one. */
export async function stopChildren() {
  stopping = true;
  await Promise.all([...running].map(stopProcess));
}

async function stopProcess(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise((resolve) => child.once('exit', resolve));
  child.kill('SIGTERM');
  const timeout = sleep(5000).then(() => 'timeout');
  if ((await Promise.race([exited, timeout])) === 'timeout') {
    child.kill('SIGKILL');
    await exited;
  }
}

// The datasets an import adds to the bills (import.js --all), shown by the page
const DATASETS = {
  inventory: ['dedicated_servers', 'vps_instances', 'storage_services'],
  'cloud details': ['cloud_instances', 'cloud_volumes', 'cloud_snapshots', 'object_storage_buckets',
    'project_quotas', 'project_consumption'],
  consumption: ['consumption_snapshots', 'consumption_history'],
};

/**
 * Freezes the snapshot: copies its database into `destination`, never writing to it.
 * @returns {{ bills: number, latestBill: string, months: string[], lastImport: object|null,
 *   emptyTables: Record<string, string[]> }} months newest first, and the tables of each
 *   dataset that hold nothing
 */
export async function freezeSnapshot(dataDir, destination, Database) {
  const source = path.join(dataDir, DB_FILE);
  if (!fs.existsSync(source)) throw new Error(`${source} not found: --data takes a data directory holding ${DB_FILE}`);
  const journal = `${source}-wal`;
  if (fs.existsSync(`${source}-shm`) && fs.existsSync(journal)) {
    // An open connection keeps a -shm index next to its -wal journal: an import may be
    // writing. SQLite's backup API reads a consistent state through a read-only connection,
    // which takes its read lock in the -shm index like any reader: in this case only, the
    // snapshot's -shm file is updated, never its data. Should the import close at that very
    // moment, SQLite may leave empty -wal and -shm files behind.
    const snapshot = new Database(source, { readonly: true, fileMustExist: true });
    try {
      await snapshot.backup(destination);
    } finally {
      snapshot.close();
    }
  } else {
    // No -shm index: nothing has the database open. Opening it, even read-only, would create
    // or rewrite the -shm and -wal files; plain copies of the database and of its journal
    // leave the directory untouched, and opening the copies reads the journal back.
    fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
    if (fs.existsSync(journal)) fs.copyFileSync(journal, `${destination}-wal`, fs.constants.COPYFILE_EXCL);
  }
  // Read-write on purpose: closing the copy folds its journal back into the file
  const copy = new Database(destination);
  try {
    const check = copy.pragma('quick_check', { simple: true });
    if (check !== 'ok') throw new Error(`the copy of ${source} is damaged: ${check}`);
    const { bills, latest } = copy.prepare('SELECT COUNT(*) AS bills, MAX(date) AS latest FROM bills').get();
    if (!bills) throw new Error(`${source} holds no bill`);
    // The same list as the dashboard's month selector (GET /api/months)
    const months = copy.prepare(`SELECT DISTINCT strftime('%Y-%m', date) AS month FROM bills ORDER BY month DESC`)
      .all()
      .map((row) => row.month);
    const lastImport = copy.prepare(`SELECT type, status, started_at, completed_at, error_message
      FROM import_log ORDER BY id DESC LIMIT 1`).get() ?? null;
    const holdsRows = (table) => {
      try {
        return copy.prepare(`SELECT 1 FROM ${table} LIMIT 1`).get() !== undefined;
      } catch {
        return false; // A table an older schema does not have yet
      }
    };
    const emptyTables = Object.fromEntries(Object.entries(DATASETS)
      .map(([dataset, tables]) => [dataset, tables.filter((table) => !holdsRows(table))])
      .filter(([, tables]) => tables.length));
    return { bills, latestBill: String(latest).slice(0, 10), months, lastImport, emptyTables };
  } finally {
    copy.close();
  }
}

/** better-sqlite3 as the data layer of `dir` loads it. */
export function loadBetterSqlite(dir) {
  return createRequire(path.join(dir, 'data', 'package.json'))('better-sqlite3');
}

/**
 * Makes sure the native parts of the dependencies work: npm may have been told not to run
 * install scripts, which leaves better-sqlite3 without its binary and esbuild unchecked.
 */
export async function ensureNativeBinaries(dir, log, { esbuild = true } = {}) {
  if (!(await betterSqliteLoads(dir))) {
    const pkg = path.dirname(createRequire(path.join(dir, 'server', 'package.json')).resolve('better-sqlite3/package.json'));
    await run('npx', ['--yes', 'prebuild-install'], { cwd: pkg, log });
    if (!(await betterSqliteLoads(dir))) throw new Error(`better-sqlite3 has no working binary in ${pkg}, see ${log}`);
  }
  if (esbuild) {
    // Vite's bundler: its install script checks its platform binary and sets it up
    const vite = createRequire(path.join(dir, 'dashboard', 'package.json')).resolve('vite/package.json');
    const pkg = path.dirname(createRequire(vite).resolve('esbuild/package.json'));
    await run(process.execPath, ['install.js'], { cwd: pkg, log });
  }
}

// In a child process: a missing binary throws on first use, and would stay cached here
function betterSqliteLoads(dir) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['-e', "new (require('better-sqlite3'))(':memory:').close()"], {
      cwd: path.join(dir, 'server'),
      stdio: 'ignore',
    });
    child.on('error', () => resolve(false));
    child.on('exit', (code) => resolve(code === 0));
  });
}

/**
 * Checks out a commit into a temporary worktree and installs its dependencies.
 * @param {(cleanup: () => Promise<void>) => void} defer  registers a cleanup step
 */
export async function createWorktree({ repo, dir, commit, log, defer }) {
  defer(() => removeWorktree(repo, dir));
  await run('git', ['worktree', 'add', '--detach', dir, commit], { cwd: repo, log });
  await run('npm', ['ci', '--no-audit', '--no-fund'], { cwd: dir, log });
}

async function removeWorktree(repo, dir) {
  if (!fs.existsSync(dir)) return;
  try {
    git(['worktree', 'remove', '--force', dir], repo);
  } catch (error) {
    fs.rmSync(dir, { recursive: true, force: true });
    throw new Error(`git worktree remove ${dir} failed (${error.message.trim()}): `
      + 'its files are deleted, run `git worktree prune` to forget it');
  }
}

export function build(dir, log) {
  return run('npm', ['run', 'build'], { cwd: dir, log });
}

// What the server reads from its environment that could change the page or start an
// import: dropped, then set for a local, read-only run
const SERVER_VARIABLES = /^(PORT|DATA_DIR|NODE_ENV|AUTH_REQUIRED|SESSION_SECRET|ALLOWED_ORIGINS|TRUST_PROXY|OIDC_\w+|RATE_LIMIT_\w+|IMPORT_\w+)$/;

/**
 * Serves the built dashboard of `dir` on the database of `dataDir`.
 * @returns {Promise<string>} its URL, once it answers
 */
export async function startServer({ dir, dataDir, log, defer }) {
  const port = await freePort();
  const environment = Object.fromEntries(Object.entries(childEnvironment()).filter(([name]) => !SERVER_VARIABLES.test(name)));
  Object.assign(environment, {
    PORT: String(port),
    DATA_DIR: dataDir,
    // No resync from the page: nothing may call the OVH API
    IMPORT_ENABLED: 'false',
    AUTH_REQUIRED: 'false',
    // The walk through the page makes more API calls than the default limit allows
    RATE_LIMIT_ENABLED: 'false',
  });
  const server = spawnLogged(process.execPath, ['server/index.js'], {
    cwd: dir,
    env: environment,
    log,
    truncate: true,
  });
  defer(() => stopProcess(server));

  const url = `http://127.0.0.1:${port}`;
  await waitFor(async () => {
    if (server.exitCode !== null) {
      throw new Error(`the server stopped (exit code ${server.exitCode}), end of ${log}:\n${tail(log)}`);
    }
    try {
      return (await fetch(`${url}/api/health`)).ok;
    } catch {
      return false; // Not listening yet
    }
  }, {
    timeoutMs: 60_000,
    intervalMs: 200,
    failure: () => `the server did not answer within 60 s, end of ${log}:\n${tail(log)}`,
  });
  if ((await fetch(`${url}/api/config`)).status === 401) {
    throw new Error('the server asks for a login: the comparison needs OIDC turned off in the config.json it reads');
  }
  return url;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}
