/**
 * The server, server/index.js, started in a child process for the tests that
 * go through its routes: Jest cannot load openid-client, an ES module, while
 * the server's own Node can. It runs with a throwaway HOME and DATA_DIR, and
 * reads neither the developer's config.json nor data: only the config.json a
 * test gives it, if any, and the rows a test seeds its database with. A test
 * may start it again over the same HOME and DATA_DIR, as after an upgrade.
 *
 * Also a minimal browser, which keeps the cookies the server sets and follows
 * no redirect, so that a test sees each step of a sign-in.
 */

const { spawn } = require('child_process');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { holdWriteLock } = require('./write-lock');

const SERVER = path.resolve(__dirname, '..', '..', 'server', 'index.js');
const HIDE_REPO_CONFIG = path.resolve(__dirname, 'hide-repo-config.js');
const DATA_LAYER = path.resolve(__dirname, '..', '..', 'data', 'db.js');

// Writes to the database of `dataDir` through its data layer, which it hands to
// `writeRows`: the rows that a test seeds before the server starts, in a
// database that it creates as the server does, or those that an import run
// stores while the server runs. data/db.js reads DATA_DIR once, when it is
// first required.
function writeDatabase(dataDir, writeRows) {
  const previousDataDir = process.env.DATA_DIR;
  process.env.DATA_DIR = dataDir;
  try {
    jest.isolateModules(() => {
      const db = require(DATA_LAYER);
      try {
        writeRows(db);
      } finally {
        db.closeDb();
      }
    });
  } finally {
    if (previousDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = previousDataDir;
  }
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

async function waitFor(check, what, output, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check().catch(() => false)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`the server never ${what}:\n${output()}`);
}

// The DATA_DIR of a throwaway HOME
const dataDirOf = (home) => path.join(home, 'data');

// A throwaway HOME, which holds config in my-ovh-bills/config.json when it is
// given, and DATA_DIR, whose database seed writes to when it is given
function throwawayHome(config, seed) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ocm-test-'));
  if (config !== undefined) {
    fs.mkdirSync(path.join(home, 'my-ovh-bills'));
    fs.writeFileSync(path.join(home, 'my-ovh-bills', 'config.json'), JSON.stringify(config));
  }
  if (seed !== undefined) {
    writeDatabase(dataDirOf(home), seed);
  }
  return home;
}

