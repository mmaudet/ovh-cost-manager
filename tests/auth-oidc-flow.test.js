/**
 * End-to-end tests of OIDC authentication: the server, started in a child
 * process, signs in through a fake provider served in this process, and
 * verifies the provider's back-channel logout tokens, signed with the
 * provider's key pair, as a real provider signs them.
 */

const { encodeLoginState } = require('../server/auth/login-state');
const { startFakeProvider } = require('./support/fake-provider');
const { startOcm, createBrowser } = require('./support/ocm-server');

const SESSION_SECRET = '0123456789abcdef0123456789abcdef';

let provider;
let ocm;

// The server's environment, for the provider, at url
const oidcEnv = (url) => ({
  OIDC_ENABLED: 'true',
  OIDC_ISSUER: provider.issuer,
  OIDC_CLIENT_ID: provider.clientId,
  OIDC_CLIENT_SECRET: provider.clientSecret,
  OIDC_BASE_URL: url,
  SESSION_SECRET,
});

beforeAll(async () => {
  provider = await startFakeProvider();
  ocm = await startOcm(oidcEnv);
}, 30000);

afterAll(async () => {
  await ocm?.stop();
  await provider?.close();
});

// /auth/login, then the provider's authorization: the callback URL the
// provider sends the browser back to, not yet opened
async function startSignIn(browser, returnTo) {
  const query = returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : '';
  const login = await browser.fetch(`/auth/login${query}`);
  expect(login.status).toBe(302);
  const authorization = await browser.fetch(login.headers.get('location'));
  return authorization.headers.get('location');
}

// A whole sign-in: the callback's response
async function signIn(browser, returnTo) {
  return browser.fetch(await startSignIn(browser, returnTo));
}

// A browser signed in as user, and the provider's session of its sign-in
async function signedIn(user) {
  provider.user = user;
  const browser = createBrowser(ocm.url);
  const callback = await signIn(browser);
  expect(callback.status).toBe(302);
  return { browser, sid: provider.lastSid };
}

const isSignedIn = async ({ browser }) => (await browser.fetch('/api/months')).status === 200;

describe('sign-in', () => {
  test('signs in through the provider, with PKCE, and goes back to returnTo', async () => {
    provider.user = 'alice';
    const browser = createBrowser(ocm.url);
    const callback = await signIn(browser, '/dashboard');

    expect(callback.status).toBe(302);
    expect(callback.headers.get('location')).toBe('/dashboard');
    expect(provider.lastPkce).toEqual({ method: 'S256', verified: true });
    const user = await browser.fetch('/api/user');
    expect(await user.json()).toMatchObject({ id: 'alice', authEnabled: true });
  });

  test('refuses a callback opened without the sign-in cookie', async () => {
    const callbackUrl = await startSignIn(createBrowser(ocm.url));
    const other = createBrowser(ocm.url);
    expect((await other.fetch(callbackUrl)).status).toBe(400);
    expect(other.cookies.size).toBe(0);
  });

  test('refuses a callback with the state of a sign-in of another browser', async () => {
    const callbackUrl = await startSignIn(createBrowser(ocm.url));
    const other = createBrowser(ocm.url);
    await startSignIn(other);
    expect((await other.fetch(callbackUrl)).status).toBe(400);
  });

  // The redirect follows the cookie: its returnTo is checked again, should a
  // cookie be forged with the secret
  test('goes back to / when the sign-in cookie holds another site', async () => {
    provider.user = 'alice';
    const browser = createBrowser(ocm.url);
    const callbackUrl = await startSignIn(browser);
    const [name, value] = [...browser.cookies].find(([cookie]) => cookie.startsWith('ocm.login.'));
    const pending = JSON.parse(Buffer.from(value.split('.')[0], 'base64url').toString());
    browser.cookies.set(name, encodeLoginState(
      { ...pending, returnTo: 'https://evil.example/' },
      SESSION_SECRET
    ));

    const callback = await browser.fetch(callbackUrl);
    expect(callback.status).toBe(302);
    expect(callback.headers.get('location')).toBe('/');
  });

  test('lets two sign-ins run in parallel in one browser, each with its cookie', async () => {
    provider.user = 'alice';
    const browser = createBrowser(ocm.url);
    const signInCookies = () => [...browser.cookies.keys()]
      .filter((name) => name.startsWith('ocm.login.'));
    const first = await startSignIn(browser);
    const second = await startSignIn(browser);
    expect(signInCookies()).toHaveLength(2);

    expect((await browser.fetch(second)).status).toBe(302);
    // The second callback cleared its own cookie only
    expect(signInCookies()).toHaveLength(1);
    expect((await browser.fetch(first)).status).toBe(302);
    expect(signInCookies()).toHaveLength(0);
  });
});

