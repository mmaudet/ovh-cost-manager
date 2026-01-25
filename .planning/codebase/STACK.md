# Technology Stack

**Analysis Date:** 2026-01-25

## Languages

**Primary:**
- JavaScript (Node.js) - All backend services and CLI tools
- JSX/JavaScript - React frontend (dashboard)

**Secondary:**
- SQL - Database schema and queries via `better-sqlite3`

## Runtime

**Environment:**
- Node.js (no specific version pinned, compatible with modern LTS)
- Package Manager: npm (npm workspaces used for monorepo structure)
- Lockfile: `package-lock.json` (present, lockfileVersion 3)

## Frameworks

**Backend/Server:**
- Express.js ^4.18.2 - REST API server (`server/index.js`)
- openid-client ^6.1.7 - OIDC authentication provider integration

**Frontend:**
- React ^18.2.0 - UI framework (React with functional components)
- Vite ^5.0.0 - Build tool and dev server

**Charting/Visualization:**
- Recharts ^2.10.0 - Interactive charts and data visualization

**CLI:**
- Minimist ^1.2.5 - Command-line argument parsing

**State Management:**
- TanStack React Query (React Query) ^5.0.0 - Server state management and data fetching

## Key Dependencies

**Critical:**
- ovh ^2.0.3 - OVH API client for billing data integration (used in `cli/index.js`, `data/import.js`)
- better-sqlite3 ^11.0.0 - Embedded SQLite database for local data persistence (`data/db.js`)
- jsonfile ^6.1.0 - JSON file read/write operations for credentials and configuration

**HTTP/API:**
- axios ^1.6.0 - HTTP client for dashboard API communication
- express ^4.18.2 - HTTP server framework
- cors ^2.8.5 - CORS middleware for API endpoints
- cookie-parser ^1.4.6 - Cookie parsing for session management

**Utilities:**
- uuid ^9.0.0 - UUID generation for session identifiers

## Frontend Build/Dev Stack

**Build Tools:**
- @vitejs/plugin-react ^4.2.0 - React support for Vite
- Tailwind CSS ^3.3.0 - Utility-first CSS framework
- PostCSS ^8.4.31 - CSS transformation tool
- Autoprefixer ^10.4.16 - Vendor prefix automation

**Utilities:**
- postcss-nested - Nesting support for Tailwind

## Configuration

**Environment Variables:**
- PORT - Server port (defaults to 3001)
- TRUST_PROXY - Enable proxy header trust for reverse proxy deployments
- AUTH_REQUIRED - Require authentication for API endpoints (default: false)
- HOME - User home directory (used for credential/config file locations)

**Configuration Files:**
- `/config.json` (root) or `~/my-ovh-bills/config.json` - Application configuration
  - Contains: OVH API credentials, OIDC provider settings, dashboard budget/currency
  - Fallback paths for flexibility in deployment (Docker, local development)

**Credentials Handling:**
- OVH API credentials stored in `credentials.json` (legacy format)
- Credentials with three required fields: `appKey`, `appSecret`, `consumerKey`
- Location: `~/my-ovh-bills/credentials.json` (default) or specified via `--credentials` flag

**Default Paths:**
- User data: `$HOME/my-ovh-bills/`
- Database: `data/ovh-bills.db` (SQLite)
- Bill output: `$HOME/my-ovh-bills/{YEAR}/` (CLI)

## Build System

**Development:**
- Vite development server with hot reload (dashboard)
- Node.js --watch mode for server development (`npm run dev:server`)
- Concurrently for running multiple dev servers simultaneously

**Production:**
- Vite build for static dashboard bundle (`npm run build`)
- Express server runs Node.js directly (no bundling step for backend)

**Scripts (Root Workspace):**
- `npm run cli` - Run CLI tool for bill downloads
- `npm run split` - Split bills by project
- `npm run bills` - Analyze bills by project
- `npm run import` - Import bills from OVH API into database
- `npm run import:full` - Full reimport (clears existing data)
- `npm run import:diff` - Differential import since last import
- `npm run dev:server` - Start API server in watch mode
- `npm run dev:dashboard` - Start dashboard dev server
- `npm run dev` - Run both server and dashboard concurrently
- `npm run build` - Build dashboard for production
- `npm run start` - Start API server (production mode)

## Database

**Type:** SQLite (embedded)
**Client:** better-sqlite3 (synchronous, no async overhead)
**Location:** `data/ovh-bills.db`
**Configuration:**
- WAL mode enabled for concurrent access: `PRAGMA journal_mode = WAL`
- Foreign key constraints enabled: `PRAGMA foreign_keys = ON`
- Schema initialization: Runs `data/schema.sql` on connection

**Schema Tables:**
- `projects` - OVH cloud projects metadata
- `bills` - Bill records with pricing and URLs
- `bill_details` - Line-item details for each bill
- `import_log` - History and statistics of import operations

## Monorepo Structure

**Workspaces (npm workspaces):**
1. `cli/` - Command-line tools for bill management (@ovh-cost-manager/cli)
2. `data/` - Database layer and data import scripts (@ovh-cost-manager/data)
3. `server/` - Express API server (@ovh-cost-manager/server)
4. `dashboard/` - React frontend dashboard (@ovh-cost-manager/dashboard)

Each workspace has independent `package.json` with its own dependencies.

## Platform Requirements

**Development:**
- Node.js LTS or later (modern versions with ES2020+ support)
- npm 7+ (for npm workspaces support)
- Python (for better-sqlite3 native compilation on some systems)
- C++ compiler/build tools (for better-sqlite3 native module)

**Production:**
- Node.js LTS runtime
- SQLite support (built into better-sqlite3)
- HTTP server infrastructure (can run behind reverse proxy)

---

*Stack analysis: 2026-01-25*
