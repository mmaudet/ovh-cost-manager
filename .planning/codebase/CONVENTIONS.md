# Coding Conventions

**Analysis Date:** 2026-01-25

## Naming Patterns

**Files:**
- JavaScript modules use lowercase with hyphens: `session-store.js`, `oidc-client.js`, `split-by-project.js`
- JSX components use PascalCase: `Logo.jsx`, `Dashboard.jsx`, `App.jsx`
- Entry point files: `index.js` for module exports
- Database file: `db.js` for database operations
- Import scripts: `import.js` for data import functionality

**Functions:**
- camelCase for all function names: `parseArgs()`, `classifyService()`, `fetchProjects()`, `createAuthMiddleware()`
- Async functions declared with `async` keyword: `async function fetchProjects()`
- Promise-based patterns with `.then()/.catch()` chains or async/await

**Variables:**
- camelCase for local variables and constants: `importType`, `fromDate`, `pendingAuth`, `authConfig`
- UPPERCASE for module-level constants: `DB_PATH`, `SCHEMA_PATH`, `API_BASE`, `HIST_FILE`, `APP_DATA`
- Underscore_case for database column names: `project_id`, `bill_id`, `price_without_tax`, `user_info`
- Shorthand imports with capitalized names: `Path`, `Fs`, `Jsonfile`, `Database` (following Node.js `require()` conventions)

**Types:**
- No TypeScript; plain JavaScript throughout
- JSDoc comments for function documentation: `@returns`, `@param`, etc.
- Object property names in camelCase when accessed in code (mapped from snake_case in DB)

## Code Style

**Formatting:**
- No automatic formatter detected (no Prettier or ESLint config)
- Indentation: 2 spaces (consistently applied)
- Line length: no strict limit observed; code goes beyond 80 characters
- Semicolons: used at end of statements
- Curly braces: opening brace on same line (Allman style not used)

**Linting:**
- No linter configuration found (.eslintrc* or similar missing)
- No build step; code runs as-is with Node.js

**Comments:**
- JSDoc comments on functions with description and usage examples
- Inline comments for non-obvious logic: `// Cleanup after 10 minutes`, `// Handle 401 responses - redirect to login if OIDC is enabled`
- Commented-out code preserved: `//console.log("BILLS", bills);` in `cli/index.js`
- Comments are sparse; only critical sections documented

## Import Organization

**Order:**
1. Node.js built-in modules (e.g., `require('path')`, `require('fs')`)
2. Third-party npm packages (e.g., `require('express')`, `require('better-sqlite3')`)
3. Local application modules (e.g., `require('../data/db')`, `require('./auth')`)
4. No blank line separation between groups; imports mixed together

**Path Aliases:**
- No path aliases configured
- Relative paths used throughout: `../data/db`, `./auth`, `../i18n/translations`
- Absolute paths for environment-based paths: `path.resolve(process.env.HOME, 'my-ovh-bills')`

**Examples from codebase:**
```javascript
// server/index.js
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const path = require('path');
const fs = require('fs');
const db = require('../data/db');
const auth = require('./auth');
```

```javascript
// dashboard/src/services/api.js (ESM)
import axios from 'axios';
```

## Error Handling

**Patterns:**
- Try/catch blocks for synchronous errors and promise rejection: `try { ... } catch (e) { ... }`
- `.catch()` chains on promises: `ovh.requestPromised().catch(err => { ... })`
- Error logging with `console.error()`: `console.error('OIDC callback error:', err.message);`
- Process exit on fatal errors: `process.exit(1)` or `exit(1)`
- HTTP errors returned as JSON: `res.status(500).json({ error: err.message })`
- Validation errors return status codes: `res.status(400).json({ error: 'from and to parameters required' })`
- No custom error classes; plain Error messages used

**Examples:**
```javascript
// data/import.js
try {
  const loadedConfig = Jsonfile.readFileSync(configPath);
  // ...
  configLoaded = true;
  break;
} catch (e) {
  // Try next path
}

if (!configLoaded) {
  console.error('Error: No valid configuration file found.');
  process.exit(1);
}
```