describe('sign-in over HTTPS through a trusted proxy', () => {
  const https = { headers: { 'X-Forwarded-Proto': 'https' } };
  let proxied;

  beforeAll(async () => {
    proxied = await startOcm((url) => ({ ...oidcEnv(url), TRUST_PROXY: 'true' }));
  }, 30000);

  afterAll(() => proxied?.stop());

  test('keeps the sign-in in a __Host- cookie, Secure, on Path=/', async () => {
    provider.user = 'alice';
    const browser = createBrowser(proxied.url);
    const login = await browser.fetch('/auth/login', https);
    const [cookie] = login.headers.getSetCookie();
    expect(cookie).toMatch(/^__Host-ocm\.login\.[\w-]+=/);
    expect(cookie).toMatch(/; Path=\/;/);
    expect(cookie).toMatch(/; Secure/);
    expect(cookie).toMatch(/; HttpOnly/);
    expect(cookie).toMatch(/; SameSite=Lax/);

    const authorization = await browser.fetch(login.headers.get('location'));
    const callback = await browser.fetch(authorization.headers.get('location'), https);
    expect(callback.status).toBe(302);
    expect(browser.cookies.has('ocm.sid')).toBe(true);
  });
});

// A sign-in the provider refuses, or whose answer fails a check, gets a 400
// with a short message, the details in the log only
describe('a failed sign-in', () => {
  async function expectRefused(res, detail) {
    expect(res.status).toBe(400);
    expect(res.headers.get('content-type')).toMatch(/^text\/plain/);
    expect(await res.text()).toBe('Sign-in failed, please sign in again.');
    expect(ocm.output()).toMatch(detail);
  }

  test('answers 400 to a callback replayed with a copy of the sign-in cookie', async () => {
    provider.user = 'alice';
    const browser = createBrowser(ocm.url);
    const callbackUrl = await startSignIn(browser);
    const copy = createBrowser(ocm.url);
    for (const [name, value] of browser.cookies) {
      copy.cookies.set(name, value);
    }
    expect((await browser.fetch(callbackUrl)).status).toBe(302);

    // The provider refuses the code it already exchanged
    await expectRefused(await copy.fetch(callbackUrl), /invalid_grant/);
    expect(copy.cookies.has('ocm.sid')).toBe(false);
  });

  // The code and the state are credentials of the sign-in: the log tells how
  // the callback went without them
  test('logs neither the code nor the state of a callback', async () => {
    provider.user = 'alice';
    const browser = createBrowser(ocm.url);
    const callbackUrl = await startSignIn(browser);
    const { code, state } = Object.fromEntries(new URL(callbackUrl).searchParams);
    const copy = createBrowser(ocm.url);
    for (const [name, value] of browser.cookies) {
      copy.cookies.set(name, value);
    }
    expect((await browser.fetch(callbackUrl)).status).toBe(302);
    expect((await copy.fetch(callbackUrl)).status).toBe(400);

    expect(ocm.output()).toMatch(/OIDC sign-in: session opened for alice/);
    expect(ocm.output()).not.toContain(code);
    expect(ocm.output()).not.toContain(state);
  });

  // openid-client's error then carries the callback's parameters
  test('logs neither the code nor the state of a callback from another issuer', async () => {
    provider.next.wrongIss = true;
    const browser = createBrowser(ocm.url);
    const callbackUrl = await startSignIn(browser);
    const { code, state } = Object.fromEntries(new URL(callbackUrl).searchParams);

    expect((await browser.fetch(callbackUrl)).status).toBe(400);
    expect(ocm.output()).toMatch(/sign-in refused: .*"iss"/);
    expect(ocm.output()).not.toContain(code);
    expect(ocm.output()).not.toContain(state);
  });

  test('answers 400 to a consent the user denied', async () => {
    provider.next.deny = true;
    const browser = createBrowser(ocm.url);
    await expectRefused(await browser.fetch(await startSignIn(browser)), /access_denied/);
  });

  test('answers 400 to an ID token that holds another nonce', async () => {
    provider.next.wrongNonce = true;
    const browser = createBrowser(ocm.url);
    await expectRefused(await browser.fetch(await startSignIn(browser)), /nonce/);
    expect(browser.cookies.has('ocm.sid')).toBe(false);
  });
});

