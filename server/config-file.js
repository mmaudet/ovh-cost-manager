/**
 * The server's configuration file, config.json.
 */
const fs = require('fs');

/**
 * Reads the first of the paths that exists. A file that exists but cannot be
 * read stops the server: skipping it, as the server did, dropped its
 * settings, authentication included.
 *
 * @param {string[]} paths - the places of config.json, in order
 * @returns {{ path: (string|null), config: object }} the file's path and
 *   content, or null and {} when none exists
 * @throws {Error} naming the file, when it cannot be read or parsed, or holds
 *   no JSON object
 */
function readConfigFile(paths) {
  const configPath = paths.find((candidate) => fs.existsSync(candidate));
  if (!configPath) {
    return { path: null, config: {} };
  }
  let config;
  try {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (err) {
    throw new Error(`${configPath} cannot be read as JSON: ${err.message}`);
  }
  if (typeof config !== 'object' || config === null || Array.isArray(config)) {
    throw new Error(`${configPath} must hold a JSON object`);
  }
  return { path: configPath, config };
}

module.exports = { readConfigFile };
