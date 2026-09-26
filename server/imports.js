// Whether the server runs imports, the resync's included: IMPORT_ENABLED=false turns them
// off, as it does the periodic import of scripts/cron-import.sh. The resync route refuses
// to start one then, and /api/config tells the dashboard, which reads it to offer the
// resync or not (#51).

/**
 * @param {NodeJS.ProcessEnv} [env] - The environment to read, the server's by default
 * @returns {boolean} False only when IMPORT_ENABLED is "false"
 */
function importsEnabled(env = process.env) {
  return env.IMPORT_ENABLED !== 'false';
}

module.exports = { importsEnabled };
