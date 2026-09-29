/**
 * A call to the OVH API that takes any answer of a 2xx status, with its body. The `ovh` client
 * takes every status but 200 for an error, and loses the rest of the answer, while OVHcloud's
 * carbon calculator answers the request of a file with 202 Accepted, and the id of the task
 * that makes the file in its body (#179). The call is signed as the client signs its own, with
 * the client's keys and its measure of the API's clock.
 */

// A body as the client writes it: JSON, with the characters beyond ASCII escaped; none
// without fields
const bodyOf = (params) => {
  if (!params || Object.keys(params).length === 0) return null;
  return JSON.stringify(params).replace(/[\u0080-￿]/g,
    (character) => `\\u${`0000${character.charCodeAt(0).toString(16)}`.slice(-4)}`);
};

// The body of an answer: its JSON, its text when it is none, or null when it is empty
function answerOf(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * Makes a call to the OVH API through the keys of a client.
 * @param {object} ovh - The client of the account, as require('ovh') creates it
 * @param {string} method - POST, PUT or DELETE
 * @param {string} route - Such as /me/carbonCalculator/csv
 * @param {object} [params] - The fields of the body
 * @returns {Promise<*>} The body of the answer, null when it has none
 * @throws {{error: number, message: ?string}} For any other status, as the client rejects
 */
async function signedRequest(ovh, method, route, params) {
  // The client measures the API's clock at its first call, which this may be
  if (ovh.apiTimeDiff === null || ovh.apiTimeDiff === undefined) {
    const time = await ovh.requestPromised('GET', '/auth/time');
    ovh.apiTimeDiff = time - Math.round(Date.now() / 1000);
  }
  // The client signs the address without its port
  const signedUrl = `https://${ovh.host}${ovh.basePath}${route}`;
  const url = ovh.port && ovh.port !== 443
    ? `https://${ovh.host}:${ovh.port}${ovh.basePath}${route}`
    : signedUrl;
  const body = bodyOf(params);
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
  if (!response.ok) {
    throw { error: response.status, message: answer?.message ?? (answer || undefined) };
  }
  return answer;
}

module.exports = { signedRequest };
