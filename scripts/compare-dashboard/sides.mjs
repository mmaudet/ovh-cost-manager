// The two sides of the comparison: the code of each one (a temporary git worktree, or the
// working tree), built, and served on its own copy of the snapshot.

import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import net from 'node:net';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

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

/** Runs a command whose output goes to a log file; the error quotes the end of the log. */
function run(command, args, { cwd, log }) {
  return new Promise((resolve, reject) => {
    checkNotStopping(command);
    fs.appendFileSync(log, `\n$ ${command} ${args.join(' ')}   (in ${cwd})\n`);
    const output = fs.openSync(log, 'a');
    const child = spawn(command, args, { cwd, env: childEnvironment(), stdio: ['ignore', output, output] });
    fs.closeSync(output);
    running.add(child);
    child.on('error', (error) => {
      running.delete(child);
      reject(new Error(`${command} could not start: ${error.message}`));
    });
    child.on('exit', (code, signal) => {
      running.delete(child);
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

/**
 * Freezes the snapshot: copies its database into `destination`, never writing to it.
 * @returns {{ bills: number, latestBill: string, months: string[] }} months newest first
 */
export async function freezeSnapshot(dataDir, destination, Database) {
  const source = path.join(dataDir, DB_FILE);
  if (!fs.existsSync(source)) throw new Error(`${source} not found: --data takes a data directory holding ${DB_FILE}`);
  if (fs.existsSync(`${source}-wal`)) {
    // Something may be writing to it (an import): SQLite's backup API copies a consistent
    // state. The connection is read-only, and the -wal and -shm files it needs exist already.
    const snapshot = new Database(source, { readonly: true, fileMustExist: true });
    try {
      await snapshot.backup(destination);
    } finally {
      snapshot.close();
    }
  } else {
    // No -wal file: nothing has the database open. Opening it, even read-only, would create
    // the -wal and -shm files next to it, while a plain copy leaves the directory untouched.
    fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
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
    return { bills, latestBill: String(latest).slice(0, 10), months };
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
  checkNotStopping('the server');
  const output = fs.openSync(log, 'w');
  const server = spawn(process.execPath, ['server/index.js'], { cwd: dir, env: environment, stdio: ['ignore', output, output] });
  fs.closeSync(output);
  running.add(server);
  server.on('exit', () => running.delete(server));
  defer(() => stopProcess(server));

  const url = `http://127.0.0.1:${port}`;
  const start = Date.now();
  for (;;) {
    if (server.exitCode !== null) throw new Error(`the server stopped (exit code ${server.exitCode}), end of ${log}:\n${tail(log)}`);
    try {
      if ((await fetch(`${url}/api/health`)).ok) break;
    } catch {
      // Not listening yet
    }
    if (Date.now() - start > 60_000) throw new Error(`the server did not answer within 60 s, end of ${log}:\n${tail(log)}`);
    await sleep(200);
  }
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
