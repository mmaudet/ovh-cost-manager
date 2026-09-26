/**
 * The server, server/index.js, started in a child process for the tests that
 * go through its routes: Jest cannot load openid-client, an ES module, while
 * the server's own Node can. It runs with a throwaway HOME and DATA_DIR, and
 * reads neither the developer's config.json nor data.
 *
 * Also a minimal browser, which keeps the cookies the server sets and follows
 * no redirect, so that a test sees each step of a sign-in.
 */

const { spawn } = require('child_process');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');

const SERVER = path.resolve(__dirname, '..', '..', 'server', 'index.js');
const HIDE_REPO_CONFIG = path.resolve(__dirname, 'hide-repo-config.js');

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

async function waitFor(check, what, output) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (await check().catch(() => false)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`the server never ${what}:\n${output()}`);
}

/**
 * Starts the server and waits until it answers, and, with OIDC, until it has
 * discovered the provider.
 *
 * @param {function(string): object} envOf - its environment, beyond the
 *   throwaway places, from its URL, such as for OIDC_BASE_URL
 * @returns {Promise<{ url: string, output: function(): string, stop: function }>}
 */
async function startOcm(envOf) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ocm-test-'));
  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  const env = envOf(url);
  const child = spawn(process.execPath, ['--require', HIDE_REPO_CONFIG, SERVER], {
    env: {
      PATH: process.env.PATH,
      HOME: home,
      DATA_DIR: path.join(home, 'data'),
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

  const server = {
    url,
    output: () => output,
    stop: async () => {
      child.kill();
      await exited;
      fs.rmSync(home, { recursive: true, force: true });
    },
  };
  try {
    await waitFor(async () => (await fetch(`${url}/api/health`)).ok, 'answered', server.output);
    if (env.OIDC_ENABLED === 'true') {
      await waitFor(
        async () => (await fetch(`${url}/auth/login`, { redirect: 'manual' })).status === 302,
        'discovered the provider',
        server.output
      );
    }
  } catch (err) {
    await server.stop();
    throw err;
  }
  return server;
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

module.exports = { startOcm, createBrowser };
