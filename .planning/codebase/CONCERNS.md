# Codebase Concerns

**Analysis Date:** 2026-01-25

## Tech Debt

**Missing JWT Signature Verification:**
- Issue: Back-channel logout token is decoded but signature is never verified. Line 138-144 in `server/auth/routes.js` decodes the JWT without validating its signature, accepting any malformed or tampered token.
- Files: `server/auth/routes.js` (lines 138-144)
- Impact: An attacker could forge logout tokens to invalidate other users' sessions without authorization.
- Fix approach: Use openid-client's token verification methods or jsonwebtoken library to validate the JWT signature before processing claims. Verify the token was issued by the trusted OIDC provider.

**Uncontrolled CORS Configuration:**
- Issue: CORS is enabled globally with `cors()` middleware in `server/index.js` line 37 without specifying allowed origins. This allows requests from any domain.
- Files: `server/index.js` (line 37)
- Impact: Any website can make requests to the API on behalf of authenticated users, leading to CSRF vulnerabilities.
- Fix approach: Configure CORS with explicit allowed origins: `cors({ origin: process.env.ALLOWED_ORIGINS?.split(',') || [] })`.

**Hardcoded Timezone in Date Calculations:**
- Issue: CLI and import tools use UTC month calculations inconsistently. `cli/index.js` line 30 and line 82 construct dates as `YYYY-${month}-${date}` but month and date are 0-indexed (getUTCMonth() returns 0-11, getUTCDate() returns 1-31). Line 82 uses getUTCMonth() without padding/adjustment.
- Files: `cli/index.js` (lines 28-31, 81-82)
- Impact: Dates will be formatted incorrectly (e.g., 2026-0-25 instead of 2026-01-25), causing API failures and incorrect billing data.
- Fix approach: Use consistent date formatting: `new Date().toISOString().split('T')[0]` or proper padding with `String(month + 1).padStart(2, '0')`.

**No Session Cleanup Scheduled:**
- Issue: `server/auth/session-store.js` exports a `cleanup()` function but it is never called. Expired sessions accumulate in the database forever.
- Files: `server/auth/session-store.js` (line 87-89), `server/index.js` (no call to cleanup)
- Impact: SQLite database grows unbounded, potentially causing disk exhaustion over time. Session lookup queries become slower.
- Fix approach: Call `sessionStore.cleanup()` periodically using `setInterval()` in `server/index.js` or cron job (e.g., every hour).

**Inline Password/Secret in Code Comments:**
- Issue: `cli/index.js` lines 4-5 and 63-65 contain examples showing how to generate OVH API credentials in comments. While these are just documentation, the pattern could lead to accidental commits of real credentials.
- Files: `cli/index.js` (lines 3-6, 61-67)
- Impact: If developers follow the pattern, credentials could end up in shell history or version control.
- Fix approach: Move credential generation instructions to separate SETUP.md document. Use `.env.example` for required variables.

**Weak Session Secret Fallback:**
- Issue: If SESSION_SECRET environment variable is not set and config file doesn't provide it, OIDC initialization fails silently. However, there's no validation that the secret is cryptographically strong.
- Files: `server/auth/index.js` (lines 34, 68-72)
- Impact: Weak default secrets (if any fallback exists) could allow session prediction. Current behavior is safe (requires explicit config) but lacks validation.
- Fix approach: Validate session secret length (minimum 32 bytes) and entropy. Generate a secure random secret if missing rather than failing.

**Loose Date Range Validation:**
- Issue: API endpoints accept `from` and `to` date parameters without validating format or logical consistency. No check that `from <= to`.
- Files: `server/index.js` (lines 167-170, 234-236, 257-259, 288-290)
- Impact: Malformed dates could return confusing results or errors. Reversed dates (to < from) execute without warning.
- Fix approach: Add validation utility: check YYYY-MM-DD format with regex, parse and compare dates, return 400 if invalid or reversed.

## Security Considerations

**OVH API Credentials Exposure:**
- Risk: Credentials are stored in plaintext JSON file at `~/my-ovh-bills/credentials.json` or `~/my-ovh-bills/config.json`. No encryption or access control.
- Files: `cli/index.js` (line 244), `data/import.js` (line 20-23), `cli/split-by-project.js` (line 16)
- Current mitigation: File permissions rely on OS umask (typically user-readable only). No application-level protection.
- Recommendations:
  1. Use environment variables for all secrets (OIDC_CLIENT_SECRET, OVH_CONSUMER_KEY, etc.)
  2. Implement credential encryption at rest using Node.js crypto
  3. Warn users at startup if credentials.json exists with overly-permissive file mode
  4. Support .env files with dotenv package (already used by OIDC setup)

