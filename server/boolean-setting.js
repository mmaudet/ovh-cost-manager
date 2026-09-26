/**
 * The one way the server reads a true/false setting, for authentication, rate
 * limiting and TRUST_PROXY alike.
 */

/**
 * Reads a true/false setting: from the environment, the text true or false,
 * in any case; from config.json, the JSON booleans true or false. auto too
 * where allowed. Anything else throws, naming the setting, rather than turn a
 * check off.
 *
 * @param {*} value - the variable's text, or the value in config.json
 * @param {object} setting
 * @param {string} setting.name - the setting, as the error names it
 * @param {boolean} [setting.fromFile] - whether the value comes from config.json
 * @param {boolean} [setting.auto] - whether auto is allowed, as for the Secure flag
 * @returns {boolean|string|undefined} true, false or 'auto', or undefined when
 *   unset, or empty in the environment
 */
function parseBoolean(value, { name, fromFile = false, auto = false }) {
  if (value === undefined || (!fromFile && value === '')) {
    return undefined;
  }
  if (fromFile && typeof value === 'boolean') {
    return value;
  }
  const text = typeof value === 'string' ? value.toLowerCase() : null;
  if (!fromFile && (text === 'true' || text === 'false')) {
    return text === 'true';
  }
  if (auto && text === 'auto') {
    return 'auto';
  }
  const expected = fromFile
    ? `true or false (JSON booleans)${auto ? ', or "auto"' : ''}`
    : `true${auto ? ', false or auto' : ' or false'}`;
  throw new Error(`${name} must be ${expected}, not ${JSON.stringify(value)}`);
}

module.exports = { parseBoolean };
