# External Integrations

**Analysis Date:** 2026-01-25

## APIs & External Services

**OVH Cloud Billing API:**
- Service: OVHcloud REST API (https://eu.api.ovh.com/)
- What it's used for: Fetching billing data, bills, bill details, and cloud projects
- SDK/Client: `ovh` npm package (v2.0.3)
- Authentication: OAuth1a with credentials (appKey, appSecret, consumerKey)
- Usage locations:
  - `cli/index.js` - Downloads bills by date range via `/me/bill` endpoint
  - `data/import.js` - Imports projects (`/cloud/project`) and bill details (`/me/bill/{id}/details`)
- Key endpoints:
  - `GET /me/bill` - List bills with date range filtering
  - `GET /me/bill/{billId}` - Get single bill metadata (prices, URLs)
  - `GET /me/bill/{billId}/details` - Get bill line items
  - `GET /cloud/project` - List cloud projects
  - `GET /cloud/project/{id}` - Get project metadata
- Rate limiting: API-enforced, handled by ovh client library
- Fallback: None (if OVH API unavailable, import/CLI operations fail)

**PDF/HTML Bill Downloads:**
- Service: OVH (HTTPS file servers)
- What it's used for: Download bill documents (PDF or HTML format)
- Method: Direct HTTPS GET requests
- URLs provided by: `/me/bill/{billId}` endpoint (pdfUrl and url fields)
- Handled in: `cli/index.js` (getBill function, lines 159-206)
- Failure mode: Logs error, continues with next bill

## Data Storage

**Databases:**
- Type: SQLite (embedded)
- Provider: Local filesystem
- Client: better-sqlite3 ^11.0.0
- Connection: `data/db.js` (getDb/closeDb functions)
- Location: `data/ovh-bills.db`
- Schema: `data/schema.sql`

**File Storage:**
- Local filesystem only (no cloud storage)
- Bill PDFs/HTML: Downloaded to `$HOME/my-ovh-bills/{YEAR}/` or custom `--output` directory
- Database: `data/ovh-bills.db` in project root
- Credentials: `$HOME/my-ovh-bills/credentials.json` or `config.json`
- Metadata: JSON files alongside bills when `--json` flag used (cli/index.js, lines 181-186)

**Caching:**
- React Query (TanStack) - In-memory caching of API responses (dashboard)
  - Configured in `dashboard/src/services/api.js`
  - Automatic background refetch on stale intervals
- No server-side caching layer

## Authentication & Identity

**Auth Provider:**
- Type: OIDC (OpenID Connect) with fallback to proxy headers
- Primary: openid-client v6.1.7 for OAuth/OIDC flows
- Implementation:
  - `server/auth/oidc-client.js` - OIDC client initialization and flows
  - `server/auth/index.js` - Auth module setup and middleware
  - `server/auth/routes.js` - Login/callback/logout endpoints
  - `server/auth/middleware.js` - Auth middleware for protected routes
  - `server/auth/session-store.js` - Session persistence

**OIDC Configuration (when enabled):**
- Configured via `config.json`:
  - `auth.provider.issuer` - OIDC provider URL
  - `auth.provider.clientId` - OIDC client ID
  - `auth.provider.clientSecret` - OIDC client secret
  - `auth.provider.scopes` - Requested scopes (e.g., openid, profile, email)
  - `auth.baseUrl` - Application base URL for redirect URIs
- Callback: `{baseUrl}/auth/callback`
- Back-channel logout: `POST /logout/backchannel` (OIDC RP-initiated logout)

**Fallback Authentication (no OIDC):**
- Reverse proxy headers (LemonLDAP::NG style):
  - `auth-user` - Username/ID
  - `auth-mail` - Email address
  - `auth-cn` - Common name
- Enabled when OIDC provider not configured
- AUTH_REQUIRED environment variable controls if auth is mandatory (default: false)
- Header extraction in `server/index.js` (lines 71-91)

**Session Management:**
- Cookies: HTTP-only, secure cookies with SameSite protection
- Session store: Optional persistent store (cookieParser middleware)
- Cookie parser: cookie-parser ^1.4.6 middleware in Express
- UUID generation: uuid ^9.0.0 for session identifiers

## Monitoring & Observability

**Error Tracking:**
- Not detected - No integration with Sentry, LogRocket, or similar

**Logs:**
- Console logging via `console.log()` and `console.error()`
- Server request logging: ISO timestamp, user ID, method, path
  - Implementation: `server/index.js` (lines 94-98)
- OVH API call logging: Error messages from ovh client library
- CLI tool: Logs progress and errors to stdout/stderr

**Debugging:**
- process.env.DEBUG not used
- No structured logging framework (plain console)

## CI/CD & Deployment

**Hosting:**
- Self-hosted or Docker container deployment (no lock-in to specific platform)
- Reverse proxy support: TRUST_PROXY environment variable for headers

**CI Pipeline:**
- Not detected - No GitHub Actions, GitLab CI, or Travis CI configuration found

**Docker:**
- Dockerfile present: `/Users/mmaudet/work/ovh-cost-manager/Dockerfile`
- Docker Compose:
  - `docker-compose.yml` - Basic deployment
  - `docker-compose.sso.yml` - Deployment with OIDC SSO (includes reverse proxy + OIDC provider simulation)
- Container runs both server and dashboard from single Node.js image
- Port: 3000 (dashboard), 3001 (API server)

**Deployment Environment Variables:**
- PORT - Server port
- TRUST_PROXY - Trust proxy headers (true/false)
- AUTH_REQUIRED - Require auth (true/false, default: false)
- HOME - Home directory for credential/data paths

## Environment Configuration

**Required environment variables:**
- HOME - User home directory (for credential/data file locations)

**Optional environment variables:**
- PORT - Server port (default: 3001)
- TRUST_PROXY - Enable proxy header trust (default: unset/false)
- AUTH_REQUIRED - Require authentication (default: false)

**Configuration files:**
- `/config.json` (project root) - Primary config location
- `~/my-ovh-bills/config.json` - User data directory config
- `~/my-ovh-bills/credentials.json` - Legacy credentials (for backward compatibility)
- `.env` files - Not used (no dotenv integration detected)

**Secrets location:**
- OVH API credentials: `config.json` or `credentials.json` (contains appKey, appSecret, consumerKey)
- OIDC client secret: `config.json` under `auth.provider.clientSecret`
- No .env file usage or environment variable expansion
- Credentials must be manually created or populated via config files

**Configuration Example (config.json):**
```json
{
  "credentials": {
    "appKey": "your-app-key",
    "appSecret": "your-app-secret",
    "consumerKey": "your-consumer-key"
  },
  "auth": {
    "enabled": true,
    "provider": {
      "issuer": "https://oidc-provider.example.com",
      "clientId": "your-client-id",
      "clientSecret": "your-client-secret",
      "scopes": ["openid", "profile", "email"]
    },
    "baseUrl": "https://app.example.com"
  },
  "dashboard": {
    "budget": 50000,
    "currency": "EUR"
  }
}
```

## Webhooks & Callbacks

**Incoming:**
- OIDC Callback: `GET /auth/callback` (handles OAuth2 authorization code)
- Back-Channel Logout: `POST /logout/backchannel` (OIDC RP-Initiated logout)

**Outgoing:**
- None detected - No outbound webhooks to external systems

## API Rate Limiting

**OVH API:**
- Enforced by OVH platform
- Handled transparently by ovh client library
- No rate limiting strategy implemented in application code
- Differential imports (`--diff`) intended to minimize calls

## Data Import/Export

**Import Methods:**
1. **CLI Download** (`cli/index.js`):
   - Downloads bills as PDF/HTML files
   - Saves metadata as JSON (with `--json` flag)
   - No database persistence from CLI alone

2. **Data Layer** (`data/import.js`):
   - Fetches bills and details from OVH API
   - Parses and classifies service types
   - Stores in SQLite database
   - Three modes: full, period, differential
   - Command: `npm run import --from 2025-01-01 --to 2025-12-31`

**Export:**
- Dashboard API endpoints (server/api routes) expose data in JSON
- Bills and analysis queryable via REST endpoints
- No bulk export to CSV/Excel (dashboard-level only)

---

*Integration audit: 2026-01-25*
