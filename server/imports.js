// Whether the server runs imports, the resync's included: IMPORT_ENABLED=false turns them
// off, as it does the periodic import of scripts/cron-import.sh. The resync route refuses
// to start one then, and /api/config tells the dashboard, which reads it to offer the
// resync or not (#51).
const { parseBoolean } = require('./settings');

/**
 * Reads IMPORT_ENABLED as the other true/false settings: true or false, in any case.
 * The server reads it at startup too, and stops on any other value.
 *
 * @param {NodeJS.ProcessEnv} [env] - The environment to read, the server's by default
 * @returns {boolean} False when IMPORT_ENABLED is false, true when it is true, empty or unset
 * @throws {Error} naming IMPORT_ENABLED, for any other value
 */
function importsEnabled(env = process.env) {
  return parseBoolean(env.IMPORT_ENABLED, { name: 'IMPORT_ENABLED' }) ?? true;
}

module.exports = { importsEnabled };
