/**
 * How a failed call to the OVH API reads, for the import's logs and the errors it records.
 */

const util = require('util');

// The HTTP status of a failed call: the ovh client puts it in `error`, other clients in
// `statusCode`. Undefined when the call rejected with anything else, even with nothing.
function errorStatus(err) {
  return err?.statusCode ?? err?.error;
}

// Why a call failed, whatever it rejected with: the ovh client rejects with a plain object,
// { error: HTTP status, message }, other code with an Error or a string
function describeError(err) {
  if (err === null || typeof err !== 'object') return String(err);
  const reason = [errorStatus(err), err.message]
    .filter(part => part !== undefined && part !== null && part !== '')
    .join(' ');
  return reason || util.inspect(err, { breakLength: Infinity });
}

// Whether a call failed because the key lacks the right to make it: OVH answers 403 "This
// call has not been granted" then
function isNotGranted(err) {
  return errorStatus(err) === 403 && /not been granted/i.test(err?.message);
}

module.exports = { errorStatus, describeError, isNotGranted };
