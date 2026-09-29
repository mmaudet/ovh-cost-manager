/**
 * A simulated OVH API and a throwaway database, for the tests of data/import.js. A test
 * file hands the simulated client, and the configuration files, to the import through its
 * jest.mock factories, which require this module:
 *
 *   jest.mock('ovh', () => require('./support/simulated-ovh').ovh);
 *   jest.mock('jsonfile', () => require('./support/simulated-ovh').jsonfile);
 *
 * then calls useThrowawayImport() once, and serves the routes of each test.
 *
 * The API serves several accounts, told apart by the credentials that each client is
 * created with, as the real API tells them apart by their keys: the account of the tests
 * (ACCOUNT, in ./accounts.js), whose credentials the configuration gives by default and
 * whose routes are `routes`, and those that serveAccount() adds.
 */

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ACCOUNT } = require('./accounts');

// The credentials of the account of the tests, which the configuration gives by default: as
// before #113, without an endpoint, which the OVH client does without
const CREDENTIALS = { appKey: 'test', appSecret: 'test', consumerKey: 'test' };

// The routes of the account of the tests: route -> handler of the call's parameters,
// returning a promise. Unknown routes answer 404, like the real API does.
const routes = new Map();

// Every account served, by the consumer key of its credentials: its credentials and its
// routes
const accounts = new Map();

// The calls that the clients made, in order: the consumer key of the client, the method, the
// route and the parameters
const calls = [];

// The credentials that each client was created with, in order
const clientCredentials = [];

// Whether a client's credentials are those of the account served: every one it was served
// with, whatever else they hold, such as an endpoint or a host
const sameCredentials = (credentials, served) =>
  Object.keys(served).every(key => credentials?.[key] === served[key]);

// An answer of 202 Accepted, as the carbon calculator gives to the request of a file (#179)
class Accepted {
  constructor(value) {
    this.value = value;
  }
}

// The API's address, as the ovh client calls it without an endpoint or with ovh-eu
const API_HOST = 'eu.api.ovh.com';
const API_BASE_PATH = '/1.0';

// The signature of a call, as the ovh client signs it (its signRequest())
const signatureOf = ({ appSecret, consumerKey }, method, url, body, timestamp) => '$1$'
  + crypto.createHash('sha1')
    .update([appSecret, consumerKey, method, url, body || '', timestamp].join('+'))
    .digest('hex');

// What require('ovh') returns: a function of the credentials, which returns the client, with
// the fields and the signature of the real one. The calls of a client whose credentials are
// none of an account served get OVH's answer to an invalid key. As the real client, it takes
// every answer but one of 200 for an error: a 202 rejects with its status and the answer's
// message, and loses the rest of the answer.
const ovh = (credentials) => {
  clientCredentials.push(credentials);
  return {
    appKey: credentials?.appKey,
    appSecret: credentials?.appSecret,
    consumerKey: credentials?.consumerKey ?? null,
    host: API_HOST,
    port: 443,
    basePath: API_BASE_PATH,
    // Measured at the first call by the real client: the simulated API's clock is the tests'
    apiTimeDiff: 0,
    signRequest: (method, url, body, timestamp) =>
      signatureOf(credentials, method, url, body, timestamp),
    requestPromised: (method, route, params) => {
      calls.push({ consumerKey: credentials?.consumerKey, method, route, params });
      const served = accounts.get(credentials?.consumerKey);
      if (!served || !sameCredentials(credentials, served.credentials)) {
        return Promise.reject({ error: 403, message: 'This credential is not valid' });
      }
      const handler = served.routes.get(route);
      if (!handler) return Promise.reject({ error: 404, message: `Not found: ${route}` });
      return handler(params).then((answer) => (answer instanceof Accepted
        ? Promise.reject({ error: 202, message: answer.value?.message })
        : answer));
    },
  };
};

// The client of the account of the tests, as the import creates it from the configuration by
// default: for the tests that run a phase of the import on its own
const client = ovh(CREDENTIALS);

// The places where the import reads its configuration, in the order it reads them: the
// config.json of the repository, then those of ~/my-ovh-bills, the legacy one last
const CONFIG_FILES = {
  project: path.resolve(__dirname, '..', '..', 'config.json'),
  home: path.join(os.homedir(), 'my-ovh-bills', 'config.json'),
  legacy: path.join(os.homedir(), 'my-ovh-bills', 'credentials.json'),
};

// The configuration files that exist, by path: their content, or the error that reading them
// throws. Never the real ones of the machine running the tests.
const configFiles = new Map();

const jsonfile = {
  readFileSync: (file) => {
    if (!configFiles.has(file)) {
      throw Object.assign(new Error(`ENOENT: no such file or directory, open '${file}'`),
        { code: 'ENOENT' });
    }
    const content = configFiles.get(file);
    if (content instanceof Error) throw content;
    // A copy, which the import may change as it likes
    return structuredClone(content);
  },
};

/**
 * Makes this the only configuration file.
 * @param {object|Error} content - Its content, or the error that reading it throws
 * @param {string} [place] - Where it is, a key of CONFIG_FILES: the config.json of the
 *   repository by default
 */
function useConfig(content, place = 'project') {
  useConfigFiles({ [place]: content });
}

