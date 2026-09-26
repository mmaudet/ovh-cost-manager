/**
 * Tests for the import that the container runs at start, which
 * scripts/import-decision.sh decides for scripts/cron-import.sh. The cron used
 * to count the months listed by the API: with authentication on, the API
 * answered 401, which read as an empty database, and a full import cleared it
 * at every start. It now counts the bills in the database with
 * data/count-bills.js, and a count that failed never leads to a full import.
 */

const path = require('path');
const { spawnSync } = require('child_process');

const decisionScript = path.join(__dirname, '..', 'scripts', 'import-decision.sh');

// What first_import_mode prints, run by sh as the image runs it, for the exit
// status and the output of data/count-bills.js
function firstImportMode(status, output) {
  const shell = '. "$1" && first_import_mode "$2" "$3"';
  const result = spawnSync('sh', ['-c', shell, 'sh', decisionScript, String(status), output], {
    encoding: 'utf8',
  });
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
  return result.stdout;
}

describe('first_import_mode of scripts/import-decision.sh', () => {
  test('is full when the count succeeds and finds no bill', () => {
    expect(firstImportMode(0, '0')).toBe('full\n');
  });

  test('is none when the count finds bills', () => {
    expect(firstImportMode(0, '42')).toBe('none\n');
  });

  // A full import clears the database, including snapshots that the OVH API
  // cannot return again: it never follows a count that failed
  test.each([
    ['fails', 1, ''],
    ['prints a count but fails', 1, '0'],
    ['prints nothing', 0, ''],
    ['prints something else than a count', 0, 'SqliteError: database is locked'],
    ['prints a count after another line', 0, 'Some warning\n0'],
  ])('is diff when the count %s', (_, status, output) => {
    expect(firstImportMode(status, output)).toBe('diff\n');
  });
});

// Whether the cron imports at all, from IMPORT_ENABLED, as the server reads it
// (server/imports.js): with FALSE, the cron imported while the server said no
describe('imports_enabled of scripts/import-decision.sh', () => {
  function importsEnabled(value) {
    const shell = '. "$1" && imports_enabled "$2"';
    return spawnSync('sh', ['-c', shell, 'sh', decisionScript, value], { encoding: 'utf8' });
  }

  test.each([
    ['true', 'true'],
    ['TRUE', 'true'],
    ['', 'true'],
    ['false', 'false'],
    ['FALSE', 'false'],
    ['False', 'false'],
  ])('reads IMPORT_ENABLED=%p as %s', (value, expected) => {
    const result = importsEnabled(value);
    expect(result.stdout).toBe(`${expected}\n`);
    expect(result.status).toBe(0);
  });

  test.each(['0', 'no', 'off'])('fails with IMPORT_ENABLED=%s, as the server does', (value) => {
    const result = importsEnabled(value);
    expect(result.stdout).toBe('');
    expect(result.status).not.toBe(0);
  });
});
