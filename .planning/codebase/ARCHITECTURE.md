# Architecture

**Analysis Date:** 2026-01-25

## Pattern Overview

**Overall:** Multi-workspace monorepo with layered architecture

**Key Characteristics:**
- Monorepo with separate workspaces for distinct concerns (cli, data, server, dashboard)
- Backend-for-frontend pattern with REST API boundary
- Data layer with centralized database access through module exports
- Optional OIDC authentication layer with session management
- Single-page application (SPA) frontend with client-side state management

## Layers

**Presentation Layer (Frontend):**
- Purpose: Interactive React dashboard for cost visualization and analysis
- Location: `dashboard/src/`
- Contains: React components, pages, hooks, API client services, i18n translations
- Depends on: REST API endpoints in server layer, localStorage for state
- Used by: End users viewing dashboards and reports

**API Layer (Backend):**
- Purpose: REST API providing billing data access and analysis
- Location: `server/index.js`
- Contains: Express route handlers for all endpoints, middleware pipeline
- Depends on: Data layer (`db` module), authentication module, configuration
- Used by: Dashboard frontend, external API consumers

**Data Access Layer:**
- Purpose: SQLite database abstraction and query builders
- Location: `data/db.js`
- Contains: CRUD operations for projects, bills, details, analysis queries
- Depends on: better-sqlite3, schema definitions in `data/schema.sql`
- Used by: API layer (server/index.js), import scripts

**Authentication Layer:**
- Purpose: Optional OIDC authentication and session management
- Location: `server/auth/`
- Contains: OIDC client initialization, session store, auth middleware, routes
- Depends on: Configuration, database (sessions table), openid-client library
- Used by: Server middleware pipeline, can be disabled via configuration

**CLI/Import Layer:**
- Purpose: Command-line tools for bulk operations
- Location: `cli/`, `data/import.js`
- Contains: OVH API integration, bill download, CSV splitting, data import
- Depends on: OVH SDK, database layer, file system
- Used by: Scheduled imports, manual data synchronization

## Data Flow

**Web Application Data Flow:**

1. User opens dashboard → Browser requests `/` (SPA)
2. Server serves built React app from `dashboard/dist/`
3. React app mounted → Calls `/api/config` and `/api/user` endpoints
4. API routes in `server/index.js` query database via `data/db.js`
5. Database returns JSON response → Rendered in React components using Recharts
6. User selects month/period → API calls with date parameters
7. Data aggregated via analysis queries (byProject, byService, trends)
8. Charts and tables re-render with new data

**Authentication Flow (OIDC enabled):**

1. Unauthenticated user hits protected route → Redirected to `/auth/login`
2. Auth middleware (`server/auth/middleware.js`) checks session cookie
3. No session → Redirect to OIDC provider login
4. Post-login → OIDC callback creates session in `sessions` table
5. Session cookie set → Subsequent requests authenticated
6. API middleware attached user info to `req.user`
7. Back-channel logout → Provider notifies `/logout/backchannel`, session deleted

**Fallback Authentication Flow (Header-based SSO):**

1. Reverse proxy injects `Auth-User`, `Auth-Mail`, `Auth-CN` headers
2. Fallback middleware (`server/index.js` lines 71-90) reads headers
3. `req.user` populated if `Auth-User` header present
4. If `AUTH_REQUIRED=true`, unauthenticated requests return 401

**Data Import Flow:**

1. CLI tool invoked: `npm run import` (or `--full`, `--diff`)
2. `data/import.js` reads OVH API credentials from config
3. Fetches `/me/bill` endpoint with date filters
4. For each bill, fetches details and projects
5. Classifies services (Compute, Storage, Network, Database, AI/ML)
6. Batches insert into database via `db.details.insertMany()`
7. Logs import status to `import_log` table
8. Server API reflects new data on next request

## State Management

**Frontend State:**
- Local component state: month selection, active tabs, sort configurations
- React Query: Server state cached from API responses
- No global state manager (Redux/Zustand) - data flows through component hierarchy

