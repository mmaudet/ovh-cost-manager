/**
 * Tests for the import that scripts/cron-import.sh runs when the container
 * starts. The script used to count the months listed by the API: with
 * authentication on, the API answered 401, which read as an empty database,
 * and a full import cleared the database at every start. It now counts the
 * bills in the database with data/count-bills.js, and a count that failed
 * never leads to a full import.
 */

const path = require('path');
const { spawnSync } = require('child_process');

const cronScript = path.join(__dirname, '..', 'scripts', 'cron-import.sh');

// Source the script for its functions and call first_import, with stand-ins
// for node and wget: data/count-bills.js prints `output` and exits with
// `status`, an import only prints its command line, and no server answers.
function firstImport(output, status = 0) {
  const shell = `
    node() {
      case "$1" in
        */count-bills.js) printf '%s' "$COUNT_OUTPUT"; return "$COUNT_STATUS" ;;
        *) echo "node $*" ;;
      esac
    }
    wget() { return 1; }
    . "$CRON_SCRIPT"
    first_import
  `;
  return spawnSync('sh', ['-c', shell], {
    env: {
      ...process.env,
      CRON_SCRIPT: cronScript,
      CRON_IMPORT_SOURCED: '1',
      IMPORT_FLAGS: '--all',
      COUNT_OUTPUT: output,
      COUNT_STATUS: String(status),
    },
    encoding: 'utf8',
    // Run instead of sourced, the script would wait for the server forever
    timeout: 10000,
  });
}

describe('first import of scripts/cron-import.sh', () => {
  test('is a full import when the database has no bill', () => {
    const result = firstImport('0\n');
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('node /app/data/import.js --full --all');
    expect(result.stdout).not.toContain('import.js --diff');
  });

  test('is skipped when the database has bills', () => {
    const result = firstImport('42\n');
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Existing data found (42 bills)');
    expect(result.stdout).not.toContain('import.js');
  });

  // A full import clears the database, including snapshots that the OVH API
  // cannot return again: it never follows a count that failed
  test.each([
    ['fails', '', 1],
    ['prints a count but fails', '0\n', 1],
    ['prints nothing', '', 0],
    ['prints something else than a count', 'SqliteError: database is locked\n', 0],
  ])('is a differential import when the count %s', (_, output, status) => {
    const result = firstImport(output, status);
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/could not count the bills/i);
    expect(result.stdout).toContain('node /app/data/import.js --diff --all');
    expect(result.stdout).not.toContain('import.js --full');
  });
});
