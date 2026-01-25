# Codebase Structure

**Analysis Date:** 2026-01-25

## Directory Layout

```
ovh-cost-manager/
├── cli/                          # CLI tools for bill downloads and data splitting
│   ├── package.json              # CLI workspace package.json
│   ├── index.js                  # Main bill download tool
│   ├── split-by-project.js       # Split CSV by project
│   └── bills-by-project.js       # Generate project-specific reports
├── data/                         # Data layer and import scripts
│   ├── package.json              # Data workspace package.json
│   ├── db.js                     # SQLite database abstraction and queries
│   ├── import.js                 # OVH API data import orchestrator
│   ├── schema.sql                # SQLite schema definitions
│   └── ovh-bills.db              # SQLite database file (generated)
├── server/                       # Backend Express server
│   ├── package.json              # Server workspace package.json
│   ├── index.js                  # Express server, route registration, middleware
│   └── auth/                     # OIDC authentication module
│       ├── index.js              # Auth initialization and configuration builder
│       ├── oidc-client.js        # OpenID Connect client wrapper
│       ├── session-store.js      # SQLite session persistence
│       ├── routes.js             # Auth endpoints (/auth/login, /auth/callback, /auth/logout)
│       └── middleware.js         # Authentication middleware for requests
├── dashboard/                    # Frontend React application
│   ├── package.json              # Dashboard workspace package.json
│   ├── index.html                # Entry HTML file
│   ├── vite.config.js            # Vite bundler configuration
│   ├── tailwind.config.js        # Tailwind CSS configuration
│   ├── postcss.config.js         # PostCSS plugins (Tailwind)
│   ├── src/
│   │   ├── main.jsx              # React app bootstrap (mounts to #app)
│   │   ├── App.jsx               # Root component wrapper
│   │   ├── pages/
│   │   │   └── Dashboard.jsx     # Main dashboard page with all features
│   │   ├── components/
│   │   │   └── Logo.jsx          # SVG logo component
│   │   ├── hooks/
│   │   │   └── useLanguage.jsx   # i18n hook for language switching (en/fr)
│   │   ├── services/
│   │   │   └── api.js            # Axios API client with all fetch functions
│   │   ├── i18n/
│   │   │   └── translations.js   # French/English translation strings
│   │   └── index.css             # Global styles (imported in main.jsx)
│   ├── public/                   # Static assets (logo, favicon)
│   └── dist/                     # Production build output (generated)
├── package.json                  # Root monorepo package.json with workspaces
├── config.json                   # Application configuration (env vars override)
├── config.example.json           # Configuration template
├── credentials.json              # OVH API credentials (dev only, in .gitignore)
├── docker-compose.yml            # Docker compose for development
├── docker-compose.sso.yml        # Docker compose with OIDC SSO setup
├── Dockerfile                    # Multi-stage Docker build
├── README.md                     # Project documentation
├── CONTRIBUTING.md               # Contributing guidelines
├── CLAUDE.md                     # Instructions for Claude
├── .gitignore                    # Git ignore patterns
├── .github/workflows/            # GitHub Actions CI/CD
├── docs/                         # Documentation and screenshots
└── .planning/codebase/           # GSD analysis documents (this directory)
```

## Directory Purposes

**cli/:**
- Purpose: Standalone command-line tools for OVH bill operations
- Contains: Bill download script, CSV split utilities, project-based reports
- Key files: `cli/index.js` (main entry), `cli/split-by-project.js` (project filtering)

**data/:**
- Purpose: Centralized data persistence and API integration layer
- Contains: SQLite database module, import orchestrator, schema definitions
- Key files: `data/db.js` (query interface), `data/import.js` (OVH API connector), `data/schema.sql` (table definitions)

**server/:**
- Purpose: Express backend serving REST API and optional OIDC authentication
- Contains: Route handlers, authentication module, session management
- Key files: `server/index.js` (main server), `server/auth/index.js` (OIDC setup)

**dashboard/:**
- Purpose: React SPA for interactive cost analysis and visualization
- Contains: React components, data fetching services, translations, styling
- Key files: `dashboard/src/pages/Dashboard.jsx` (main page), `dashboard/src/services/api.js` (API client)

## Key File Locations

