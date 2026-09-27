/**
 * The options of data/import.js as the command line gives them (#113): the script runs in a
 * child process, with a throwaway HOME and DATA_DIR, and the OVH API client disabled, so that
 * nothing can reach the real API.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const IMPORT = path.join(__dirname, '..', 'data', 'import.js');
const NO_OVH_API = path.join(__dirname, 'fixtures', 'no-ovh-api.js');

let home;

beforeAll(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'ocm-import-command-'));
});

afterAll(() => {
  fs.rmSync(home, { recursive: true, force: true });
});

// Runs the script with these arguments, as `node data/import.js ...`
function runImportCommand(...args) {
  return spawnSync(process.execPath, ['--require', NO_OVH_API, IMPORT, ...args], {
    env: { PATH: process.env.PATH, HOME: home, DATA_DIR: home },
    encoding: 'utf8',
  });
}

// Clearing a single account's data comes with #114
test.each([
  [['--full', '--account', 'xx1111-ovh']],
  [['--account', 'xx1111-ovh', '--full']],
])('refuses --full with --account, saying why: %j', (args) => {
  const result = runImportCommand(...args);

  expect(result.status).toBe(1);
  expect(result.stderr).toBe('Error: --full clears every account, so it cannot be limited to '
    + 'one with --account yet: run --full alone, or --account with --diff or --from\n');
  expect(result.stdout).toBe('');
});

test('refuses --account without a NIC handle', () => {
  const result = runImportCommand('--diff', '--account', '--all');

  expect(result.status).toBe(1);
  expect(result.stderr).toBe('Error: --account needs the NIC handle of the account to import\n');
});
