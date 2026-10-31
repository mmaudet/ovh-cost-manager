/**
 * The OVH accounts of config.json (#113), read as strictly as the server's other settings,
 * with the checks they share (data/strict-settings.js): a value that is not one they take
 * stops the import and the server, naming the setting and the file, rather than import a
 * half-read list of accounts. The import reads each account's credentials; the server only
 * checks them, as it never calls the OVH API.
 *
 * A configuration file gives its accounts in one of three forms:
 * - accounts, an array of accounts, each with an optional name, unique among them, an
 *   optional budget, a positive integer, and its credentials, endpoint included;
 * - credentials, the credentials of a single account, which has no name, as before #113;
 * - the credentials at the top of the file, in the legacy flat form of credentials.json.
 * The last two read as before: the OVH API client takes the API's host from an endpoint, or
 * a host, or else uses the EU one.
 *
 * Each account has a cost source (CONTEXT.md): `bills`, by default, or `cloudUsage`, for an
 * account whose bills a third party issues, which neither the API nor the control panel gives:
 * its costs are then its Public Cloud projects' usage. An entry of the accounts section gives
 * it as its costSource; the single account of the other two forms, as the costSource at the top
 * of the file.
 */

const { parsePositiveInteger, readSection } = require('./strict-settings');

// The keys of the credentials of the legacy forms, as the OVH API client requires them
const KEYS = ['appKey', 'appSecret', 'consumerKey'];
// Those of the accounts section, which names the endpoint of each account
const ACCOUNT_KEYS = [...KEYS, 'endpoint'];

// The cost sources that an account takes, the first by default: its bills, or its Public Cloud
// projects' usage
const COST_SOURCES = ['bills', 'cloudUsage'];

/**
 * @typedef {object} ConfiguredAccount
 * @property {string} label - How the messages name it: its name, quoted, or else its place,
 *   such as accounts[1], or credentials for the single account of the other forms
 * @property {?string} name - Its name, null when it has none
 * @property {?number} budget - Its budget, null when it has none
 * @property {string} costSource - Where its costs come from: 'bills' or 'cloudUsage'
 * @property {object} credentials - Its credentials as they are given, for the OVH API
 *   client: appKey, appSecret, consumerKey, an endpoint or a host, and whatever else the
 *   client takes
 */

/**
 * Reads the accounts that a configuration file gives. The server calls it only to check
 * them.
 *
 * @param {object} config - The content of the file
 * @param {string} source - The file's path, which the errors name
 * @returns {ConfiguredAccount[]} Its accounts, in its order: none when it gives none
 * @throws {Error} naming the setting and the file, for any value that the accounts do not
 *   take, and for a file that gives the accounts section with the credentials of a single
 *   account, in the credentials section or at its top, as it would be ambiguous which
 *   accounts to import
 */
function readAccounts(config, source) {
  if (config.accounts !== undefined && config.credentials !== undefined) {
    throw new Error(`credentials and accounts in ${source} cannot both be set: list every `
      + 'account under accounts');
  }
  const legacyKeys = ACCOUNT_KEYS.filter((key) => config[key] !== undefined);
  if (config.accounts !== undefined && legacyKeys.length > 0) {
    throw new Error(`accounts in ${source} cannot be set with the legacy credentials at the `
      + `top of the file (${legacyKeys.join(', ')}): list every account under accounts`);
  }
  // It would be ambiguous which accounts it is the cost source of
  if (config.accounts !== undefined && config.costSource !== undefined) {
    throw new Error(`costSource at the top of ${source} cannot be set with the accounts `
      + 'section: give each account its own costSource');
  }
  if (config.accounts !== undefined) {
    return readAccountList(config.accounts, source);
  }
  if (config.credentials !== undefined) {
    return [unnamed(readCredentials(config, 'credentials', 'credentials', source, KEYS),
      readCostSource(config.costSource, 'costSource', source))];
  }
  // The legacy flat form, which the whole file is the credentials of
  if (legacyKeys.length > 0) {
    return [unnamed(readCredentials(config, null, null, source, KEYS),
      readCostSource(config.costSource, 'costSource', source))];
  }
  return [];
}

// The single account of the credentials section, or of the legacy flat form
function unnamed(credentials, costSource) {
  return { label: 'credentials', name: null, budget: null, costSource, credentials };
}

// An optional cost source: one of COST_SOURCES, the first when absent
function readCostSource(value, name, source) {
  if (value === undefined) return COST_SOURCES[0];
  if (!COST_SOURCES.includes(value)) {
    const sources = COST_SOURCES.map(costSource => JSON.stringify(costSource)).join(' or ');
    throw new Error(`${name} in ${source} must be ${sources}, not ${JSON.stringify(value)}`);
  }
  return value;
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
  return list.map((_, index) => {
    const place = `accounts[${index}]`;
    const entry = readSection(list, index, { name: `${place} in ${source}` });
    const name = readName(entry.name, `${place}.name`, source);
    if (name !== null && named.has(name)) {
      throw new Error(`${place}.name in ${source} must be unique among the accounts: `
        + `${named.get(name)} is named ${JSON.stringify(name)} too`);
    }
    if (name !== null) named.set(name, place);
    return {
      label: name === null ? place : JSON.stringify(name),
      name,
      budget: parsePositiveInteger(entry.budget, {
        name: `${place}.budget in ${source}`, fromFile: true,
      }) ?? null,
      costSource: readCostSource(entry.costSource, `${place}.costSource`, source),
      credentials: readCredentials(entry, 'credentials', `${place}.credentials`, source,
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

// The credentials of an account, under `key` in `parent`, which `name` names, or, with a null
// key, the whole of `parent`, in the legacy flat form: an object whose `keys` are non-empty
// strings, which goes to the client as it is. Its values are secrets: the errors say what
// they are, never what they hold.
function readCredentials(parent, key, name, source, keys) {
  if (key !== null && parent[key] === undefined) {
    throw new Error(`${name} in ${source} is missing: it must be an object that holds `
      + 'appKey, appSecret, consumerKey and endpoint');
  }
  const credentials = key === null
    ? parent
    : readSection(parent, key, { name: `${name} in ${source}` });
  for (const credentialKey of keys) {
    const setting = name === null ? credentialKey : `${name}.${credentialKey}`;
    const credential = credentials[credentialKey];
    if (credential === undefined) {
      throw new Error(`${setting} in ${source} is missing: it must be a non-empty string`);
    }
    if (typeof credential !== 'string' || credential.trim() === '') {
      throw new Error(`${setting} in ${source} must be a non-empty string, not `
        + `${kindOf(credential)}`);
    }
  }
  return { ...credentials };
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

module.exports = { COST_SOURCES, readAccounts };
