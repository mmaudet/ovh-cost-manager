/**
 * A call to the OVH API that accepts any answer of a 2xx status, with its body. The `ovh`
 * client takes every status but 200 for an error, and loses the rest of the answer, while
 * OVHcloud's carbon calculator accepts the request of a file with 202 Accepted, and the id of
 * the task that makes the file in its body (#179). The call is made as the client makes its
 * own: signed with its keys and its measure of the API's clock, its fields without a value
 * left out, in a JSON body for a POST or a PUT, in the address for the other methods.
 */

const querystring = require('querystring');

// The fields of a call that have a value, as the client sends them
const fieldsOf = (params) => Object.fromEntries(Object.entries(params ?? {})
  .filter(([, value]) => value !== null && value !== undefined));

// A body as the client writes it: JSON, with the characters beyond ASCII escaped
const bodyOf = (fields) => JSON.stringify(fields).replace(/[\u0080-\uFFFF]/g,
  (character) => `\\u${`0000${character.charCodeAt(0).toString(16)}`.slice(-4)}`);

// The body of an answer: its JSON, its text when it is none, or null when it is empty
function answerOf(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

// The message of an error's answer, as the client rejects with it: the answer's `message`, or
// its text
const messageOf = (answer) => {
  if (typeof answer?.message === 'string') return answer.message;
  return typeof answer === 'string' ? answer : undefined;
};

/**
 * Makes a call to the OVH API through the keys of a client.
 * @param {object} ovh - The client of the account, as require('ovh') creates it
 * @param {string} method - GET, POST, PUT or DELETE
 * @param {string} route - Such as /me/carbonCalculator/csv
 * @param {object} [params] - The call's fields
 * @returns {Promise<*>} The body of the answer, null when it has none
 * @throws {{error: number, message: ?string}} For any other status, as the client rejects
 */
async function acceptingRequest(ovh, method, route, params) {
  // The client measures the API's clock at its first call, which this may be
  if (ovh.apiTimeDiff === null || ovh.apiTimeDiff === undefined) {
    const time = await ovh.requestPromised('GET', '/auth/time');
    ovh.apiTimeDiff = time - Math.round(Date.now() / 1000);
  }
  const fields = fieldsOf(params);
  const inBody = method === 'POST' || method === 'PUT';
  const hasFields = Object.keys(fields).length > 0;
  const body = inBody && hasFields ? bodyOf(fields) : null;
  const path = `${ovh.basePath}${route}`
    + (!inBody && hasFields ? `?${querystring.stringify(fields)}` : '');
  // The client signs the address without its port
  const signedUrl = `https://${ovh.host}${path}`;
  const url = ovh.port && ovh.port !== 443 ? `https://${ovh.host}:${ovh.port}${path}` : signedUrl;
  const timestamp = Math.round(Date.now() / 1000) + ovh.apiTimeDiff;
  const response = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Ovh-Application': ovh.appKey,
      'X-Ovh-Consumer': ovh.consumerKey,
      'X-Ovh-Timestamp': String(timestamp),
      'X-Ovh-Signature': ovh.signRequest(method, signedUrl, body, timestamp),
    },
    ...(body === null ? {} : { body }),
  });
  const answer = answerOf(await response.text());
  if (!response.ok) throw { error: response.status, message: messageOf(answer) };
  return answer;
}

module.exports = { acceptingRequest };
