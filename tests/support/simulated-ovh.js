/**
 * A simulated OVH API and a throwaway database, for the tests of data/import.js. A test
 * file hands the simulated client to the import through its jest.mock factories, which
 * require this module:
 *
 *   jest.mock('ovh', () => require('./support/simulated-ovh').ovh);
 *   jest.mock('jsonfile', () => require('./support/simulated-ovh').jsonfile);
 *
 * then calls useThrowawayImport() once, and serves the routes of each test.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

// The routes served: route -> handler returning a promise. Unknown routes answer 404, like
// the real API does.
const routes = new Map();

// What require('ovh') returns: a function of the credentials, which returns the client
const ovh = () => ({
  requestPromised: (method, route) => {
    const handler = routes.get(route);
    return handler ? handler() : Promise.reject({ error: 404, message: `Not found: ${route}` });
  },
});

// Never read the real credentials of the machine running the tests
const jsonfile = {
  readFileSync: () => ({ appKey: 'test', appSecret: 'test', consumerKey: 'test' }),
};

// Handlers: an answer, or an error as the ovh client rejects with it
const ok = (value) => () => Promise.resolve(value);
const fail = (error, message) => () => Promise.reject({ error, message });

// Every table emptied, those that a full import keeps included
function emptyDatabase(db) {
  const database = db.getDb();
  const tables = database.prepare(`
    SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
  `).all();
  // Rows reference each other: none is checked until all are gone
  database.pragma('foreign_keys = OFF');
  for (const { name } of tables) database.exec(`DELETE FROM ${name}`);
  database.pragma('foreign_keys = ON');
}

/**
 * Loads data/db.js and data/import.js on a throwaway database for the tests of the calling
 * file. Each test starts with no route served, an empty database, a silent console, and
 * fake timers, on which the retry delays cost no real time.
 * @param {string} prefix - The prefix of the throwaway directory
 * @returns {{db: object, importer: object}} Both set before the first test runs
 */
function useThrowawayImport(prefix) {
  const loaded = {};
  const previousDataDir = process.env.DATA_DIR;
  let dataDir;

  beforeAll(() => {
    // data/db.js reads DATA_DIR once, when it is first required
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    process.env.DATA_DIR = dataDir;
    loaded.db = require('../../data/db');
    loaded.importer = require('../../data/import');
  });

  afterAll(() => {
    loaded.db.closeDb();
    fs.rmSync(dataDir, { recursive: true, force: true });
    if (previousDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = previousDataDir;
  });

  beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    routes.clear();
    emptyDatabase(loaded.db);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  return loaded;
}

module.exports = { ovh, jsonfile, routes, ok, fail, useThrowawayImport };
