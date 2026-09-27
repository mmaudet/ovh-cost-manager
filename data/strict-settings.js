/**
 * The strict checks of the settings that the server and the import share, as both read
 * config.json: a value that is not one the setting takes throws, naming the setting, rather
 * than turn a protection off or read half a configuration. server/settings.js reads the
 * server's settings with them, and data/accounts-config.js the OVH accounts.
 */

// How the errors name what config.json must hold, where a JSON string, such as "100", is
// refused
const A_JSON_NUMBER = '(a JSON number)';

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

// The value as a positive integer, or null when it is none: from the
// environment, digits only; from config.json, a JSON number
function asPositiveInteger(value, fromFile) {
  const number = fromFile || !/^\d+$/.test(value) ? value : Number(value);
  return typeof number === 'number' && Number.isSafeInteger(number) && number > 0
    ? number
    : null;
}

module.exports = {
  parsePositiveInteger,
  readSection,
  // For the server's other parsers, in server/settings.js
  A_JSON_NUMBER,
  isUnset,
  refusal,
  asPositiveInteger,
};
