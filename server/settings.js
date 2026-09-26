/**
 * The one way the server reads its settings, for authentication, rate
 * limiting, TRUST_PROXY, imports and the allowed origins alike: a value that
 * is not one the setting takes stops the server, naming the setting, rather
 * than turn a protection off.
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

/**
 * Reads a positive integer setting, such as a rate limit: from the
 * environment, digits only; from config.json, a JSON number. Anything else
 * throws, naming the setting: express-rate-limit compared every count to a
 * limit of "abc", and so limited nothing.
 *
 * @param {*} value - the variable's text, or the value in config.json
 * @param {object} setting
 * @param {string} setting.name - the setting, as the error names it
 * @param {boolean} [setting.fromFile] - whether the value comes from config.json
 * @returns {number|undefined} the number, or undefined when unset, or empty in
 *   the environment
 */
function parsePositiveInteger(value, { name, fromFile = false }) {
  if (value === undefined || (!fromFile && value === '')) {
    return undefined;
  }
  const number = fromFile || !/^\d+$/.test(value) ? value : Number(value);
  if (typeof number === 'number' && Number.isSafeInteger(number) && number > 0) {
    return number;
  }
  const expected = fromFile ? 'a positive integer (a JSON number)' : 'a positive integer';
  throw new Error(`${name} must be ${expected}, not ${JSON.stringify(value)}`);
}

/**
 * Reads a list setting, such as the allowed origins: from the environment, a
 * comma-separated text; from config.json, an array of strings, or such a
 * text too. Each entry is trimmed, and blank ones left out. Anything else
 * throws, naming the setting: a string of config.json used as the list was
 * compared by substring, so that it allowed any part of an origin it held.
 *
 * @param {*} value - the variable's text, or the value in config.json
 * @param {object} setting
 * @param {string} setting.name - the setting, as the error names it
 * @param {boolean} [setting.fromFile] - whether the value comes from config.json
 * @returns {string[]|undefined} the entries, or undefined when unset, or empty
 *   in the environment
 */
function parseList(value, { name, fromFile = false }) {
  if (value === undefined || (!fromFile && value === '')) {
    return undefined;
  }
  const entries = typeof value === 'string' ? value.split(',') : value;
  if (!Array.isArray(entries) || !entries.every((entry) => typeof entry === 'string')) {
    throw new Error(`${name} must be an array of strings or a comma-separated string, `
      + `not ${JSON.stringify(value)}`);
  }
  return entries.map((entry) => entry.trim()).filter((entry) => entry !== '');
}

/**
 * Reads a section of config.json, such as auth or rateLimit under the file,
 * or session under auth: an object, or an empty one when absent. Anything
 * else throws, naming the section, rather than drop its settings: with
 * "auth": true, authentication was off.
 *
 * @param {object} parent - the object that holds the section
 * @param {string} key - the section's key in it
 * @param {object} setting
 * @param {string} setting.name - the section, as the error names it
 * @returns {object}
 */
function readSection(parent, key, { name }) {
  const section = parent[key];
  if (section === undefined) {
    return {};
  }
  if (typeof section === 'object' && section !== null && !Array.isArray(section)) {
    return section;
  }
  // Not the text of a string, which could be a secret put in the wrong place
  let shown = JSON.stringify(section);
  if (typeof section === 'string') {
    shown = 'a string';
  } else if (Array.isArray(section)) {
    shown = 'an array';
  }
  throw new Error(`${name} must be an object, not ${shown}`);
}

module.exports = { parseBoolean, parsePositiveInteger, parseList, readSection };