// The server in a child process, over a throwaway HOME and its DATA_DIR, on a
// port of its own
async function spawnOcm(envOf, home) {
  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  const env = envOf(url);
  const child = spawn(process.execPath, ['--require', HIDE_REPO_CONFIG, SERVER], {
    env: {
      PATH: process.env.PATH,
      HOME: home,
      DATA_DIR: dataDirOf(home),
      PORT: String(port),
      NODE_ENV: 'production',
      IMPORT_ENABLED: 'false',
      RATE_LIMIT_ENABLED: 'false',
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk) => {
    output += chunk;
  });
  child.stderr.on('data', (chunk) => {
    output += chunk;
  });
  const exited = new Promise((resolve) => child.on('exit', resolve));
  return { url, env, child, exited, output: () => output };
}

// Waits until a server that spawnOcm() started answers, and, with OIDC, until
// it has discovered the provider
async function untilReady({ url, env, output }) {
  await waitFor(async () => (await fetch(`${url}/api/health`)).ok, 'answered', output);
  if (env.OIDC_ENABLED === 'true') {
    await waitFor(
      async () => (await fetch(`${url}/auth/login`, { redirect: 'manual' })).status === 302,
      'discovered the provider',
      output
    );
  }
}

/**
 * Starts the server and waits until it answers, and, with OIDC, until it has
 * discovered the provider.
 *
 * @param {function(string): object} envOf - its environment, beyond the
 *   throwaway places, from its URL, such as for OIDC_BASE_URL
 * @param {object} [options]
 * @param {object} [options.config] - the content of its config.json
 * @param {function(object)} [options.seed] - writes to its database before it
 *   starts, through the data layer (data/db.js) that it is handed
 * @returns {Promise<{ url: string, output: function(): string,
 *   logged: function(string): Promise, get: function(string): Promise,
 *   getText: function(string): Promise, write: function(function(object)),
 *   holdWriteLock: function(): function, restart: function(): Promise,
 *   stop: function }>}
 */
async function startOcm(envOf, { config, seed } = {}) {
  const home = throwawayHome(config, seed);
  // The server that runs, which a restart replaces
  let running = await spawnOcm(envOf, home);
  const kill = async () => {
    running.child.kill();
    await running.exited;
  };

  const server = {
    url: running.url,
    output: () => running.output(),
    // Writes to its database while it runs, as an import run does, through the data layer
    // (data/db.js) that it hands to `writeRows`, at once: the server reads the database at each
    // request
    write: (writeRows) => writeDatabase(dataDirOf(home), writeRows),
    // Holds the write lock of its database, as an import does while it stores a bill, until the
    // function that it returns releases it
    holdWriteLock: () => holdWriteLock(dataDirOf(home)),
    // Resolves with the status and the JSON body of the server's answer to a path
    get: async (path) => {
      const res = await fetch(`${server.url}${path}`);
      return { status: res.status, body: await res.json() };
    },
    // Resolves with the status, the headers and the body of the server's answer to a path, as
    // the text of its bytes, such as a CSV export's: Response.text() would drop the byte order
    // mark that starts one
    getText: async (path) => {
      const res = await fetch(`${server.url}${path}`);
      return {
        status: res.status,
        headers: res.headers,
        body: Buffer.from(await res.arrayBuffer()).toString('utf8'),
      };
    },
    // Resolves once the server's output holds this text, which reaches the
    // test apart from the answers, and may come after them. Rejects, with the
    // output, after a wait shorter than Jest's default timeout.
    logged: (text) => waitFor(
      async () => server.output().includes(text), `logged ${text}`, server.output, 3000
    ),
    // Stops the server, and starts it again over its config.json and its database as it left
    // them, as after an upgrade or a reboot. Resolves once it answers, at its new url; rejects,
    // with its output, when it never does.
    restart: async () => {
      await kill();
      running = await spawnOcm(envOf, home);
      server.url = running.url;
      await untilReady(running);
    },
    stop: async () => {
      await kill();
      fs.rmSync(home, { recursive: true, force: true });
    },
  };
  try {
    await untilReady(running);
  } catch (err) {
    await server.stop();
    throw err;
  }
  return server;
}

/**
 * Starts the server with a setting it must refuse, and waits until it exits,
 * 15 s at most.
 *
 * @param {object} env - its environment, beyond the throwaway places
 * @param {object} [options]
 * @param {object} [options.config] - the content of its config.json
 * @returns {Promise<{ code: (number|null), output: string }>} its exit code,
 *   null when it had to be stopped, and its output
 */
async function runOcmUntilExit(env, { config } = {}) {
  const home = throwawayHome(config);
  const { child, exited, output } = await spawnOcm(() => env, home);
  const timer = setTimeout(() => child.kill(), 15000);
  const code = await exited;
  clearTimeout(timer);
  fs.rmSync(home, { recursive: true, force: true });
  return { code, output: output() };
}

/**
 * A browser for the server: it sends back the cookies the server set, and
 * forgets those it clears. Paths are not compared: the tests only visit the
 * server, and the provider, which gets no cookie.
 *
 * @param {string} base - the server's URL
 */
function createBrowser(base) {
  const origin = new URL(base).origin;
  const cookies = new Map();
  return {
    cookies,
    /**
     * Requests a path of the server, or an absolute URL, without following
     * redirects.
     *
     * @param {string} target
     * @param {object} [init] - fetch's options
     * @returns {Promise<Response>}
     */
    async fetch(target, init = {}) {
      const url = new URL(target, base);
      const own = url.origin === origin;
      const headers = { ...init.headers };
      if (own && cookies.size > 0) {
        headers.Cookie = [...cookies].map(([name, value]) => `${name}=${value}`).join('; ');
      }
      const res = await fetch(url, { ...init, headers, redirect: 'manual' });
      for (const cookie of own ? res.headers.getSetCookie() : []) {
        const [pair, ...attributes] = cookie.split(';').map((part) => part.trim());
        const name = pair.slice(0, pair.indexOf('='));
        const cleared = attributes.some((attribute) => /^expires=thu, 01 jan 1970/i.test(attribute)
          || /^max-age=0$/i.test(attribute));
        if (cleared) {
          cookies.delete(name);
        } else {
          cookies.set(name, pair.slice(pair.indexOf('=') + 1));
        }
      }
      return res;
    },
  };
}

module.exports = { startOcm, runOcmUntilExit, createBrowser };
