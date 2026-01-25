# Testing Patterns

**Analysis Date:** 2026-01-25

## Test Framework

**Status:** Not detected

**Current State:**
- No test framework configured (Jest, Vitest, Mocha, etc. not installed)
- No test files found in codebase (no `.test.js`, `.spec.js`, `.test.ts`, `.spec.ts` files)
- No testing dependencies in any workspace `package.json`
- No test script in root or workspace package.json files

**Package Analysis:**
- Root: `package.json` has no testing framework
- Server: `package.json` (Node.js server) has no test dependencies
- Dashboard: `package.json` (React/Vite) has no testing framework
- CLI: `package.json` has no test dependencies
- Data: `package.json` has no test dependencies

## Manual Testing Approach

The codebase appears to rely on manual testing and CLI verification:

**CLI Tools for Manual Testing:**
```bash
# From root package.json
npm run cli                    # Run CLI tool with defaults
npm run import                 # Data import from OVH API
npm run import:full            # Full data import
npm run import:diff            # Differential import
npm run dev:server             # Start server in dev mode
npm run dev:dashboard          # Start dashboard in dev mode
npm run dev                    # Run server + dashboard concurrently
npm run build                  # Build dashboard
npm run start                  # Start server
```

**Environment-based Testing:**
- OVH API credentials required in `credentials.json` or `config.json` for testing CLI/import
- API server can be tested with curl or API client (Postman, Thunder Client, etc.)
- Dashboard can be tested via browser at http://localhost:3001

## Code Coverage

**Coverage Requirements:** Not enforced

**View Coverage:** Not applicable (no test framework to generate coverage reports)

## Test Types

### Unit Tests
- Not implemented
- Would apply to utility functions like:
  - `classifyService()` in `data/import.js` - service type classification
  - Date parsing and formatting functions in CLI
  - Currency formatting in `cli/split-by-project.js`

### Integration Tests
- Not implemented
- Would test API endpoints with database
- Would test OIDC authentication flow with mock OIDC provider
- Would test OVH API integration with mock OVH API responses
- Would test data import pipeline: fetch → classify → store

### E2E Tests
- Not implemented
- Would test full user flows:
  - Login → view dashboard → filter by date → export
  - Run import → verify data in database → check API endpoints
  - CLI: authenticate → fetch bills → save to filesystem

## Testable Components

**Server (Express API):**
- Location: `server/index.js`, `server/auth/`
- Endpoints: 12+ GET/POST endpoints in `server/index.js` (lines 144-452)
- Would benefit from testing:
  - Parameter validation (from/to dates required)
  - Database error handling
  - Authentication middleware behavior
  - OIDC callback flow

**Database Layer:**
- Location: `data/db.js`
- Database operations exposed as:
  - `db.projects`: upsert, getAll, getById
  - `db.bills`: upsert, getAll, getById, getLatestDate, exists
  - `db.details`: getByBillId, deleteByBillId, insertMany
  - `db.analysis`: byProject, byService, dailyTrend, monthlyTrend, summary
  - `db.importLog`: start, complete, fail, getLatest, getAll
- Would benefit from:
  - Testing transaction safety
  - Testing UPSERT behavior with conflicts
  - Testing query result formatting

**Data Import:**
- Location: `data/import.js`
- Functions to test:
  - `classifyService()` (lines 81-118) - classification logic
  - `parseArgs()` (lines 53-78) - argument parsing
  - `fetchProjects()` (lines 121-143) - API interaction
  - `fetchBills()` (lines 146-157) - API interaction
  - `fetchBillDetails()` (lines 160-195) - API interaction
  - `runImport()` (lines 198-311) - orchestration

**Authentication:**
- Location: `server/auth/`
- Modules:
  - `oidc-client.js` - OIDC client initialization
  - `session-store.js` - Session persistence
  - `routes.js` - Login/callback/logout flows
  - `middleware.js` - Auth verification middleware
- Would need mock OIDC provider for testing

**Dashboard:**
- Location: `dashboard/src/`
- React components would need React Testing Library
- API service would need mock axios
- Hooks like `useLanguage()` (lines 37-43 in `useLanguage.jsx`) would benefit from testing

## Testing Recommendations

**For Quick Value, Test These Areas (Priority Order):**

1. **Service Classification Logic** (`data/import.js:classifyService()`)
   - Simple pure function with many branches
   - Easy to unit test with Jest
   - High impact: incorrect classification breaks analysis

2. **Argument Parsing** (`cli/index.js`, `cli/split-by-project.js`, `data/import.js`)
   - Parse command-line args correctly
   - Test required vs optional parameters
   - Test date validation

3. **Database Operations** (`data/db.js`)
   - Test UPSERT behavior
   - Test query parameter safety
   - Test error handling for missing data

4. **API Endpoints** (`server/index.js`)
   - Test parameter validation
   - Test error responses
   - Test data formatting (date extraction, rounding prices)

5. **OIDC Authentication** (`server/auth/`)
   - Test state parameter validation
   - Test session creation
   - Test logout cleanup

## Running Tests (When Implemented)

**Example setup (recommended):**
```bash
# Install testing framework
npm install --save-dev jest

# Add to root package.json
"scripts": {
  "test": "jest",
  "test:watch": "jest --watch",
  "test:coverage": "jest --coverage"
}

# Create test structure
data/__tests__/classifyService.test.js
data/__tests__/import.test.js
server/__tests__/api.test.js
server/__tests__/auth.test.js
```

## Current Testing Reality

**Manual Verification Steps Currently Used:**

1. **CLI Testing:**
   - Run with test credentials: `node cli/index.js --from=2025-01-01 --to=2025-01-31`
   - Verify bills download to output directory
   - Verify JSON metadata files if `--json` flag used
   - Check for error messages with invalid date formats

2. **Import Testing:**
   - Run: `node data/import.js --diff`
   - Check database for imported records
   - Verify service classification in database
   - Check console output for progress

3. **Server Testing:**
   - Start: `npm run dev:server`
   - Test endpoints with curl:
     ```bash
     curl http://localhost:3001/api/projects
     curl 'http://localhost:3001/api/bills?from=2025-01-01&to=2025-01-31'
     curl 'http://localhost:3001/api/analysis/by-service?from=2025-01-01&to=2025-01-31'
     ```
   - Test auth flow by navigating to `/auth/login` in browser

4. **Dashboard Testing:**
   - Start: `npm run dev`
   - Load http://localhost:3001 in browser
   - Switch date ranges
   - Verify charts render correctly
   - Test language switching
   - Verify login redirect if AUTH_REQUIRED=true

---

*Testing analysis: 2026-01-25*