**Entry Points:**
- `cli/index.js`: CLI bill downloader - entry point for `npm run cli`
- `server/index.js`: Express server - entry point for `npm start`
- `dashboard/src/main.jsx`: React bootstrap - entry point for SPA
- `data/import.js`: Data importer - entry point for `npm run import`

**Configuration:**
- `config.json`: Runtime config (dashboard budget, currency, auth settings)
- `config.example.json`: Config template with all possible keys
- `credentials.json`: OVH API credentials (not committed, local only)
- `dashboard/vite.config.js`: Frontend build configuration

**Core Logic:**
- `data/db.js`: All database queries and operations (350 lines of organized exports)
- `server/index.js`: All REST endpoints and middleware setup (463 lines)
- `dashboard/src/pages/Dashboard.jsx`: Main UI logic, state management, data fetching
- `data/schema.sql`: Database schema (projects, bills, details, sessions, import_log)

**Testing:**
- No test files present (testing coverage not configured)

## Naming Conventions

**Files:**
- `index.js`: Module entry point (exports public API)
- `<feature>.js`: Feature or module implementation
- `.jsx`: React component files
- `<name>.sql`: SQL schema and migrations

**Directories:**
- Lowercase with no underscores: `cli/`, `data/`, `server/`, `dashboard/`
- Grouped by responsibility: `pages/`, `components/`, `services/`, `hooks/`, `auth/`

**Code**
- Functions: camelCase, descriptive names (e.g., `generateMarkdownSummary`, `classifyService`)
- Constants: UPPER_SNAKE_CASE (e.g., `APP_DATA`, `DB_PATH`, `SCHEMA_PATH`)
- Variables: camelCase (e.g., `selectedMonth`, `authConfig`)

## Where to Add New Code

**New REST Endpoint:**
- Implementation: Add `app.get/post/put/delete('/api/path', (req, res) => {...})` in `server/index.js` within `registerRoutes()` function (lines 138-454)
- Tests: None configured - would go in test files (not present)
- Documentation: Add endpoint to server startup log (lines 120-129)

**New Database Query:**
- Implementation: Export new method from appropriate object in `data/db.js` (projects, bills, details, analysis, importLog)
- Pattern: Use `db.prepare()` for prepared statements, return `.all()` or `.get()`
- Example: Add to `analysisOps` object if it's an aggregate query

**New Frontend Component:**
- Implementation: Create `.jsx` file in `dashboard/src/components/`
- Integrate: Import and use in `dashboard/src/pages/Dashboard.jsx`
- Styling: Use Tailwind classes inline (no CSS files except global index.css)

**New Page/Feature:**
- Frontend files: `dashboard/src/pages/<Feature>.jsx` for page, `dashboard/src/services/api.js` for API calls
- Backend: Add endpoints to `server/index.js`
- Database: Update `data/db.js` and `data/schema.sql` if new tables needed
- Import script: Add to `data/import.js` if data fetching from OVH required

**New CLI Tool:**
- Location: `cli/<tool-name>.js`
- Export executable command via shebang `#!/usr/bin/env node` at top
- Package.json: Add script entry in `cli/package.json` or root `package.json`
- Dependencies: Use minimist for argument parsing, jsonfile for config

**Shared Utilities:**
- Backend helpers: Add to `data/db.js` or create `server/utils/<name>.js`
- Frontend hooks: Add to `dashboard/src/hooks/` (reusable React logic)
- Configuration: Modify config merging logic in `server/index.js` lines 14-31

## Special Directories

**node_modules/:**
- Purpose: NPM dependencies
- Generated: Yes (created by `npm install`)
- Committed: No (in .gitignore)

**data/ovh-bills.db:**
- Purpose: SQLite database file storing all imported billing data
- Generated: Yes (created on first import)
- Committed: No (in .gitignore)

**dashboard/dist/:**
- Purpose: Production build output of React SPA
- Generated: Yes (created by `npm run build`)
- Committed: No (in .gitignore)

**demo/sso/:**
- Purpose: Docker-based SSO provider demo (Keycloak)
- Generated: No
- Committed: Yes (development reference)

**.planning/codebase/:**
- Purpose: GSD analysis documents
- Generated: Yes (created by GSD tools)
- Committed: Yes (development reference)

---

*Structure analysis: 2026-01-25*
