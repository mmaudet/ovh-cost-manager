/**
 * The one way the server reads its settings, for authentication, rate
 * limiting, TRUST_PROXY, imports and the allowed origins alike: a value that
 * is not one the setting takes stops the server, naming the setting, rather
 * than turn a protection off.
 */

// How the errors name what config.json must hold, where a JSON string, such
// as "true" or "100", is refused
const JSON_BOOLEANS = 'true or false (JSON booleans)';
const A_JSON_NUMBER = '(a JSON number)';

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
  if (isUnset(value, fromFile)) {
    return undefined;
  }
  const number = asPositiveInteger(value, fromFile);
  if (number !== null) {
    return number;
  }
  throw refusal(name, `a positive integer${fromFile ? ` ${A_JSON_NUMBER}` : ''}`, value);
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

// Whether a setting is unset: absent, or empty in the environment, as a
// compose file passes a variable that .env leaves out
function isUnset(value, fromFile) {
  return value === undefined || (!fromFile && value === '');
}

// The error of a value that the setting does not take, which it quotes
function refusal(name, expected, value) {
  return new Error(`${name} must be ${expected}, not ${JSON.stringify(value)}`);
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

// The value as a positive integer, or null when it is none: from the
// environment, digits only; from config.json, a JSON number
function asPositiveInteger(value, fromFile) {
  const number = fromFile || !/^\d+$/.test(value) ? value : Number(value);
  return typeof number === 'number' && Number.isSafeInteger(number) && number > 0
    ? number
    : null;
}

module.exports = {
  parseBoolean,
  parsePositiveInteger,
  parseProxyCount,
  parseList,
  readSection,
};
