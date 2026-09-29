/**
 * A call to the OVH API that accepts any 2xx answer, with its body, made as the `ovh` client
 * makes its own (#179). The tests give it a real client, whose fields and signature it reads:
 * an upgrade of the client that changed them would fail here. No call reaches the API.
 */

const crypto = require('crypto');
const createClient = require('ovh');
const { acceptingRequest } = require('../data/ovh-accepting-request');

const NOW = new Date('2026-09-29T12:00:00Z');
const NOW_SECONDS = NOW.getTime() / 1000;
const API = 'https://eu.api.ovh.com/1.0';

// A real client of the EU endpoint, whose measure of the API's clock the tests give
function clientOf(fields = {}) {
  const client = createClient({
    appKey: 'app-key', appSecret: 'app-secret', consumerKey: 'consumer-key', endpoint: 'ovh-eu',
  });
  client.apiTimeDiff = 0;
  return Object.assign(client, fields);
}

// OVH's signature of a call, as its documentation gives it
const signatureOf = (method, url, body, timestamp) => '$1$' + crypto.createHash('sha1')
  .update(['app-secret', 'consumer-key', method, url, body, timestamp].join('+'))
  .digest('hex');

// What each call sent, and the answer that every call gets
let sent;
const answerWith = (status, text) => jest.spyOn(global, 'fetch')
  .mockImplementation(async (url, init) => {
    sent.push({ url, ...init });
    return { ok: status >= 200 && status < 300, status, text: async () => text };
  });

beforeEach(() => {
  jest.useFakeTimers({ now: NOW });
  sent = [];
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

test('takes a 202 with its body, signed as the client signs its own', async () => {
  answerWith(202, '{"taskID":"task-1"}');

  await expect(acceptingRequest(clientOf(), 'POST', '/me/carbonCalculator/csv', {
    startMonth: '2024-09-01', endMonth: '2026-08-01',
  })).resolves.toEqual({ taskID: 'task-1' });

  const body = '{"startMonth":"2024-09-01","endMonth":"2026-08-01"}';
  const url = `${API}/me/carbonCalculator/csv`;
  expect(sent).toEqual([{
    url,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Ovh-Application': 'app-key',
      'X-Ovh-Consumer': 'consumer-key',
      'X-Ovh-Timestamp': String(NOW_SECONDS),
      'X-Ovh-Signature': signatureOf('POST', url, body, NOW_SECONDS),
    },
    body,
  }]);
});

test("measures the API's clock first, when the client has not yet", async () => {
  const client = clientOf({
    apiTimeDiff: null, requestPromised: jest.fn().mockResolvedValue(NOW_SECONDS + 42),
  });
  answerWith(200, '{"status":"SUCCESS"}');

  await acceptingRequest(client, 'GET', '/me/carbonCalculator/task/task-1');

  expect(client.requestPromised).toHaveBeenCalledWith('GET', '/auth/time');
  expect(sent[0].headers['X-Ovh-Timestamp']).toBe(String(NOW_SECONDS + 42));
});

test('escapes the characters beyond ASCII, and leaves out the fields without a value', async () => {
  answerWith(200, '{}');
  const eAcute = String.fromCharCode(0xe9);

  await acceptingRequest(clientOf(), 'POST', '/me/x', {
    name: `caf${eAcute}`, none: null, gone: undefined,
  });

  const body = `{"name":"caf${String.fromCharCode(92)}u00e9"}`;
  expect(sent[0].body).toBe(body);
  expect(sent[0].headers['X-Ovh-Signature'])
    .toBe(signatureOf('POST', `${API}/me/x`, body, NOW_SECONDS));
});

test('sends the fields of a GET in its signed address, without a body', async () => {
  answerWith(200, '[]');

  await acceptingRequest(clientOf(), 'GET', '/me/x', { limit: 1 });

  expect(sent[0].url).toBe(`${API}/me/x?limit=1`);
  expect(sent[0]).not.toHaveProperty('body');
  expect(sent[0].headers['X-Ovh-Signature'])
    .toBe(signatureOf('GET', `${API}/me/x?limit=1`, '', NOW_SECONDS));
});

test('calls a port other than 443, which the signature leaves out', async () => {
  answerWith(200, '{}');

  await acceptingRequest(clientOf({ port: 8443 }), 'GET', '/me/x');

  expect(sent[0].url).toBe('https://eu.api.ovh.com:8443/1.0/me/x');
  expect(sent[0].headers['X-Ovh-Signature'])
    .toBe(signatureOf('GET', `${API}/me/x`, '', NOW_SECONDS));
});

test('takes an answer without a body', async () => {
  answerWith(204, '');

  await expect(acceptingRequest(clientOf(), 'DELETE', '/me/x')).resolves.toBeNull();
});

describe('rejects any other status as the client does', () => {
  test('with the message of the answer', async () => {
    answerWith(403, '{"message":"This call has not been granted"}');

    await expect(acceptingRequest(clientOf(), 'POST', '/me/carbonCalculator/csv', {}))
      .rejects.toEqual({ error: 403, message: 'This call has not been granted' });
  });

  test('with the text of an answer that is no JSON', async () => {
    answerWith(502, 'Bad gateway');

    await expect(acceptingRequest(clientOf(), 'GET', '/me/x'))
      .rejects.toEqual({ error: 502, message: 'Bad gateway' });
  });

  test('without a message when the answer gives none', async () => {
    answerWith(500, '{"code":"INTERNAL"}');

    await expect(acceptingRequest(clientOf(), 'GET', '/me/x'))
      .rejects.toEqual({ error: 500, message: undefined });
  });
});