**Backend State:**
- SQLite database: Persistent bills, projects, details, sessions, import logs
- In-memory config: Loaded once at startup, merged from multiple config paths
- OIDC client: Singleton initialized during server startup, reused for all requests

## Key Abstractions

**Database Module (`data/db.js`):**
- Purpose: Hide SQL complexity, provide simple object-oriented interface
- Exports: Named objects for projects, bills, details, importLog, analysis
- Example: `db.analysis.byProject(from, to)` returns aggregated cost data
- Pattern: Each object exports static methods for common operations

**API Routes:**
- Purpose: Map HTTP methods + paths to controller logic
- Location: Inline in `server/index.js` within `registerRoutes()` function
- Pattern: No separate controller layer - route handler logic directly in endpoint
- Example: `app.get('/api/analysis/by-project', ...)` contains all query/response logic

**Authentication Middleware:**
- Purpose: Attach user identity to request; enforce authentication boundaries
- Location: `server/auth/middleware.js` and `server/index.js` lines 71-90
- Pattern: Express middleware chaining - two possible implementations (OIDC or header-based)
- Composable: Mounted in `initializeServer()` before route registration

## Entry Points

**CLI Entry Point (`cli/index.js`):**
- Location: `cli/index.js`
- Triggers: `npm run cli` (download bills), `npm run split` (split by project)
- Responsibilities: Parse CLI args, load OVH credentials, query OVH API, stream PDF/HTML downloads
- Entry flow: Validates `--from` date → Fetches bill list → Downloads each bill sequentially

**Server Entry Point (`server/index.js`):**
- Location: `server/index.js`
- Triggers: `npm start` or `npm run dev:server`
- Responsibilities: Initialize Express app, set up middleware, configure auth, register routes, bind port
- Async initialization: Calls `initializeServer()` which sets up OIDC before listening
- Execution: Logs all endpoints and auth config, then listens on PORT (default 3001)

**Frontend Entry Point (`dashboard/src/main.jsx`):**
- Location: `dashboard/src/main.jsx`
- Triggers: Vite dev server or built SPA served by Express
- Responsibilities: Mount React app to DOM, initialize React Query
- Bootstraps: `<App />` → `<Dashboard />` component with all data fetching

**Data Import Entry Point (`data/import.js`):**
- Location: `data/import.js`
- Triggers: `npm run import`, `npm run import:full`, `npm run import:diff`
- Responsibilities: Parse CLI args, load OVH credentials, fetch OVH API, batch insert to database
- Optional modes: `--full` (clear & reimport all), `--diff` (delta since last), `--from`/`--to` (specific period)

## Error Handling

**Strategy:** Try-catch in route handlers, error responses to client; no global error middleware

**Patterns:**
- HTTP Status Codes: 400 (missing params), 401 (auth required), 404 (not found), 500 (server error)
- Error Response Format: `{ error: "descriptive message" }` as JSON
- Logging: Console.log timestamps with user ID (if authenticated)
- Database Errors: Caught, wrapped in 500 response, message logged
- OVH API Errors: Caught in Promise.catch(), logged, process exits with code 1
- Validation: Manual checks for required query params (from, to), return 400 if missing

## Cross-Cutting Concerns

**Logging:**
- Console.log with timestamps and user ID in `server/index.js` middleware (line 94-97)
- OVH API errors logged in `cli/index.js` (lines 220-227)
- Import progress logged to console by `data/import.js`

**Configuration:**
- Multi-path search: project root `config.json` → home `~/my-ovh-bills/config.json` → legacy credentials
- Merged with environment variables: `OIDC_*`, `PORT`, `TRUST_PROXY`, `AUTH_REQUIRED`
- Fallback defaults: budget 50000, currency EUR, session maxAge 24h

**Authentication:**
- Two implementations: OIDC (primary) or header-based SSO (fallback)
- Optional: Can be disabled via config/env
- Session expiry: Configurable, default 24 hours
- Back-channel logout supported (OIDC) for remote logout initiated by IdP

---

*Architecture analysis: 2026-01-25*
