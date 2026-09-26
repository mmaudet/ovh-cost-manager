/**
 * Preloaded (node --require) in the server that the OIDC tests start: hides
 * the config.json at the root of the repository, which may hold a
 * developer's real settings, so that the server reads nothing but the
 * environment of the test.
 */

const fs = require('fs');
const path = require('path');

const repoConfig = path.resolve(__dirname, '..', '..', 'config.json');
const { existsSync } = fs;

fs.existsSync = (file) => path.resolve(String(file)) !== repoConfig && existsSync(file);