```javascript
// server/index.js
app.get('/api/bills', (req, res) => {
  try {
    const { from, to } = req.query;
    const bills = db.bills.getAll(from, to);
    res.json(bills);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
```

## Logging

**Framework:** `console` object directly

**Patterns:**
- `console.log()` for informational messages
- `console.error()` for errors and warnings
- Logged at major milestones: initialization, fetching data, processing steps
- Progress shown with `process.stdout.write()` for inline status: `process.stdout.write(`  [${i + 1}/${billIds.length}] ${billId}...`)`
- Timestamps added manually when needed: `new Date().toISOString()`
- No structured logging; all messages are plain strings

**Examples from codebase:**
```javascript
// server/index.js
console.log(`${new Date().toISOString()} [${user}] ${req.method} ${req.path}`);

// data/import.js
console.log('Fetching cloud projects...');
console.log(`  Found ${projects.length} projects`);
console.error(`  Error fetching project ${id}: ${err.message}`);
```

## Function Design

**Size:** Functions range from 5-50 lines; no strict limit enforced. Larger functions (100+ lines) used for route handlers that combine logic.

**Parameters:**
- Functions accept between 0-3 parameters
- Object destructuring used for extracting specific values: `const { from, to } = req.query`
- Default values provided inline: `months = 6` in function parameters
- Variadic parameters avoided; use arrays or objects instead

**Return Values:**
- Functions return values directly or via callback
- Promises returned from async functions
- Routes return response objects via Express: `res.json()`, `res.status().json()`, `res.redirect()`
- Database operations return statement results or row data
- No explicit `return` for undefined results; implicit undefined returned

**Examples:**
```javascript
// data/import.js - Small focused function
function classifyService(description) {
  const desc = (description || '').toLowerCase();
  if (desc.includes('instance') || desc.includes('compute')) {
    if (desc.includes('gpu')) return 'AI/ML';
    return 'Compute';
  }
  // ... more conditions
  return 'Other';
}

// server/index.js - Route handler with destructuring
app.get('/api/analysis/by-project', (req, res) => {
  try {
    const { from, to } = req.query;
    if (!from || !to) {
      return res.status(400).json({ error: 'from and to parameters required' });
    }
    // ... logic
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
```

## Module Design

**Exports:**
- CommonJS modules use `module.exports = { ... }` with named exports
- Object patterns for related functions: `{ upsert, getAll, getById }`
- Database operations exposed as object with method names: `db.projects.getAll()`, `db.bills.upsert()`
- Single default export for entry points: middleware, auth module, hook functions

**Barrel Files:**
- Not consistently used
- `server/auth/index.js` acts as barrel, re-exporting from sub-modules
- Most modules import directly from specific files

**Examples:**
```javascript
// server/auth/index.js - Barrel export
module.exports = {
  buildAuthConfig,
  initialize,
  createAuthMiddleware,
  setupRoutes: routes.setup,
  backChannelLogout: routes.backChannelLogout,
  sessionStore
};

// data/db.js - Grouped operations
const projectOps = {
  upsert: (project) => { ... },
  getAll: () => { ... },
  getById: (id) => { ... }
};

module.exports = {
  getDb,
  closeDb,
  projects: projectOps,
  bills: billOps,
  // ... more groups
};
```

## Database Patterns

**Operations:**
- SQLite with `better-sqlite3` for synchronous database access
- Prepared statements with parameterized queries: `db.prepare('SELECT * FROM projects WHERE id = ?').get(id)`
- Named parameters in some queries: `INSERT INTO ... VALUES (@id, @name, ...)`
- UPSERT pattern for data synchronization: `INSERT ... ON CONFLICT(id) DO UPDATE SET ...`

**File Locations:**
- Database schema: `data/schema.sql`
- Database operations: `data/db.js`
- Database file: `data/ovh-bills.db` (not in repo, generated at runtime)

---

*Convention analysis: 2026-01-25*
