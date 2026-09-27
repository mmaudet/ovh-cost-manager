/**
 * Tests for the "an import is in progress" rule (importLog.isRunning),
 * shared by the manual resync route and data/import.js
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync, spawnSync } = require('child_process');

let db;
let dataDir;

beforeAll(() => {
  // data/db.js reads DATA_DIR when loaded: point it at a throwaway database
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ovh-import-running-'));
  process.env.DATA_DIR = dataDir;
  db = require('../data/db');
});

beforeEach(() => {
  db.getDb().exec('DELETE FROM import_log');
});

afterAll(() => {
  db.closeDb();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

// Record an import still marked 'running' that started `minutes` ago, in UTC
// like the CURRENT_TIMESTAMP written by importLog.start()
function startImportMinutesAgo(minutes) {
  db.getDb().prepare(`
    INSERT INTO import_log (started_at, type, status)
    VALUES (datetime('now', ?), 'differential', 'running')
  `).run(`-${minutes} minutes`);
}

// isRunning() as seen by a process running in `timezone`. A child process is
// needed: Jest ignores TZ changes made at runtime.
function isRunningInTimezone(timezone) {
  const dbModule = path.join(__dirname, '..', 'data', 'db.js');
  const script = `process.stdout.write(String(require(${JSON.stringify(dbModule)}).importLog.isRunning()))`;
  const output = execFileSync(process.execPath, ['-e', script], {
    env: { ...process.env, DATA_DIR: dataDir, TZ: timezone },
    encoding: 'utf8'
  });
  return output === 'true';
}

describe('importLog.isRunning', () => {
  test('is false when no import was ever recorded', () => {
    expect(db.importLog.isRunning()).toBe(false);
  });

  test('is true for an import that has just started', () => {
    db.importLog.start('differential', null, null);
    expect(db.importLog.isRunning()).toBe(true);
  });

  test('is false once the import has completed', () => {
    const id = db.importLog.start('differential', null, null);
    db.importLog.complete(id, { bills: 2, details: 5, projects: 1 });
    expect(db.importLog.isRunning()).toBe(false);
  });

  test('is false for a run started more than 30 minutes ago (crashed)', () => {
    startImportMinutesAgo(31);
    expect(db.importLog.isRunning()).toBe(false);
  });

  test('is true for a run started less than 30 minutes ago', () => {
    startImportMinutesAgo(29);
    expect(db.importLog.isRunning()).toBe(true);
  });

  // A run over several accounts, or over an account's whole history, can take longer than
  // 30 minutes: it keeps its lock as it goes (#113)
  test('is true for a run started more than 30 minutes ago that showed it is alive since', () => {
    startImportMinutesAgo(45);
    db.importLog.heartbeat(db.importLog.getLatest().id);
    expect(db.importLog.isRunning()).toBe(true);
  });

  test('is false for a run that last showed it is alive more than 30 minutes ago', () => {
    startImportMinutesAgo(90);
    const { id } = db.importLog.getLatest();
    db.importLog.heartbeat(id);
    db.getDb().prepare(`
      UPDATE import_log SET heartbeat_at = datetime('now', '-31 minutes') WHERE id = ?
    `).run(id);
    expect(db.importLog.isRunning()).toBe(false);
  });

  test('only looks at the latest import', () => {
    startImportMinutesAgo(5);
    const id = db.importLog.start('differential', null, null);
    db.importLog.complete(id, { bills: 0, details: 0, projects: 1 });
    expect(db.importLog.isRunning()).toBe(false);
  });

  // Reading started_at as local time makes a fresh import look two hours old
  // in Paris, and a crashed one look recent west of UTC
  describe.each(['Europe/Paris', 'America/New_York'])('in the %s timezone', (timezone) => {
    test('is true for an import that has just started', () => {
      db.importLog.start('differential', null, null);
      expect(isRunningInTimezone(timezone)).toBe(true);
    });

    test('is false for a run started more than 30 minutes ago (crashed)', () => {
      startImportMinutesAgo(31);
      expect(isRunningInTimezone(timezone)).toBe(false);
    });
  });
});

describe('data/import.js', () => {
  const importScript = path.join(__dirname, '..', 'data', 'import.js');
  const noOvhApi = path.join(__dirname, 'fixtures', 'no-ovh-api.js');
  const skipMessage = /already running/i;

  // Run a differential import the way the cron does. HOME points to the
  // throwaway directory, so no OVH credentials can be found there either.
  function runImport() {
    return spawnSync(process.execPath, ['--require', noOvhApi, importScript, '--diff', '--all'], {
      env: { ...process.env, DATA_DIR: dataDir, HOME: dataDir },
      encoding: 'utf8'
    });
  }

  test('skips the run when another import is in progress', () => {
    const runningId = db.importLog.start('differential', null, null);
    const result = runImport();
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(skipMessage);
    expect(db.importLog.getLatest().id).toBe(runningId);
  });

  test('does not skip the run when no import is in progress', () => {
    const result = runImport();
    expect(result.stdout).not.toMatch(skipMessage);
  });
});
