/**
 * Rate limiting behind two proxies, a TLS terminator in front of the relay of
 * the SSO stack (#101): the terminator adds its client's address to
 * X-Forwarded-For, and the relay its own client's, the terminator's. The
 * server runs in a child process, with a limit of 2 API requests, and its
 * socket peer, 127.0.0.1, stands for the relay.
 */

const { startOcm } = require('./support/ocm-server');

// Documentation addresses
const TERMINATOR = '203.0.113.10';
const CLIENT_A = '198.51.100.1';
const CLIENT_B = '198.51.100.2';

// The statuses of a client's requests to the API, through the terminator and
// the relay
async function statusesOf(ocm, client, count) {
  const statuses = [];
  for (let i = 0; i < count; i += 1) {
    const res = await fetch(`${ocm.url}/api/months`, {
      headers: { 'X-Forwarded-For': `${client}, ${TERMINATOR}` },
    });
    statuses.push(res.status);
  }
  return statuses;
}

describe.each([
  {
    trustProxy: '2',
    clients: 'each at its own address, as the terminator gives it',
    statusOfB: 200,
    proxies: '2 proxies',
  },
  // As before TRUST_PROXY took a number: the server trusts the relay alone
  {
    trustProxy: 'true',
    clients: 'together, at the terminator\'s address',
    statusOfB: 429,
    proxies: '1 proxy',
  },
])('with TRUST_PROXY=$trustProxy', ({ trustProxy, clients, statusOfB, proxies }) => {
  let ocm;

  beforeAll(async () => {
    ocm = await startOcm(() => ({
      RATE_LIMIT_ENABLED: 'true',
      RATE_LIMIT_API_MAX: '2',
      TRUST_PROXY: trustProxy,
    }));
  }, 30000);

  afterAll(() => ocm?.stop());

  test(`limits the clients ${clients}`, async () => {
    expect(await statusesOf(ocm, CLIENT_A, 3)).toEqual([200, 200, 429]);
    expect(await statusesOf(ocm, CLIENT_B, 1)).toEqual([statusOfB]);
  });

  test(`logs at startup that it trusts ${proxies}`, async () => {
    await ocm.logged(`Trust proxy: ${proxies}`);
  });
});