/**
 * Makes these the only configuration files.
 * @param {Object<string, object|Error>} contents - The content of each file, or the error
 *   that reading it throws, by its place, a key of CONFIG_FILES
 */
function useConfigFiles(contents) {
  configFiles.clear();
  for (const [place, content] of Object.entries(contents)) {
    configFiles.set(CONFIG_FILES[place], content);
  }
}

// The configuration by default: the credentials of the account of the tests alone, in the
// legacy flat form, as before #113. From the start, for what reads it as it loads.
const useDefaultConfig = () => useConfig({ ...CREDENTIALS });
useDefaultConfig();

// The files that the API's links lead to, by link: the carbon footprint that the carbon
// calculator generates (#147), which the import downloads from the link of its task, with no
// OVH authentication. Their content, or the error that downloading them rejects with.
const files = new Map();

// An answer of fetch(), of a status and a body
const fetched = (status, text) => ({ ok: status >= 200 && status < 300, status, text: async () => text });

// What a call to the API that the import signs itself, with the keys of its client, gets
// (#179): the routes of the account whose keys signed it, as the client's calls do, with their
// status, 202 included, and their body. Recorded with the clients' calls.
async function answerSignedCall(url, { method = 'GET', headers = {}, body } = {}) {
  const route = url.slice(`https://${API_HOST}${API_BASE_PATH}`.length);
  const consumerKey = headers['X-Ovh-Consumer'];
  calls.push({ consumerKey, method, route, params: body ? JSON.parse(body) : undefined });
  const served = accounts.get(consumerKey);
  const signed = served && headers['X-Ovh-Application'] === served.credentials.appKey
    && headers['X-Ovh-Signature']
      === signatureOf(served.credentials, method, url, body, headers['X-Ovh-Timestamp']);
  if (!signed) return fetched(403, JSON.stringify({ message: 'This credential is not valid' }));
  const handler = served.routes.get(route);
  if (!handler) return fetched(404, JSON.stringify({ message: `Not found: ${route}` }));
  try {
    const answer = await handler(body ? JSON.parse(body) : undefined);
    return answer instanceof Accepted
      ? fetched(202, JSON.stringify(answer.value))
      : fetched(200, answer === undefined ? '' : JSON.stringify(answer));
  } catch (err) {
    return fetched(err.error, JSON.stringify({ message: err.message }));
  }
}

// What the import downloads a link with, in place of the global fetch: it serves `files`, and
// answers 404 to any other link, as an expired link does; and the calls to the API that the
// import signs itself
const simulatedFetch = async (url, init) => {
  if (String(url).startsWith(`https://${API_HOST}${API_BASE_PATH}/`)) {
    return answerSignedCall(String(url), init);
  }
  const content = files.get(String(url));
  if (content instanceof Error) throw content;
  return content === undefined ? fetched(404, 'Not Found') : fetched(200, content);
};

// Handlers: an answer, one of 202 Accepted, or an error as the ovh client rejects with it
const ok = (value) => () => Promise.resolve(value);
const accepted = (value) => () => Promise.resolve(new Accepted(value));
const fail = (error, message) => () => Promise.reject({ error, message });

// What GET /me answers for an account, its fields that the import reads
const me = ({ nic, currency }) => ok({ nichandle: nic, currency: { code: currency } });

/**
 * Serves an account besides the account of the tests, GET /me naming it, and no other
 * route.
 * @param {{nic: string, currency: string}} account - The account, as GET /me names it
 * @param {string} [key] - What tells its credentials apart from the others', its NIC handle
 *   by default: two keys of one account are two credentials that lead to it
 * @returns {{routes: Map, credentials: object}} Its routes, as `routes` holds those of the
 *   account of the tests, and the credentials that the configuration gives for it
 */
function serveAccount(account, key = account.nic) {
  const credentials = {
    appKey: `app-${key}`, appSecret: `secret-${key}`, consumerKey: `consumer-${key}`,
    endpoint: 'ovh-eu',
  };
  const served = { credentials, routes: new Map([['/me', me(account)]]) };
  accounts.set(credentials.consumerKey, served);
  return served;
}

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
 * file. Each test starts with GET /me served for the account of the tests (ACCOUNT, in
 * ./accounts.js), and no other route or account, no file at any link, a configuration that
 * gives the credentials of that account alone, in the legacy flat form, no call recorded, an
 * empty database, a silent console, fake timers, on which the retry delays cost no real time,
 * and a process.exit that only records its code, as an import that fails exits.
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
    jest.spyOn(process, 'exit').mockImplementation(() => {});
    jest.spyOn(global, 'fetch').mockImplementation(simulatedFetch);
    files.clear();
    routes.clear();
    routes.set('/me', me(ACCOUNT));
    accounts.clear();
    accounts.set(CREDENTIALS.consumerKey, { credentials: CREDENTIALS, routes });
    calls.length = 0;
    clientCredentials.length = 0;
    useDefaultConfig();
    emptyDatabase(loaded.db);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  return loaded;
}

module.exports = {
  ovh, jsonfile, client, routes, files, calls, clientCredentials, CREDENTIALS, CONFIG_FILES, ok,
  accepted, fail, me, serveAccount, useConfig, useConfigFiles, useThrowawayImport,
};
