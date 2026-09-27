/**
 * The one way the server reads its settings, for authentication, rate
 * limiting, TRUST_PROXY, imports and the allowed origins alike: a value that
 * is not one the setting takes stops the server, naming the setting, rather
 * than turn a protection off. The checks it shares with the import, of positive
 * integers and of sections, are in data/strict-settings.js.
 */

const {
  parsePositiveInteger,
  readSection,
  A_JSON_NUMBER,
  isUnset,
  refusal,
  asPositiveInteger,
} = require('../data/strict-settings');

// How the errors name what config.json must hold, where a JSON string, such
// as "true", is refused
const JSON_BOOLEANS = 'true or false (JSON booleans)';

// The most proxies TRUST_PROXY counts, far above any real chain of them
const MAX_PROXIES = 10;

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
  if (isUnset(value, fromFile)) {
    return undefined;
  }
  const boolean = asBoolean(value, fromFile);
  if (boolean !== null) {
    return boolean;
  }
  if (auto && typeof value === 'string' && value.toLowerCase() === 'auto') {
    return 'auto';
  }
  const expected = fromFile
    ? `${JSON_BOOLEANS}${auto ? ', or "auto"' : ''}`
    : `true${auto ? ', false or auto' : ' or false'}`;
  throw refusal(name, expected, value);
}

/**
 * Reads TRUST_PROXY, how many proxies the server trusts: true (one proxy),
 * false (none), or an integer from 1 to 10, digits in the environment and a
 * JSON number in config.json. Anything else throws, naming the setting: a
 * count above the real number of proxies lets a client choose the address
 * that rate limiting sees.
 *
 * @param {*} value - the variable's text, or the value in config.json
 * @param {object} setting
 * @param {string} setting.name - the setting, as the error names it
 * @param {boolean} [setting.fromFile] - whether the value comes from config.json
 * @returns {number|undefined} the number of proxies, 0 for false, or undefined
 *   when unset, or empty in the environment
 */
function parseProxyCount(value, { name, fromFile = false }) {
  if (isUnset(value, fromFile)) {
    return undefined;
  }
  const trusted = asBoolean(value, fromFile);
  if (trusted !== null) {
    return trusted ? 1 : 0;
  }
  const count = asPositiveInteger(value, fromFile);
  if (count !== null && count <= MAX_PROXIES) {
    return count;
  }
  const integer = `an integer from 1 to ${MAX_PROXIES}`;
  const expected = fromFile
    ? `${JSON_BOOLEANS}, or ${integer} ${A_JSON_NUMBER}`
    : `true, false or ${integer}`;
  throw refusal(name, expected, value);
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
  if (isUnset(value, fromFile)) {
    return undefined;
  }
  const entries = typeof value === 'string' ? value.split(',') : value;
  if (!Array.isArray(entries) || !entries.every((entry) => typeof entry === 'string')) {
    throw refusal(name, 'an array of strings or a comma-separated string', value);
  }
  return entries.map((entry) => entry.trim()).filter((entry) => entry !== '');
}

// The value as a boolean, or null when it is none: from the environment, the
// text true or false, in any case; from config.json, a JSON boolean
function asBoolean(value, fromFile) {
  if (fromFile) {
    return typeof value === 'boolean' ? value : null;
  }
  const text = typeof value === 'string' ? value.toLowerCase() : null;
  return text === 'true' || text === 'false' ? text === 'true' : null;
}

module.exports = {
  parseBoolean,
  parsePositiveInteger,
  parseProxyCount,
  parseList,
  readSection,
};