**Back-Channel Logout Verification Missing:**
- Risk: The logout_token in back-channel logout (lines 131-144 in `server/auth/routes.js`) is decoded without signature verification. An attacker on the network can craft a fake logout token and invalidate sessions.
- Files: `server/auth/routes.js` (lines 137-145)
- Current mitigation: None. The code logs what happened but trusts the JWT claims implicitly.
- Recommendations:
  1. Verify JWT signature using openid-client's token validation
  2. Validate token expiration (exp claim)
  3. Validate token audience (aud claim) matches client_id

**Missing CSRF Protection on State Parameter:**
- Risk: The state parameter is stored in-memory map (`pendingAuth`) without CSRF token linking to the user session. If multiple OIDC flows are initiated, state could be replayed.
- Files: `server/auth/routes.js` (lines 23-34, 48-55)
- Current mitigation: State expires after 10 minutes; in-memory storage prevents persistence attacks but is lost on server restart.
- Recommendations:
  1. Use a combination of state parameter and session ID for validation
  2. Store pending auth in session store (database) instead of memory
  3. Add SameSite cookie attribute (already done on line 86)

**Database File Permissions:**
- Risk: SQLite database at `data/ovh-bills.db` contains billing data and user session information. No encryption, vulnerable if system is compromised.
- Files: `data/db.js` (line 5)
- Impact: Session tokens, user IDs, and billing details exposed.
- Recommendations:
  1. Use SQLite encryption with sqlcipher or similar
  2. Document database security assumptions in deployment guide
  3. Restrict file permissions with documented umask setup

## Performance Bottlenecks

**In-Memory Session State:**
- Problem: `pendingAuth` map in `server/auth/routes.js` (line 12) grows without bounds if timeouts fail or server has many concurrent logins.
- Files: `server/auth/routes.js` (lines 11-34)
- Cause: No size limit on the Map; old entries only cleared after 10 minutes via setTimeout.
- Improvement path:
  1. Add maximum size limit, evict oldest entries if exceeded
  2. Use a cleanup job instead of setTimeout for each entry
  3. Move to database (session store) for persistence across restarts

**Database Query Inefficiency in Analysis Endpoints:**
- Problem: Analysis endpoints run multiple queries without pagination. `/api/summary` (lines 334-368 in `server/index.js`) runs 3 separate queries for the same date range.
- Files: `server/index.js` (lines 334-368)
- Cause: No query optimization; each analysis endpoint joins bills and details separately.
- Improvement path:
  1. Cache analysis results with 5-minute TTL
  2. Consolidate queries where possible
  3. Add database indexes on (date, project_id, service_type)

**CLI Downloads Sequential:**
- Problem: `cli/index.js` fetches bills sequentially (line 297-299). With hundreds of bills, download time is linear O(n).
- Files: `cli/index.js` (lines 297-299)
- Cause: Loop awaits each `getBill(bill)` before processing next.
- Improvement path:
  1. Use Promise.all() to download 5-10 bills concurrently
  2. Add rate limiting to respect OVH API rate limits
  3. Add progress bar using cli-progress package

## Fragile Areas

**Project Domain Mapping Logic:**
- Files: `data/import.js` (line 282)
- Why fragile: Project ID is determined by checking if `projectMap[d.domain]` exists, then assigning `d.domain` as the project_id. This assumes domain always equals project ID, but domain from bill details is a different field. Line 282 should map to projectMap values, not domains.
- Safe modification: Review OVH API structure - if domain is a domain name but project_id is a UUID, this is a critical bug. Test with real OVH data before deploying.
- Test coverage: No unit tests verify the project mapping logic. Add tests with sample bill details and project IDs.

**Date Calculation Bugs (Multiple Locations):**
- Files: `cli/index.js` (lines 30, 82), `cli/split-by-project.js` (line 180), `server/index.js` (line 411)
- Why fragile: Mixing getUTCMonth() (0-11) with direct string formatting causes off-by-one errors. Line 411 uses `new Date(year, month, 0)` which is ambiguous JavaScript date math.
- Safe modification: Centralize date utilities. Use ISO 8601 format exclusively. Test with January (month 0) and December (month 11).
- Test coverage: No tests for date edge cases (month boundaries, leap years).

**Import Process State Management:**
- Files: `data/import.js` (lines 198-311)
- Why fragile: Import log status changes but if database transaction fails mid-import, status may not be updated correctly. No rollback mechanism.
- Safe modification: Wrap import in database transaction using better-sqlite3's transaction API.
- Test coverage: No tests for partial failures or recovery scenarios.