describe('back-channel logout', () => {
  const logout = (logoutToken) => fetch(`${ocm.url}/logout/backchannel`, {
    method: 'POST',
    body: new URLSearchParams({ logout_token: logoutToken }),
  });

  test('ends the sessions of the token\'s sid only', async () => {
    const first = await signedIn('bob');
    const second = await signedIn('bob');

    const res = await logout(provider.logoutToken({ sid: first.sid, sub: 'bob' }));
    expect(res.status).toBe(200);
    expect(await isSignedIn(first)).toBe(false);
    expect(await isSignedIn(second)).toBe(true);
  });

  // An ordinary sign-out elsewhere must not end the other sessions of the user
  test('ends nothing when the sid matches no session, even with a sub', async () => {
    const session = await signedIn('carol');

    const res = await logout(provider.logoutToken({ sid: 'op-session-elsewhere', sub: 'carol' }));
    expect(res.status).toBe(200);
    expect(await isSignedIn(session)).toBe(true);
  });

  test('ends every session of the sub when the token has no sid', async () => {
    const first = await signedIn('dave');
    const second = await signedIn('dave');

    const res = await logout(provider.logoutToken({ sub: 'dave' }));
    expect(res.status).toBe(200);
    expect(await isSignedIn(first)).toBe(false);
    expect(await isSignedIn(second)).toBe(false);
  });

  test('refuses a replayed token, which would end the sessions opened since', async () => {
    const token = provider.logoutToken({ sub: 'erin' });
    await signedIn('erin');
    expect((await logout(token)).status).toBe(200);

    const later = await signedIn('erin');
    expect((await logout(token)).status).toBe(400);
    expect(await isSignedIn(later)).toBe(true);
    expect(ocm.output()).toMatch(/invalid logout token: .*replay/);
  });

  // LemonLDAP-NG, the provider of the demo stack, may leave jti out: the token
  // itself then tells a replay
  test('accepts a token without jti, and refuses its replay', async () => {
    const first = await signedIn('heidi');
    const token = provider.logoutToken({ sid: first.sid, sub: 'heidi', jti: undefined });
    expect((await logout(token)).status).toBe(200);
    expect(await isSignedIn(first)).toBe(false);

    expect((await logout(token)).status).toBe(400);
    expect(ocm.output()).toMatch(/invalid logout token: replay of the token sha256:/);
  });

  test.each([
    ['without exp', { exp: undefined }, /"exp"/],
    ['for another client', { aud: 'another-client' }, /"aud"/],
    ['from another issuer', { iss: 'http://evil.example' }, /"iss"/],
  ])('refuses a token %s', async (label, claims, reason) => {
    const session = await signedIn('frank');

    const res = await logout(provider.logoutToken({ sid: session.sid, ...claims }));
    expect(res.status).toBe(400);
    expect(await isSignedIn(session)).toBe(true);
    expect(ocm.output().split('\n').filter((line) => reason.test(line))).not.toHaveLength(0);
  });

  test.each([
    ['signed with a key the provider does not publish', { otherKey: true }],
    ['left unsigned', { header: { alg: 'none' } }],
  ])('refuses a token %s', async (label, options) => {
    const session = await signedIn('grace');

    const res = await logout(provider.logoutToken({ sid: session.sid }, options));
    expect(res.status).toBe(400);
    expect(await isSignedIn(session)).toBe(true);
  });
});
