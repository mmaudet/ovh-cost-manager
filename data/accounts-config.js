/**
 * The OVH accounts of config.json (#113), read as strictly as the server's other settings
 * (server/settings.js): a value that is not one they take stops the import and the server,
 * naming the setting and the file, rather than import a half-read list of accounts. The
 * import reads each account's credentials; the server only checks them, as it never calls
 * the OVH API.
 *
 * A configuration file gives its accounts in one of three forms:
 * - accounts, an array of accounts, each with an optional name, unique among them, an
 *   optional budget, a positive integer, and its credentials, endpoint included;
 * - credentials, the credentials of a single account, which has no name, as before #113;
 * - the credentials at the top of the file, in the legacy flat form of credentials.json.
 * The last two read as before: the OVH API client takes the API's host from an endpoint, or
 * a host, or else uses the EU one.
 */

// The keys of the credentials of the legacy forms, as the OVH API client requires them
const KEYS = ['appKey', 'appSecret', 'consumerKey'];
// Those of the accounts section, which names the endpoint of each account
const ACCOUNT_KEYS = [...KEYS, 'endpoint'];

/**
 * @typedef {object} ConfiguredAccount
 * @property {string} label - How the messages name it: its name, quoted, or else its place,
 *   such as accounts[1], or credentials for the single account of the other forms
 * @property {?string} name - Its name, null when it has none
 * @property {?number} budget - Its budget, null when it has none
 * @property {object} credentials - Its credentials as they are given, for the OVH API
 *   client: appKey, appSecret, consumerKey, an endpoint or a host, and whatever else the
 *   client takes
 */

/**
 * Reads the accounts that a configuration file gives.
 *
 * @param {object} config - The content of the file
 * @param {string} source - The file's path, which the errors name
 * @returns {ConfiguredAccount[]} Its accounts, in its order: none when it gives none
 * @throws {Error} naming the setting and the file, for any value that the accounts do not
 *   take, and for a file that gives both the credentials and the accounts sections, as it
 *   would be ambiguous which accounts to import
 */
function readAccounts(config, source) {
  if (config.accounts !== undefined && config.credentials !== undefined) {
    throw new Error(`credentials and accounts in ${source} cannot both be set: list every `
      + 'account under accounts');
  }
  if (config.accounts !== undefined) {
    return readAccountList(config.accounts, source);
  }
  if (config.credentials !== undefined) {
    return [unnamed(readCredentials(config.credentials, 'credentials', source, KEYS))];
  }
  // The legacy flat form, which the whole file is the credentials of
  if (ACCOUNT_KEYS.some((key) => config[key] !== undefined)) {
    return [unnamed(readCredentials(config, null, source, KEYS))];
  }
  return [];
}

/**
 * Checks the accounts that a configuration file gives, for the server: it shows the names
 * that the import records, and never uses their keys.
 *
 * @param {object} config - The content of the file
 * @param {string} source - The file's path, which the errors name
 * @throws {Error} as readAccounts() does
 */
function checkAccounts(config, source) {
  readAccounts(config, source);
}

// The single account of the credentials section, or of the legacy flat form
function unnamed(credentials) {
  return { label: 'credentials', name: null, budget: null, credentials };
}

// The accounts of the accounts section
function readAccountList(list, source) {
  if (!Array.isArray(list)) {
    throw new Error(`accounts in ${source} must be an array of accounts, not ${kindOf(list)}`);
  }
  if (list.length === 0) {
    throw new Error(`accounts in ${source} must list at least one account`);
  }
  // The place of each name taken, by name
  const named = new Map();
  return list.map((entry, index) => {
    const place = `accounts[${index}]`;
    if (!isObject(entry)) {
      throw new Error(`${place} in ${source} must be an object, not ${kindOf(entry)}`);
    }
    const name = readName(entry.name, `${place}.name`, source);
    if (name !== null && named.has(name)) {
      throw new Error(`${place}.name in ${source} must be unique among the accounts: `
        + `${named.get(name)} is named ${JSON.stringify(name)} too`);
    }
    if (name !== null) named.set(name, place);
    return {
      label: name === null ? place : JSON.stringify(name),
      name,
      budget: readBudget(entry.budget, `${place}.budget`, source),
      credentials: readCredentials(entry.credentials, `${place}.credentials`, source,
        ACCOUNT_KEYS),
    };
  });
}

// An optional name: a string with more than spaces, which is trimmed. Not a secret, so the
// error quotes it.
function readName(value, name, source) {
  if (value === undefined) return null;
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${name} in ${source} must be a non-empty string, not `
      + `${JSON.stringify(value)}`);
  }
  return value.trim();
}

// An optional budget: a positive integer, a JSON number
function readBudget(value, name, source) {
  if (value === undefined) return null;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} in ${source} must be a positive integer (a JSON number), not `
      + `${JSON.stringify(value)}`);
  }
  return value;
}

// The credentials of an account: an object whose `keys` are non-empty strings, given to the
// client as they are. Its values are secrets: the errors say what they are, never what they
// hold. `section` is the setting that holds them, null for the top of the file.
function readCredentials(value, section, source, keys) {
  if (value === undefined) {
    throw new Error(`${section} in ${source} is missing: it must be an object that holds `
      + 'appKey, appSecret, consumerKey and endpoint');
  }
  if (!isObject(value)) {
    throw new Error(`${section} in ${source} must be an object, not ${kindOf(value)}`);
  }
  for (const key of keys) {
    const name = section === null ? key : `${section}.${key}`;
    const credential = value[key];
    if (credential === undefined) {
      throw new Error(`${name} in ${source} is missing: it must be a non-empty string`);
    }
    if (typeof credential !== 'string' || credential.trim() === '') {
      throw new Error(`${name} in ${source} must be a non-empty string, not ${kindOf(credential)}`);
    }
  }
  return { ...value };
}

function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// What a value is, for the errors, without its text: a string could be a key put in the
// wrong place
function kindOf(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  if (value === '') return 'an empty string';
  if (typeof value === 'string') return value.trim() === '' ? 'a blank string' : 'a string';
  if (typeof value === 'object') return 'an object';
  return `a ${typeof value}`;
}

module.exports = { readAccounts, checkAccounts };