**Session Expiry Boundary Condition:**
- Files: `server/auth/session-store.js` (lines 59-68)
- Why fragile: Query uses `expires_at > datetime('now')` which means a session expiring exactly at 'now' is invalid. Off-by-microsecond edge cases possible. Also, system clock changes could cause issues.
- Safe modification: Use `expires_at >= datetime('now')` and add 1-second buffer.
- Test coverage: No tests for session boundary conditions.

## Test Coverage Gaps

**OIDC Authentication Flow:**
- What's not tested: Login callback validation, state parameter verification, token exchange, user info retrieval, back-channel logout
- Files: `server/auth/routes.js`, `server/auth/oidc-client.js`
- Risk: Broken authentication flow could go undetected until production. Back-channel logout without signature verification is untested.
- Priority: High

**Database Operations:**
- What's not tested: Transaction rollback, concurrent inserts, foreign key constraints, schema migrations
- Files: `data/db.js`
- Risk: Data corruption during concurrent imports or partial failures undetected.
- Priority: High

**API Parameter Validation:**
- What's not tested: Invalid date formats, missing required parameters, SQL injection attempts, boundary conditions
- Files: `server/index.js` (all API endpoints)
- Risk: Malformed requests could crash the server or return confusing errors.
- Priority: Medium

**Project Domain Mapping:**
- What's not tested: Correctness of domain-to-project-id mapping, handling of missing projects
- Files: `data/import.js`
- Risk: Bills assigned to wrong projects or NULL projects silently.
- Priority: Medium

**CLI Credential Loading:**
- What's not tested: Missing credentials.json, invalid JSON, missing required fields
- Files: `cli/index.js`, `cli/split-by-project.js`, `data/import.js`
- Risk: Unhelpful error messages, unclear how to fix setup issues.
- Priority: Low

**Date Handling Edge Cases:**
- What's not tested: Leap years, month boundaries, DST transitions, timezone inconsistencies
- Files: `cli/index.js`, `server/index.js`
- Risk: Incorrect billing data for edge dates (Feb 29, Jan 1, etc.)
- Priority: Medium

## Scaling Limits

**In-Memory Session Map Growth:**
- Current capacity: Unbounded (limited by available RAM)
- Limit: On servers with 1GB RAM, ~10k pending auth entries possible before memory pressure
- Scaling path: Move pendingAuth to database, implement cleanup jobs, add session purging

**SQLite Concurrent Write Limit:**
- Current capacity: Better-sqlite3 with WAL mode supports ~10-100 concurrent reads, 1 write
- Limit: With full imports of thousands of bills, write lock contention becomes a bottleneck
- Scaling path: Use WAL mode properly (already enabled), consider PostgreSQL for multi-writer scenarios, batch inserts

**OVH API Rate Limits:**
- Current capacity: No rate limiting in place; OVH API typically allows 10-20 requests/second
- Limit: Fetching thousands of bills could hit rate limits, causing import failures
- Scaling path: Implement exponential backoff, queue retry mechanism, add request throttling

## Dependencies at Risk

**openid-client v6.1.7:**
- Risk: This is an active dependency for OIDC. Version 6.x is recent and relatively stable, but check security advisories.
- Impact: Vulnerability in openid-client would affect all authentication.
- Migration plan: Monitor npm security advisories, pin to minor version (^6.1.7 allows patch updates). Test major upgrades thoroughly.

**better-sqlite3 v11.0.0:**
- Risk: Native module, requires compilation. Could have platform-specific bugs.
- Impact: Database corruption or crashes.
- Migration plan: Keep pinned to tested version. Have backup strategy for database file.

**express v4.18.2:**
- Risk: Stable version but not latest (v5.x exists). Security patches may be slower.
- Impact: Potential security vulnerabilities.
- Migration plan: Monitor security advisories, consider upgrading to 4.x with patches regularly.

## Missing Critical Features

**Audit Logging:**
- Problem: No audit trail of who accessed billing data, when, or what changes were made. Sessions are created/deleted but not logged.
- Blocks: Compliance with data protection regulations (GDPR, etc.), forensic analysis of unauthorized access.

**Rate Limiting:**
- Problem: No rate limiting on API endpoints. No protection against brute-force or DoS attacks.
- Blocks: Production deployment security hardening.

**Error Reporting:**
- Problem: No centralized error tracking or alerting. Errors logged to console only. Failed imports not notified to operators.
- Blocks: Proactive issue detection, production observability.

**Data Export:**
- Problem: Users can view but not export billing data in bulk (CSV, Excel). Only JSON from split-by-project.js.
- Blocks: Integration with accounting systems, offline analysis.

---

*Concerns audit: 2026-01-25*
