/**
 * What the auth module logs of text it did not write: the provider's, such as
 * a sub or the error of a refused sign-in, or a request's, as the callback's
 * URL brings that error. Quoted as JSON, a newline or another control
 * character in it cannot end the line and forge one of its own in the log.
 */

// JSON.stringify escapes the controls from U+0000 to U+001F, not these:
// delete, the C1 controls, among them NEL and CSI, and the line and paragraph
// separators, which some terminals and log viewers act on
const UNESCAPED_CONTROLS = /[\u007f-\u009f\u2028\u2029]/g;

/**
 * Text as a JSON string, on one line, which JSON.parse reads back.
 *
 * @param {*} value - the text, or any value, written as its text
 * @returns {string}
 */
function quote(value) {
  return JSON.stringify(String(value)).replace(
    UNESCAPED_CONTROLS,
    (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`
  );
}

/**
 * What an error of openid-client says of a refused sign-in, for the log: its
 * messages and the provider's error, quoted, not its cause's data, which can
 * hold the callback's parameters, the code and the state among them.
 *
 * @param {Error} err
 * @returns {string}
 */
function describeRefusal(err) {
  const parts = [`${err.name}: ${quote(err.message)}`];
  if (err.error) {
    parts.push(`error ${quote(err.error)}`);
  }
  if (err.error_description) {
    parts.push(`description ${quote(err.error_description)}`);
  }
  if (err.cause instanceof Error) {
    parts.push(`because ${quote(err.cause.message)}`);
  }
  return parts.join(', ');
}

/**
 * Why a discovery of the provider failed, for the log: the error's message,
 * and its cause's code or message, quoted, as the provider's answer can make
 * them, such as a JSON parser's message, which holds the start of the text
 * it failed on.
 *
 * @param {Error} err
 * @returns {string}
 */
function describeDiscoveryFailure(err) {
  const cause = err.cause?.code || err.cause?.message;
  return cause ? `${quote(err.message)} (${quote(cause)})` : quote(err.message);
}

module.exports = { quote, describeRefusal, describeDiscoveryFailure };
