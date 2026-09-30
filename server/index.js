const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');

// Import database module from data workspace
const db = require('../data/db');
const { monthBounds } = require('../data/months');
const { readAccounts } = require('../data/accounts-config');

// Import auth module
const auth = require('./auth');
const { createAccountParameterMiddleware } = require('./account-parameter');
const { createOriginCheckMiddleware, readAllowedOrigins } = require('./cors');
const { createHostCheckMiddleware } = require('./hosts');
const { importsEnabled } = require('./imports');
const { trendWindowFromQuery, monthFromQuery } = require('./months');
const { consumptionForecast, currentConsumption } = require('./consumption');
const { readConfigFile } = require('./config-file');
const { buildRateLimitConfig } = require('./rate-limit-config');
const { isHealthCheck } = require('./auth/health');
const { requestLogLine } = require('./request-log');

// The version of OCM that this server runs, which each release sets in the root package.json
// (scripts/release.sh): the configuration route gives it, for the dashboard's footer (#188)
const { version: OCM_VERSION } = require('../package.json');

// Load configuration: the first config.json that exists. One that cannot be
// read stops the server, rather than let it run without its settings
const CONFIG_PATHS = [
  path.resolve(__dirname, '..', 'config.json'),
  path.resolve(os.homedir(), 'my-ovh-bills', 'config.json')
];

let config = { dashboard: { budget: 50000, currency: 'EUR' } };
let configPath = null;
// Rate limiting and TRUST_PROXY: a malformed setting stops the server too
let rateLimitConfig;
// The origins CORS allows besides the dashboard's own, as a list
let allowedOrigins;

try {
  const loaded = readConfigFile(CONFIG_PATHS);
  config = { ...config, ...loaded.config };
  configPath = loaded.path;
  rateLimitConfig = buildRateLimitConfig(config, process.env, configPath || undefined);
  allowedOrigins = readAllowedOrigins(config, process.env, configPath || undefined);
  // IMPORT_ENABLED too, which the routes read later
  importsEnabled();
  // The OVH accounts, read only to check them, as the import reads them (#113): the server
  // never uses their keys, and the accounts route names them as their last import recorded
  // them
  readAccounts(loaded.config, configPath || 'config.json');
} catch (err) {
  console.error(`Failed to start server: ${err.message}`);
  process.exit(1);
}

const app = express();
const PORT = process.env.PORT || 3001;

// Host check, against DNS rebinding (#78): none unless ALLOWED_HOSTS is set
const hostCheck = createHostCheckMiddleware({
  // A comma-separated string, or in config.json an array too
  allowedHosts: process.env.ALLOWED_HOSTS || config.allowedHosts,
  trustProxy: rateLimitConfig.trustProxy,
});

// CORS configuration - restrict to allowed origins and the request's own
const originCheck = createOriginCheckMiddleware({
  // ALLOWED_ORIGINS, or allowedOrigins in config.json
  allowedOrigins,
  isDev: process.env.NODE_ENV !== 'production',
  trustProxy: rateLimitConfig.trustProxy,
});

// Rate limiting - protect against DoS and brute-force attacks
const apiLimiter = rateLimit({
  windowMs: rateLimitConfig.api.windowMs,
  max: rateLimitConfig.api.max,
  message: { error: 'Too many requests, please try again later' },
  standardHeaders: true, // Return rate limit info in `RateLimit-*` headers
  legacyHeaders: false, // Disable `X-RateLimit-*` headers
  // Skip rate limiting for the health check, matched as every auth check
  // matches it: /api/health in any case, with or without a trailing slash
  skip: (req) => isHealthCheck(req)
});

// Stricter rate limit for auth endpoints (prevent brute-force)
const authLimiter = rateLimit({
  windowMs: rateLimitConfig.auth.windowMs,
  max: rateLimitConfig.auth.max,
  message: { error: 'Too many authentication attempts, please try again later' },
  standardHeaders: true,
  legacyHeaders: false
});

// Back-channel logout: the provider posts one request per sign-out. A flood
// of tokens to verify, as a replay attack sends, is cut
const backChannelLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  message: 'Too many logout requests',
  standardHeaders: true,
  legacyHeaders: false
});

// Manual import trigger: hard-capped at one run per hour for everyone (shared
// global bucket, not per-IP) to protect the OVH API. This is a functional
// safeguard, applied even when the DoS rate limiting is disabled.
// Note: in-memory window, so it resets if the server restarts.
const importLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 1,
  message: { error: 'syncRateLimited' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: () => 'global-manual-import',
  // Only started runs (202) use the quota: a refused one (409, 500) does not
  skipFailedRequests: true,
  validate: false
});

// Shared resource-type presentation (used by by-resource-type and the
// monthly-trend-by-category endpoints).
const RESOURCE_TYPE_COLORS = {
  'cloud_project': '#3b82f6',
  'dedicated_server': '#ef4444',
  'vps': '#f59e0b',
  'storage': '#10b981',
  'load_balancer': '#06b6d4',
  'domain': '#8b5cf6',
  'ip_service': '#ec4899',
  'telephony': '#f97316',
  'private_cloud': '#7c3aed',
  'private_cloud_host': '#9333ea',
  'private_cloud_datastore': '#a855f7',
  'license': '#0891b2',
  'backup': '#059669',
  'support': '#64748b',
  'telecom': '#d97706',
  'web_cloud': '#2563eb',
  'other': '#6b7280'
};

const RESOURCE_TYPE_LABELS = {
  'cloud_project': 'Public Cloud',
  'dedicated_server': 'Dedicated Servers',
  'vps': 'VPS',
  'storage': 'Storage',
  'load_balancer': 'Load Balancers',
  'domain': 'Domains',
  'ip_service': 'IP',
  'telephony': 'Telephony',
  'private_cloud': 'Private Cloud',
  'private_cloud_host': 'Private Cloud Hosts',
  'private_cloud_datastore': 'Private Cloud Datastores',
  'license': 'Licenses',
  'backup': 'Backup',
  'support': 'Support',
  'telecom': 'Telecom',
  'web_cloud': 'Web Cloud',
  'other': 'Other'
};

// Trust proxy headers (for reverse proxy/load balancer): the X-Forwarded-For
// of as many proxies as TRUST_PROXY says, so that req.ip is the address the
// outermost of them got the request from
if (rateLimitConfig.trustProxy) {
  app.set('trust proxy', rateLimitConfig.trustProxy);
}

// Middleware. The Host check comes first, so that a host that is not allowed
// gets no route, no static file and no CORS answer.
if (hostCheck) {
  app.use(hostCheck);
}
app.use(originCheck);
// Every request that gets here passed the check: CORS reflects its origin
app.use(cors({
  origin: true,
  credentials: true, // Allow cookies for authentication
}));
app.use(express.json());
app.use(cookieParser());

// Apply rate limiting if enabled
if (rateLimitConfig.enabled) {
  app.use('/api/', apiLimiter); // Apply to all API routes
}

// Auth configuration placeholder (set during async init)
let authConfig = { auth: { enabled: false } };

// ========================
// Async initialization
// ========================

async function initializeServer() {
  // Initialize OIDC authentication: throws when it is enabled but incomplete
  const authResult = await auth.initialize(app, db.getDb(), config, configPath);
  authConfig = authResult.config;

  if (authConfig.auth.enabled) {
    // Until the provider is discovered, the API and the sign-in routes answer
    // 503, except /api/health for the container's healthcheck
    app.use('/api', auth.awaitDiscovery());
    app.use('/auth', auth.awaitDiscovery());

    // Mount auth routes with stricter rate limiting
    const authMiddleware = rateLimitConfig.enabled
      ? [authLimiter, auth.setupRoutes(authConfig)]
      : [auth.setupRoutes(authConfig)];
    app.use('/auth', ...authMiddleware);

    // Back-channel logout endpoint, unless auth.backChannelLogout is false
    if (authConfig.auth.backChannelLogout) {
      const limits = rateLimitConfig.enabled ? [backChannelLimiter] : [];
      app.post('/logout/backchannel', ...limits, express.urlencoded({ extended: false }),
        (req, res) => {
          auth.backChannelLogout(req, res, authConfig);
        });
    }

    // OIDC authentication middleware
    app.use(auth.createAuthMiddleware(authConfig));

    // Schedule periodic session cleanup (every hour)
    const SESSION_CLEANUP_INTERVAL = 60 * 60 * 1000; // 1 hour
    setInterval(() => {
      try {
        const result = auth.sessionStore.cleanup();
        if (result.changes > 0) {
          console.log(`Session cleanup: removed ${result.changes} expired session(s)`);
        }
      } catch (err) {
        console.error('Session cleanup error:', err.message);
      }
    }, SESSION_CLEANUP_INTERVAL);

    // Run initial cleanup on startup
    try {
      const result = auth.sessionStore.cleanup();
      if (result.changes > 0) {
        console.log(`Initial session cleanup: removed ${result.changes} expired session(s)`);
      }
    } catch (err) {
      // Ignore - sessions table might not exist yet
    }
  } else {
    // Without OIDC: header-based SSO (LemonLDAP headers via reverse proxy)
    auth.mountHeaderMode(app, { required: authConfig.auth.required });
  }

  // Logging middleware (inside async to run after auth middleware)
  app.use((req, res, next) => {
    console.log(requestLogLine({
      at: new Date(), user: req.user?.id, method: req.method, path: req.path,
    }));
    next();
  });

  // Register all API routes
  registerRoutes();

  // Static files (production)
  const distPath = path.join(__dirname, '../dashboard/dist');
  if (fs.existsSync(distPath)) {
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  // Start listening
  app.listen(PORT, () => {
    console.log(`\n🚀 OVH Bill API Server running on http://localhost:${PORT}`);

    // Log rate limiting configuration
    if (rateLimitConfig.enabled) {
      console.log(`   Rate limiting: enabled`);
      console.log(`     API: ${rateLimitConfig.api.max} req/${rateLimitConfig.api.windowMs / 60000} min per IP`);
      console.log(`     Auth: ${rateLimitConfig.auth.max} req/${rateLimitConfig.auth.windowMs / 60000} min per IP`);
    } else {
      console.log(`   Rate limiting: disabled`);
    }
    // TRUST_PROXY, which the CORS and Host checks and the session cookie read too
    const proxies = rateLimitConfig.trustProxy;
    const trusted = proxies === 1 ? '1 proxy' : `${proxies} proxies`;
    console.log(`   Trust proxy: ${proxies > 0 ? trusted : 'disabled'}`);

    if (authConfig.auth?.enabled) {
      console.log(`   OIDC authentication enabled`);
      console.log(`   Login: /auth/login`);
      console.log(`   Logout: /auth/logout`);
    }
    console.log(`\nEndpoints:`);
    console.log(`  GET /api/projects`);
    console.log(`  GET /api/bills?from=YYYY-MM-DD&to=YYYY-MM-DD`);
    console.log(`  GET /api/analysis/by-project?from=YYYY-MM-DD&to=YYYY-MM-DD`);
    console.log(`  GET /api/analysis/by-service?from=YYYY-MM-DD&to=YYYY-MM-DD`);
    console.log(`  GET /api/analysis/daily-trend?from=YYYY-MM-DD&to=YYYY-MM-DD`);
    console.log(`  GET /api/analysis/monthly-trend?months=6&end=YYYY-MM`);
    console.log(`  GET /api/summary?from=YYYY-MM-DD&to=YYYY-MM-DD`);
    console.log(`  GET /api/months`);
    console.log(`  GET /api/carbon/footprint?month=YYYY-MM`);
    console.log(`  GET /api/carbon/trend?end=YYYY-MM`);
    console.log(`  GET /api/carbon/by-server?month=YYYY-MM`);
    console.log(`  GET /api/import/status`);
    console.log(`\n`);
  });
}

// ========================
// Date Validation Utility
// ========================

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Validate date range parameters
 * @param {string} from - Start date (YYYY-MM-DD)
 * @param {string} to - End date (YYYY-MM-DD)
 * @returns {{ valid: boolean, error?: string }} Validation result
 */
function validateDateRange(from, to) {
  // Check required
  if (!from || !to) {
    return { valid: false, error: 'from and to parameters are required' };
  }

  // Check format
  if (!DATE_REGEX.test(from)) {
    return { valid: false, error: `Invalid 'from' date format: ${from}. Expected YYYY-MM-DD` };
  }
  if (!DATE_REGEX.test(to)) {
    return { valid: false, error: `Invalid 'to' date format: ${to}. Expected YYYY-MM-DD` };
  }

  // Parse and validate dates
  const fromDate = new Date(from);
  const toDate = new Date(to);

  if (isNaN(fromDate.getTime())) {
    return { valid: false, error: `Invalid 'from' date: ${from}` };
  }
  if (isNaN(toDate.getTime())) {
    return { valid: false, error: `Invalid 'to' date: ${to}` };
  }

  // Check logical order
  if (fromDate > toDate) {
    return { valid: false, error: `'from' date (${from}) must be before or equal to 'to' date (${to})` };
  }

  return { valid: true };
}

/**
 * The middleware of a boolean parameter of the data routes, such as byAccount or projected: it
 * puts its value in req[name], true or false, false without it, and answers 400 to any other
 * value, naming the parameter.
 * @param {string} name - The parameter, as the query names it
 * @returns {function} An Express middleware
 */
function booleanParameter(name) {
  return (req, res, next) => {
    const value = req.query[name];
    if (value !== undefined && value !== 'true' && value !== 'false') {
      return res.status(400).json({ error: `Invalid '${name}' parameter: expected true or false` });
    }
    req[name] = value === 'true';
    return next();
  };
}

/**
 * What a row of the answer of a route that takes the projected parameter gives of its projected
 * part (#217): `projected`, which partOf() reads, while the request asks for the projected cost
 * of the month in progress; nothing otherwise, so that the route answers as before without the
 * parameter.
 * @param {object} req - The request, whose req.projected projectedParameter sets
 * @param {function(): *} partOf - Reads the row's projected part, only while the request asks
 *   for it
 * @returns {{ projected: * } | {}} What to spread into the row
 */
function projectedPartOf(req, partOf) {
  return req.projected ? { projected: partOf() } : {};
}

// ========================
// Route registration function
// ========================

function registerRoutes() {

  // The account parameter of the data routes (#115): req.account, the account a request
  // asks for, which they pass on to their queries
  const accountParameter = createAccountParameterMiddleware({
    isRecordedAccount: db.accounts.isRecorded,
  });

  // The byAccount parameter of the lists of the costs of projects (#118), and of the bill lines
  // of a resource type or of the Veeam backups by service (#123, #197): req.byAccount, whether a
  // request asks for each project or service once for each account that billed it, with that
  // account, as the lists that name the account of each row do, rather than once
  const byAccountParameter = booleanParameter('byAccount');

  // The projected parameter of the routes of the Trends (#217) and Compare (#218, #219) tabs:
  // req.projected, whether a request asks for the projected cost of the month in progress
  // (CONTEXT.md), when its period covers it, with each row's projected part (projectedPartOf())
  const projectedParameter = booleanParameter('projected');

  // ========================
  // Projects Endpoints
  // ========================

  // The projects of the account the request asks for, or of every account without one (#121)
  app.get('/api/projects', accountParameter, (req, res) => {
    try {
      const projects = db.projects.getAll(req.account);
      res.json(projects);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // The projects of the account the request asks for, or of every account without one, with
  // their instances, their current consumption and their account (#121)
  app.get('/api/projects/enriched', accountParameter, (req, res) => {
    try {
      res.json(db.projects.getEnriched(req.account));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/projects/:id', (req, res) => {
    try {
      const project = db.projects.getById(req.params.id);
      if (!project) {
        return res.status(404).json({ error: 'Project not found' });
      }
      res.json(project);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/projects/:id/costs', (req, res) => {
    try {
      const { from, to } = req.query;
      const validation = validateDateRange(from, to);
      if (!validation.valid) {
        return res.status(400).json({ error: validation.error });
      }

      const database = db.getDb();
      const costs = database.prepare(`
      SELECT
        b.date,
        SUM(d.total_price) as total,
        d.service_type
      FROM bill_details d
      JOIN bills b ON d.bill_id = b.id
      WHERE d.project_id = ?
        AND b.date >= ? AND b.date <= ?
      GROUP BY b.date, d.service_type
      ORDER BY b.date
    `).all(req.params.id, from, to);

      res.json(costs);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ========================
  // Bills Endpoints
  // ========================

  // The bills of a period, each date optional, for the account the request asks for, or for
  // every account without one (#140). Each names its account: its NIC handle, or null for the
  // Unknown account.
  app.get('/api/bills', accountParameter, (req, res) => {
    try {
      const { from, to } = req.query;
      const bills = db.bills.getAll(from, to, req.account);
      res.json(bills);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/bills/:id', (req, res) => {
    try {
      const bill = db.bills.getById(req.params.id);
      if (!bill) {
        return res.status(404).json({ error: 'Bill not found' });
      }
      res.json(bill);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/bills/:id/details', (req, res) => {
    try {
      const details = db.details.getByBillId(req.params.id);
      res.json(details);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ========================
  // Analysis Endpoints
  // ========================

  // The costs of each project of a period, for the account the request asks for, or for
  // every account without one (#118). Once each, as before, or, by account, once for each
  // account that billed it, with that account: its NIC handle, or null for the Unknown
  // account. With projected=true, the month in progress costs its projected cost, and each
  // project gives its projected part, a project that the month has not billed yet included, its
  // credit counted with its other lines of the month before (#219). The Overview and the Public
  // Cloud tab never ask for it: only the Compare tab's comparison by project does.
  app.get('/api/analysis/by-project', accountParameter, byAccountParameter, projectedParameter,
    (req, res) => {
      try {
        const { from, to } = req.query;
        const validation = validateDateRange(from, to);
        if (!validation.valid) {
          return res.status(400).json({ error: validation.error });
        }

        const data = db.analysis.byProject(from, to, req.account, {
          byAccount: req.byAccount, projected: req.projected,
        });

        // Format response
        const result = data.map(row => ({
          projectId: row.project_id,
          projectName: row.project_name || 'Unknown',
          total: Math.round(row.total * 100) / 100,
          detailsCount: row.details_count,
          ...(req.byAccount ? { account: row.account } : {}),
          ...projectedPartOf(req, () => Math.round(row.projected * 100) / 100),
        }));

        res.json(result);
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

  // The costs of each service type of a period, for the account the request asks for, or for
  // every account without one (#118). With projected=true, the month in progress costs its
  // projected cost, and each service type gives its projected part (#218).
  app.get('/api/analysis/by-service', accountParameter, projectedParameter, (req, res) => {
    try {
      const { from, to } = req.query;
      const validation = validateDateRange(from, to);
      if (!validation.valid) {
        return res.status(400).json({ error: validation.error });
      }

      const data = db.analysis.byService(from, to, req.account, { projected: req.projected });

      // Define colors for each service type
      const colors = {
        'Compute': '#3b82f6',
        'Storage': '#10b981',
        'Network': '#f59e0b',
        'Database': '#8b5cf6',
        'AI/ML': '#ec4899',
        'Licenses': '#06b6d4',
        'Support': '#f97316',
        'Backup': '#059669',
        'Other': '#6b7280'
      };

      const result = data.map(row => ({
        name: row.service_type || 'Other',
        value: Math.round(row.total * 100) / 100,
        color: colors[row.service_type] || colors['Other'],
        detailsCount: row.details_count,
        ...projectedPartOf(req, () => Math.round(row.projected * 100) / 100),
      }));

      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // The cost of each day of a period that has a bill, for the account the request asks for, or
  // for every account without one (#140)
  app.get('/api/analysis/daily-trend', accountParameter, (req, res) => {
    try {
      const { from, to } = req.query;
      const validation = validateDateRange(from, to);
      if (!validation.valid) {
        return res.status(400).json({ error: validation.error });
      }

      const data = db.analysis.dailyTrend(from, to, req.account);

      const result = data.map(row => ({
        date: row.date,
        day: parseInt(row.date.split('-')[2]),
        cost: Math.round(row.total * 100) / 100
      }));

      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // The month of the latest bill, YYYY-MM, or undefined when nothing was billed
  const latestBilledMonth = () => db.bills.getLatestDate()?.slice(0, 7);

  // The trend over the `months` months that end on the `end` month (YYYY-MM), that one
  // included: 6 months, and the month of the latest bill, by default. Each of them, at 0
  // for a month without any bill, or none when none of them has a bill (#65). That of the
  // account the request asks for, or of every account without one (#120). By default, it
  // ends on the latest bill of any account for one account too: the trends of the accounts
  // then cover the same months, and add up to that of every account. With projected=true, the
  // month in progress costs its projected cost, and each month gives its projected part (#217).
  app.get('/api/analysis/monthly-trend', accountParameter, projectedParameter, (req, res) => {
    try {
      const { valid, error, from, to } = trendWindowFromQuery(req.query, latestBilledMonth());
      if (!valid) {
        return res.status(400).json({ error });
      }

      const data = db.analysis.monthlyTrend(from, to, req.account, { projected: req.projected });

      // Month names in French
      const monthNames = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Jun', 'Jul', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc'];

      const result = data.map(row => {
        const [year, month] = row.month.split('-');
        return {
          month: monthNames[parseInt(month) - 1],
          yearMonth: row.month,
          cost: Math.round(row.total * 100) / 100,
          ...projectedPartOf(req, () => Math.round(row.projected * 100) / 100),
        };
      });

      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Monthly trend broken down by resource type, shaped for a multi-line chart:
  // { categories: [{key, label, color}], data: [{ yearMonth, <key>: total, ... }] }
  // Over the same months as /api/analysis/monthly-trend, from the same parameters, the
  // account and the projection of the month in progress included (#120, #217). With
  // projected=true, each month gives the projected part of each resource type, as
  // `projected: { <key>: part, ... }`.
  app.get('/api/analysis/monthly-trend-by-category', accountParameter, projectedParameter,
    (req, res) => {
      try {
        const { valid, error, from, to } = trendWindowFromQuery(req.query, latestBilledMonth());
        if (!valid) {
          return res.status(400).json({ error });
        }

        const rows = db.analysis.monthlyTrendByResourceType(
          from, to, req.account, { projected: req.projected },
        );

        // Total per resource_type to order categories by spend.
        const totals = {};
        for (const r of rows) {
          totals[r.resource_type] = (totals[r.resource_type] || 0) + r.total;
        }

        const categories = Object.keys(totals)
          .sort((a, b) => totals[b] - totals[a])
          .map(key => ({
            key,
            label: RESOURCE_TYPE_LABELS[key] || key,
            color: RESOURCE_TYPE_COLORS[key] || RESOURCE_TYPE_COLORS['other']
          }));

        // One row per month with every category, in their order, so lines stay continuous: the
        // query gives every resource type in every month, at 0 when it was not billed (#65).
        // And, with projected=true, the projected part of each (#217).
        const byMonth = {};
        for (const r of rows) {
          byMonth[r.month] = byMonth[r.month] || {};
          byMonth[r.month][r.resource_type] = r;
        }
        // What a value of each resource type's row of a month is, in the order of the
        // categories, to the cent
        const ofResourceTypes = (rowsOfMonth, valueOf) => Object.fromEntries(categories.map(
          ({ key }) => [key, Math.round(valueOf(rowsOfMonth[key]) * 100) / 100],
        ));

        const data = Object.keys(byMonth)
          .sort((a, b) => a.localeCompare(b))
          .map((yearMonth) => ({
            yearMonth,
            ...ofResourceTypes(byMonth[yearMonth], (row) => row.total),
            ...projectedPartOf(req, () => ofResourceTypes(
              byMonth[yearMonth], (row) => row.projected,
            )),
          }));

        res.json({ categories, data });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

  // ========================
  // Summary Endpoint
  // ========================

  // The figures of a period: those of the account the request asks for, or of every account
  // without one (#115). With projected=true, the month in progress counts at its projected cost,
  // in every figure but the number of bills: the total gives its projected part, and so does
  // each of the top projects (#218).
  app.get('/api/summary', accountParameter, projectedParameter, (req, res) => {
    try {
      const { from, to } = req.query;
      const validation = validateDateRange(from, to);
      if (!validation.valid) {
        return res.status(400).json({ error: validation.error });
      }

      const options = { projected: req.projected };
      const summary = db.analysis.summary(from, to, req.account, options);
      const byProject = db.analysis.byProject(from, to, req.account, options);

      // Calculate daily average
      const startDate = new Date(from);
      const endDate = new Date(to);
      const days = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24)) + 1;

      const result = {
        period: { from, to },
        total: Math.round((summary.grand_total || 0) * 100) / 100,
        ...projectedPartOf(req, () => Math.round((summary.projected || 0) * 100) / 100),
        cloudTotal: Math.round((summary.cloud_total || 0) * 100) / 100,
        nonCloudTotal: Math.round((summary.non_cloud_total || 0) * 100) / 100,
        dailyAverage: Math.round(((summary.grand_total || 0) / days) * 100) / 100,
        billsCount: summary.bills_count || 0,
        projectsCount: summary.projects_count || 0,
        topProjects: byProject.slice(0, 5).map(p => ({
          name: p.project_name || 'Unknown',
          value: Math.round(p.total * 100) / 100,
          ...projectedPartOf(req, () => Math.round(p.projected * 100) / 100),
        }))
      };

      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ========================
  // Import Status Endpoint
  // ========================

  app.get('/api/import/status', (req, res) => {
    try {
      const latest = db.importLog.getLatest();
      const all = db.importLog.getAll().slice(0, 10); // Last 10 imports

      res.json({
        latest,
        // Same rule as the resync route; the dashboard polls while it is true
        running: db.importLog.isRunning(),
        history: all
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Manual resync: spawn a differential import in the background.
  // Rate-limited to once per hour (importLimiter) and guarded against
  // overlapping a run already in progress.
  app.post('/api/import/run', importLimiter, (req, res) => {
    try {
      // IMPORT_ENABLED=false turns off manual imports as well as the cron
      if (!importsEnabled()) {
        return res.status(409).json({ error: 'syncDisabled' });
      }
      if (db.importLog.isRunning()) {
        return res.status(409).json({ error: 'syncRunning' });
      }

      // Same options as the cron (scripts/cron-import.sh): --diff plus
      // IMPORT_FLAGS split on spaces, --all by default
      const flags = (process.env.IMPORT_FLAGS || '--all').split(/\s+/).filter(Boolean);
      const importScript = path.resolve(__dirname, '..', 'data', 'import.js');
      const child = spawn(process.execPath, [importScript, '--diff', ...flags], {
        detached: true,
        // Keep the import output, errors included, in the server logs
        stdio: ['ignore', 'inherit', 'inherit'],
        env: process.env
      });
      child.on('error', (err) => console.error('Manual import spawn failed:', err.message));
      child.unref();

      res.status(202).json({ started: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ========================
  // Accounts Endpoint
  // ========================

  // The entry of the Unknown account (see CONTEXT.md), which holds the rows stored before the
  // accounts that no configured account claimed (#114). Its id is the value that the account
  // parameter of the other routes takes for it (#115).
  const UNKNOWN_ACCOUNT_ENTRY = Object.freeze({
    id: db.UNKNOWN_ACCOUNT,
    nic: null,
    name: null,
    budget: null,
    currency: null,
    configured: false,
    unknown: true,
    lastImport: null,
    lastSuccessAt: null
  });

  // The accounts that the imports recorded, for tools and the dashboard to present them and
  // tell whether their data is fresh (#112). Empty until the first import after the upgrade.
  // The name is the one that the account's entry of config.json had at its last import, as
  // only an import can tell which account an entry's credentials lead to, or else its NIC
  // handle (#113): an entry never imported is not listed. So is the budget, null when the
  // entry gives none, which the dashboard compares the account's figures with (#117): imported
  // data, which the dashboard reloads with the accounts once an import is over, where the
  // configuration route gives the dashboard budget of config.json, as before the accounts. An
  // account no longer configured keeps both, and the Unknown account has neither. lastImport
  // is null until an import of the account has ended, and lastSuccessAt, when the last that
  // succeeded ended, until one has, whatever the imports that failed since (#124). The
  // accounts that the configuration of the last import lists come first, in its order, then
  // those it no longer lists, which keep their data but are no longer imported, and the
  // Unknown account, while it holds rows (#114). An account's id, its NIC handle, is the value
  // that the account parameter of the other routes takes.
  const listAccounts = () => {
    const accounts = db.accounts.getAll().map(account => ({
      id: account.nic,
      nic: account.nic,
      name: account.name ?? account.nic,
      budget: account.budget,
      currency: account.currency,
      configured: account.configured,
      unknown: false,
      lastImport: account.last_import_at === null ? null : {
        at: account.last_import_at,
        status: account.last_import_status,
        error: account.last_import_error
      },
      lastSuccessAt: account.last_success_at
    }));
    if (db.accounts.hasRowsWithoutAccount()) accounts.push(UNKNOWN_ACCOUNT_ENTRY);
    return accounts;
  };

  // Whether the database holds several accounts: two at least of those that the accounts
  // route lists, the Unknown account and the accounts no longer configured included, as the
  // dashboard offers the account selector then (offersAccounts(), in
  // dashboard/src/utils/accounts.js). The CSV exports then name the account of each row
  // (#137), and a single-account installation keeps its files as they were.
  const holdsSeveralAccounts = () => listAccounts().length >= 2;

  app.get('/api/accounts', (req, res) => {
    try {
      res.json(listAccounts());
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ========================
  // Available months endpoint (for selectors)
  // ========================

  // The months billed to the account the request asks for, or to any account without one
  // (#115). The month in progress carries `inProgress: true` (#216), the others no mark.
  app.get('/api/months', accountParameter, (req, res) => {
    try {
      const months = db.bills.getMonths(req.account);
      const monthInProgress = db.bills.getMonthInProgress(req.account);

      // Format months with French labels
      const monthNames = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
        'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];

      const result = months.map(yearMonth => {
        const [year, month] = yearMonth.split('-');
        return {
          value: yearMonth,
          label: `${monthNames[parseInt(month) - 1]} ${year}`,
          ...monthBounds(yearMonth),
          ...(yearMonth === monthInProgress ? { inProgress: true } : {}),
        };
      });

      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ========================
  // Config Endpoint
  // ========================

  app.get('/api/config', (req, res) => {
    res.json({
      budget: config.dashboard?.budget || 50000,
      currency: config.dashboard?.currency || 'EUR',
      // Whether the server runs imports, on the resync route's rule: the dashboard reads it
      // to offer the resync or not (#51)
      importEnabled: importsEnabled(),
      // The version of OCM that runs, which the footer shows (#188): behind authentication as
      // this route is, where the health check, open to all, does not give it
      version: OCM_VERSION,
    });
  });

  // ========================
  // User info (for frontend)
  // ========================

  app.get('/api/user', (req, res) => {
    const response = req.user || { id: null, name: 'Anonymous', email: null };
    // Add auth info for frontend
    response.authEnabled = authConfig.auth?.enabled || false;
    if (authConfig.auth?.enabled && !req.user) {
      response.loginUrl = '/auth/login';
    }
    res.json(response);
  });

  // ========================
  // CSV Export Endpoints
  // ========================

  /**
   * Convert array of objects to CSV string
   * @param {Array} data - Array of objects
   * @param {Array} columns - Column definitions [{key, label}]
   * @returns {string} CSV content
   */
  function toCSV(data, columns) {
    const header = columns.map(c => `"${c.label}"`).join(';');
    const rows = data.map(row => {
      return columns.map(c => {
        const value = row[c.key];
        if (value === null || value === undefined) return '';
        if (typeof value === 'number') return value.toString().replace('.', ',');
        return `"${String(value).replace(/"/g, '""')}"`;
      }).join(';');
    });
    return [header, ...rows].join('\n');
  }

  // The column of the CSV exports that names the account of each row, for a spreadsheet to
  // pivot the rows by account (#137): the NIC handle, which toCSV() leaves empty for the Unknown
  // account, null. Named as the account parameter, and last, so that the other columns keep
  // the places that a single-account installation's files give them.
  const ACCOUNT_COLUMN = Object.freeze({ key: 'account', label: 'account' });

  /**
   * Answers a request with the CSV file of an export, as every export writes it: a byte order
   * mark, for Excel to read the file as UTF-8, then its rows under their columns, and the
   * account column after them when the database holds several accounts (#137)
   * @param {object} res - The Express response
   * @param {string} filename - The name of the file
   * @param {object[]} rows - Its rows, each with `account`, the NIC handle of its account, null
   *   for the Unknown account, which the account column shows
   * @param {Array<{key: string, label: string}>} columns - Its own columns
   * @param {boolean} [severalAccounts] - Whether the database holds several accounts, as the
   *   export read it for its rows when they depend on it, so that a request reads it once:
   *   holdsSeveralAccounts() by default
   */
  function sendCsv(res, filename, rows, columns, severalAccounts = holdsSeveralAccounts()) {
    const csv = toCSV(rows, severalAccounts ? [...columns, ACCOUNT_COLUMN] : columns);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send('\ufeff' + csv); // BOM for Excel UTF-8 compatibility
  }

  // The bills of a period as CSV: those of the account the request asks for, or of every
  // account without one, each with its account when the database holds several (#137)
  app.get('/api/export/bills', accountParameter, (req, res) => {
    try {
      const { from, to } = req.query;
      const validation = validateDateRange(from, to);
      if (!validation.valid) {
        return res.status(400).json({ error: validation.error });
      }

      const bills = db.bills.getAll(from, to, req.account);

      const columns = [
        { key: 'id', label: 'Facture' },
        { key: 'date', label: 'Date' },
        { key: 'price_without_tax', label: 'Montant HT' },
        { key: 'price_with_tax', label: 'Montant TTC' },
        { key: 'tax', label: 'TVA' },
        { key: 'currency', label: 'Devise' }
      ];

      const filename = `factures_${from}_${to}.csv`;
      sendCsv(res, filename, bills, columns);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // The bill lines of a period as CSV: those of the bills of the account the request asks for,
  // or of every account without one, each with its bill's account when the database holds
  // several (#137)
  app.get('/api/export/details', accountParameter, (req, res) => {
    try {
      const { from, to } = req.query;
      const validation = validateDateRange(from, to);
      if (!validation.valid) {
        return res.status(400).json({ error: validation.error });
      }

      const details = db.details.getByPeriod(from, to, req.account);

      const columns = [
        { key: 'bill_id', label: 'Facture' },
        { key: 'date', label: 'Date' },
        { key: 'project_name', label: 'Projet' },
        { key: 'service_type', label: 'Type Service' },
        { key: 'resource_type', label: 'Type Ressource' },
        { key: 'description', label: 'Description' },
        { key: 'quantity', label: 'Quantite' },
        { key: 'unit_price', label: 'Prix Unitaire' },
        { key: 'total_price', label: 'Prix Total' },
        { key: 'payment_status', label: 'Statut Paiement' }
      ];

      const filename = `details_${from}_${to}.csv`;
      sendCsv(res, filename, details, columns);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // The costs of each project of a period as CSV: those of the account the request asks for,
  // or of every account without one (#137). When the database holds several accounts, a
  // project comes once for each account that billed it, with that account, as the dashboard's
  // lists that name the account of each project give them (#118): its costs are not summed
  // across accounts in a row that could name only one of them.
  app.get('/api/export/by-project', accountParameter, (req, res) => {
    try {
      const { from, to } = req.query;
      const validation = validateDateRange(from, to);
      if (!validation.valid) {
        return res.status(400).json({ error: validation.error });
      }

      const severalAccounts = holdsSeveralAccounts();
      const data = db.analysis.byProject(from, to, req.account, { byAccount: severalAccounts });

      const columns = [
        { key: 'project_name', label: 'Projet' },
        { key: 'project_id', label: 'ID Projet' },
        { key: 'total', label: 'Total HT' },
        { key: 'details_count', label: 'Nb Lignes' }
      ];

      const filename = `couts_par_projet_${from}_${to}.csv`;
      sendCsv(res, filename, data, columns, severalAccounts);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ========================
  // Consumption Endpoints (Phase 1)
  // ========================

  // What tells the consumption of the account a request asks for, or of every account without
  // one, and that of every account, whose latest month is the current one (#116)
  const consumptionOfAccounts = (account) => {
    const every = db.consumption.getCurrentByAccount();
    return { every, asked: account === null ? every : db.consumption.getCurrentByAccount(account) };
  };

  // The current month's consumption so far of the account the request asks for, or, without
  // one, the sum of the accounts' (#116), in the current month: the latest that an account's
  // covers. An account whose latest is of an earlier month has none. When the last imports of
  // the accounts fall on either side of a month's end, those of the month before add nothing
  // until they are imported again. See server/consumption.js.
  app.get('/api/consumption/current', accountParameter, (req, res) => {
    try {
      res.json(currentConsumption(consumptionOfAccounts(req.account), new Date()));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // The current month's month-end forecast of the account the request asks for, or, without
  // one, the sum of the accounts' (#116), in the current month, as the consumption above
  app.get('/api/consumption/forecast', accountParameter, (req, res) => {
    try {
      res.json(consumptionForecast(consumptionOfAccounts(req.account), new Date()));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // The consumption history of the account the request asks for, or, without one, that of
  // every account, whose entries for a period add up (#116)
  app.get('/api/consumption/usage-history', accountParameter, (req, res) => {
    try {
      const { from, to } = req.query;
      const history = db.consumption.getHistory(from, to, req.account);
      const result = history.map(h => ({
        period_start: h.period_start,
        period_end: h.period_end,
        total: Math.round((h.total || 0) * 100) / 100,
        currency: h.currency,
        service_type: h.service_type
      }));
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ========================
  // Carbon footprint (#147)
  // ========================

  // The carbon footprint of a month, that OVHcloud's carbon calculator attributes to the
  // services of the account the request asks for, or of every account without one: its
  // location-based footprint by emission source and in total, in kg CO2eq, and its market-based
  // total, null when the month has none; the latest month that has one (#152), which the
  // dashboard shows when the month has none; and, for all accounts, the accounts that have
  // none that month (#153), which their sum leaves out, null for one account
  app.get('/api/carbon/footprint', accountParameter, (req, res) => {
    try {
      const { valid, error, month } = monthFromQuery(req.query);
      if (!valid) {
        return res.status(400).json({ error });
      }
      res.json({
        month,
        footprint: db.carbon.getMonthFootprint(month, req.account),
        latestMonth: db.carbon.getLatestMonth(req.account),
        accountsWithoutFootprint: req.account === null
          ? db.carbon.getAccountsWithoutFootprint(month)
          : null,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // The carbon footprint of the 12 months that end on the `end` month (#154), of the account
  // the request asks for, or of every account without one: each month's location-based
  // footprint by emission source and in total, in kg CO2eq, null for a month without one, the
  // earliest month first
  app.get('/api/carbon/trend', accountParameter, (req, res) => {
    try {
      const { valid, error, month: end } = monthFromQuery(req.query, 'end');
      if (!valid) {
        return res.status(400).json({ error });
      }
      res.json(db.carbon.getTrend(end, req.account));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // The lines of a month's carbon footprint (#155), of the account the request asks for, or
  // of every account without one: each dedicated server, instance flavor and volume type that
  // OVHcloud's file names, per datacenter, and the servers that it does not name in one line,
  // with what their bill lines cost in the month of use and their intensity; and the covered
  // cost of the month of use, with its share of that month's cost (#157)
  app.get('/api/carbon/by-server', accountParameter, (req, res) => {
    try {
      const { valid, error, month } = monthFromQuery(req.query);
      if (!valid) {
        return res.status(400).json({ error });
      }
      res.json({ month, ...db.carbon.getTies(month, req.account) });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // The lines of a month's carbon footprint as CSV (#156), as /api/carbon/by-server gives
  // them: those of the account the request asks for, or of every account without one, each
  // with its account when the database holds several
  app.get('/api/export/carbon', accountParameter, (req, res) => {
    try {
      const { valid, error, month } = monthFromQuery(req.query);
      if (!valid) {
        return res.status(400).json({ error });
      }

      const lines = db.carbon.getTies(month, req.account).lines.map(line => ({
        ...line,
        // What the line names: a dedicated server, or the servers that OVHcloud's file does
        // not name, or an instance flavor or a volume type
        item: line.unnamedServers
          ? `Serveurs dédiés non nommés par OVHcloud (${line.unnamedServers})`
          : line.serverDomain ?? line.name,
      }));
      const columns = [
        { key: 'item', label: 'Élément' },
        { key: 'type', label: 'Type' },
        { key: 'range', label: 'Gamme' },
        { key: 'datacenter', label: 'Datacenter' },
        { key: 'footprint', label: 'Empreinte (kgCO2e)' },
        { key: 'cost', label: 'Coût' },
        { key: 'intensity', label: 'Intensité (kgCO2e/€)' },
      ];

      sendCsv(res, `empreinte_carbone_${month}.csv`, lines, columns);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ========================
  // Account Endpoints (Phase 2)
  // ========================

  // The latest balance of the account the request asks for, or, without one, the sum of every
  // account's latest of the latest month that one was taken in (#116): one of an earlier
  // month, such as a removed account's, adds nothing, nor, when the last imports of the
  // accounts fall on either side of a month's end, one of the month before until its account
  // is imported again. See balance.getBalance() in data/db.js.
  app.get('/api/account/balance', accountParameter, (req, res) => {
    try {
      const balance = db.balance.getBalance(req.account);
      if (!balance) {
        return res.json({ debt_balance: 0, credit_balance: 0, deposit_total: 0, currency: 'EUR' });
      }
      res.json({
        snapshot_date: balance.snapshot_date,
        debt_balance: Math.round((balance.debt_balance || 0) * 100) / 100,
        credit_balance: Math.round((balance.credit_balance || 0) * 100) / 100,
        deposit_total: Math.round((balance.deposit_total || 0) * 100) / 100,
        net_balance: Math.round(((balance.credit_balance || 0) - (balance.debt_balance || 0)) * 100) / 100,
        currency: balance.currency
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // The credit movements of the account the request asks for, or of every account without one
  // (#116)
  app.get('/api/account/credits', accountParameter, (req, res) => {
    try {
      const movements = db.balance.getCreditMovements(req.account);
      res.json(movements);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // The debt of the balance of the account the request asks for, or of every account without
  // one, as the balance above (#116)
  app.get('/api/account/debts', accountParameter, (req, res) => {
    try {
      const balance = db.balance.getBalance(req.account);
      res.json({
        debt_balance: Math.round((balance?.debt_balance || 0) * 100) / 100,
        currency: balance?.currency || 'EUR'
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/bills/:id/payment', (req, res) => {
    try {
      const bill = db.bills.getById(req.params.id);
      if (!bill) {
        return res.status(404).json({ error: 'Bill not found' });
      }
      res.json({
        bill_id: bill.id,
        payment_type: bill.payment_type || null,
        payment_date: bill.payment_date || null,
        payment_status: bill.payment_status || null
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ========================
  // Inventory Endpoints (Phase 3)
  // ========================

  // The services of the inventories, dedicated servers, VPS and storage services: those of the
  // account the request asks for, or of every account without one (#123). Each names its
  // account, null for the Unknown account; a service that two accounts' APIs list is stored,
  // and listed, once (ADR 0002).
  app.get('/api/inventory/servers', accountParameter, (req, res) => {
    try {
      const servers = db.inventory.getAllServers(req.account);
      const result = servers.map(s => ({
        ...s,
        disk_info: s.disk_info ? JSON.parse(s.disk_info) : []
      }));
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/inventory/vps', accountParameter, (req, res) => {
    try {
      const vps = db.inventory.getAllVps(req.account);
      const result = vps.map(v => ({
        ...v,
        ip_addresses: v.ip_addresses ? JSON.parse(v.ip_addresses) : []
      }));
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/inventory/storage', accountParameter, (req, res) => {
    try {
      const storage = db.inventory.getAllStorage(req.account);
      res.json(storage);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // How many services the inventories of the account the request asks for hold, and how many
  // expire within 30 days, as the route of those lists them: those of every account without
  // one (#123)
  app.get('/api/inventory/summary', accountParameter, (req, res) => {
    try {
      const summary = db.inventory.getSummary(req.account);
      const expiring = db.inventory.getExpiringServices(30, req.account);
      res.json({
        ...summary,
        total: summary.servers + summary.vps + summary.storage + summary.cloud_projects,
        expiring_soon: expiring.length
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // The services about to expire, which the Overview lists and the header counts: those of
  // the account the request asks for, or of every configured account without one, each with
  // its account, null for the Unknown account (#123). The Unknown account's, and those of an
  // account no longer configured, which no import refreshes, show with their own account.
  app.get('/api/inventory/expiring', accountParameter, (req, res) => {
    try {
      const days = parseInt(req.query.days) || 30;
      const expiring = db.inventory.getExpiringServices(days, req.account);
      res.json(expiring);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // The costs of each resource type of a period, for the account the request asks for, or for
  // every account without one (#118). With projected=true, the month in progress costs its
  // projected cost, and each resource type gives its projected part (#218).
  app.get('/api/analysis/by-resource-type', accountParameter, projectedParameter, (req, res) => {
    try {
      const { from, to } = req.query;
      const validation = validateDateRange(from, to);
      if (!validation.valid) {
        return res.status(400).json({ error: validation.error });
      }

      const data = db.inventory.byResourceType(from, to, req.account, {
        projected: req.projected,
      });

      const result = data.map(row => ({
        name: RESOURCE_TYPE_LABELS[row.resource_type] || row.resource_type || 'Other',
        resource_type: row.resource_type || 'other',
        value: Math.round(row.total * 100) / 100,
        color: RESOURCE_TYPE_COLORS[row.resource_type] || RESOURCE_TYPE_COLORS['other'],
        detailsCount: row.details_count,
        serviceCount: row.service_count,
        ...projectedPartOf(req, () => Math.round(row.projected * 100) / 100),
      }));

      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // The bill lines of a resource type in a period, by service, which the Infrastructure tab
  // lists under each resource type, the Private Cloud hosts and datastores included: those of
  // the account the request asks for, or of every account without one (#123). Once each
  // service, as before, or, by account, once for each account that billed it, with that
  // account: its NIC handle, or null for the Unknown account. With projected=true, the month in
  // progress counts the projected lines of the resource type too, a service that they alone make
  // included, and each service gives its projected part (#218).
  app.get('/api/analysis/resource-type-details', accountParameter, byAccountParameter,
    projectedParameter, (req, res) => {
      try {
        const { type, from, to } = req.query;
        if (!type) return res.status(400).json({ error: 'type parameter is required' });
        const validation = validateDateRange(from, to);
        if (!validation.valid) return res.status(400).json({ error: validation.error });
        const data = db.inventory.byResourceTypeDetails(
          type, from, to, req.account, { byAccount: req.byAccount, projected: req.projected },
        );
        res.json(data);
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

  // The figures of the Public Cloud cards: those of the account the request asks for, or of
  // every account without one (#121)
  app.get('/api/analysis/public-cloud-stats', accountParameter, (req, res) => {
    try {
      const { from, to } = req.query;
      const validation = validateDateRange(from, to);
      if (!validation.valid) return res.status(400).json({ error: validation.error });
      const data = db.inventory.getPublicCloudStats(from, to, req.account);
      res.json(data);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // The AI Endpoints models that the bills of a period name (#193), which the Public Cloud tab
  // lists: each model's input tokens, output tokens and cost, the most expensive first, and
  // what they cost in all. And the cost of each model in each month of the bills that name a
  // model, which the Trends tab charts, every model in every month (#196). Those of the bills
  // of the account the request asks for, or of every account without one.
  app.get('/api/analysis/ai-endpoints', accountParameter, (req, res) => {
    try {
      const { from, to } = req.query;
      const validation = validateDateRange(from, to);
      if (!validation.valid) return res.status(400).json({ error: validation.error });
      const { total, models, monthlyTrend } = db.analysis.aiEndpoints(from, to, req.account);
      res.json({
        total,
        models: models.map(({ model, tokens, cost }) => ({
          model, inputTokens: tokens.input, outputTokens: tokens.output, total: cost,
        })),
        monthlyTrend,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // The Veeam backups of a month: those of the account the request asks for, or of every
  // account without one (#119), as the Compare and Backup tabs show them. With projected=true,
  // the month in progress counts its projected lines too, and each kind gives its projected part
  // (#218).
  app.get('/api/analysis/backup-stats', accountParameter, projectedParameter, (req, res) => {
    try {
      const { from, to } = req.query;
      const validation = validateDateRange(from, to);
      if (!validation.valid) return res.status(400).json({ error: validation.error });
      const data = db.inventory.getBackupStats(from, to, req.account, {
        projected: req.projected,
      });
      res.json(data);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // The services of the Veeam backups of a month (#197): the VMs backed up and the Enterprise
  // licences, which the Compare tab's backup comparison unfolds its two rows into, those of the
  // account the request asks for, or of every account without one, and with byAccount, each
  // once for each account that billed it, with that account. With projected=true, those of the
  // projected lines of the month in progress too, each with its projected part (#218).
  app.get('/api/analysis/backup-services', accountParameter, byAccountParameter,
    projectedParameter, (req, res) => {
      try {
        const { from, to } = req.query;
        const validation = validateDateRange(from, to);
        if (!validation.valid) return res.status(400).json({ error: validation.error });
        const data = db.inventory.getBackupServices(
          from, to, req.account, { byAccount: req.byAccount, projected: req.projected },
        );
        res.json(data);
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

  // ========================
  // Cloud Project Detail Endpoints (Phase 4)
  // ========================

  app.get('/api/projects/:id/consumption', (req, res) => {
    try {
      const { from, to } = req.query;
      const data = db.cloudDetails.getConsumptionByProject(req.params.id, from, to);
      res.json(data);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/projects/:id/consumption/by-resource', (req, res) => {
    try {
      const data = db.cloudDetails.getConsumptionByResourceType(req.params.id);
      res.json(data);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ========================
  // Web Cloud (domains, DNS, hosting, email)
  // ========================

  // The Web Cloud services billed over a period, and their count and cost by family: those
  // of the account the request asks for, or of every account without one (#122)
  app.get('/api/web-cloud/summary', accountParameter, (req, res) => {
    try {
      const { from, to } = req.query;
      const validation = validateDateRange(from, to);
      if (!validation.valid) return res.status(400).json({ error: validation.error });
      res.json(db.webCloud.getSummary(from, to, req.account));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/web-cloud/items', accountParameter, (req, res) => {
    try {
      const { from, to } = req.query;
      const validation = validateDateRange(from, to);
      if (!validation.valid) return res.status(400).json({ error: validation.error });
      const items = db.webCloud.getItems(from, to, req.account).map(i => ({
        name: i.name,
        // The NIC handle of the account whose bills billed it, null for the Unknown account
        account: i.account,
        category: i.category,
        description: i.description,
        lineCount: i.line_count,
        firstDate: i.first_date,
        lastDate: i.last_date,
        total: i.total
      }));
      res.json(items);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/projects/:id/instances', (req, res) => {
    try {
      // from/to are optional: without them the list carries no cost
      const { from, to } = req.query;
      if (from || to) {
        const validation = validateDateRange(from, to);
        if (!validation.valid) return res.status(400).json({ error: validation.error });
      }
      const instances = db.cloudDetails.getInstancesByProject(req.params.id, from, to);
      res.json(instances);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/projects/:id/quotas', (req, res) => {
    try {
      const quotas = db.cloudDetails.getQuotasByProject(req.params.id);
      res.json(quotas);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/projects/:id/buckets', (req, res) => {
    try {
      const { from, to } = req.query;
      const validation = validateDateRange(from, to);
      if (!validation.valid) return res.status(400).json({ error: validation.error });
      const buckets = db.cloudDetails.getBucketsByProject(req.params.id, from, to);
      // type is null when the inventory holds no class: bucket billed but not
      // in the inventory (deleted, or inventory not imported), or class that
      // could not be read (empty bucket, object listing refused). The bill line
      // cannot tell, it reads "Stockage Standard" for every class. Do not guess
      // a class here, the UI shows it as unknown.
      const result = buckets.map(b => ({
        name: b.name,
        type: b.storage_class,
        region: b.region,
        status: b.status,
        objectsCount: b.objects_count,
        objectsSize: b.objects_size,
        createdAt: b.created_at,
        inInventory: b.in_inventory === 1,
        // true when the cost is a share of an aggregated bill line, not a
        // figure billed under this bucket's name (Cold Archive)
        allocated: b.allocated === true,
        total: b.total
      }));
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // The products of a project over a period that its detail shows no section of its own for,
  // its registry among them, with their cost, and the credit that its bills used (#145)
  app.get('/api/projects/:id/other-services', (req, res) => {
    try {
      const { from, to } = req.query;
      const validation = validateDateRange(from, to);
      if (!validation.valid) return res.status(400).json({ error: validation.error });
      res.json(db.cloudDetails.getOtherServicesByProject(req.params.id, from, to));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Every product of a project over a period, from its bills, with its cost and its charges,
  // and the credit that they used (#181, #195): what the Compare tab compares for a project,
  // month by month, and unfolds each product into. Those of the bills of the account the
  // request asks for, or of every account without one, as /api/analysis/by-project, whose cost
  // of the project they break down: a project's bill lines belong to the account of their bill,
  // which may not be the project's own (ADR 0002).
  app.get('/api/projects/:id/products', accountParameter, (req, res) => {
    try {
      const { from, to } = req.query;
      const validation = validateDateRange(from, to);
      if (!validation.valid) return res.status(400).json({ error: validation.error });
      res.json(db.cloudDetails.getProductsByProject(req.params.id, from, to, req.account));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/projects/:id/volumes', (req, res) => {
    try {
      const { from, to } = req.query;
      const validation = validateDateRange(from, to);
      if (!validation.valid) return res.status(400).json({ error: validation.error });
      const volumes = db.cloudDetails.getVolumesByProject(req.params.id, from, to).map(v => ({
        id: v.id,
        name: v.name,
        region: v.region,
        type: v.type,
        sizeGb: v.size_gb,
        status: v.status,
        bootable: v.bootable === 1,
        // null, not [], on a bill line with no volume behind it: its attachment
        // is unknown, so it must not read as a detached volume
        attachedTo: v.in_inventory === 0 ? null : (v.attached_to ? v.attached_to.split(',') : []),
        createdAt: v.created_at,
        allocated: v.allocated === true,
        total: v.total
      }));
      res.json(volumes);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/projects/:id/snapshots', (req, res) => {
    try {
      const { from, to } = req.query;
      const validation = validateDateRange(from, to);
      if (!validation.valid) return res.status(400).json({ error: validation.error });
      const snapshots = db.cloudDetails.getSnapshotsByProject(req.params.id, from, to).map(s => ({
        id: s.id,
        name: s.name,
        region: s.region,
        sizeGb: s.size_gb,
        status: s.status,
        visibility: s.visibility,
        osType: s.os_type,
        createdAt: s.created_at,
        allocated: s.allocated === true,
        total: s.total
      }));
      res.json(snapshots);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/projects/:id/savings-plans', (req, res) => {
    try {
      const { from, to } = req.query;
      const validation = validateDateRange(from, to);
      if (!validation.valid) return res.status(400).json({ error: validation.error });
      const plans = db.cloudDetails.getSavingsPlansByProject(req.params.id, from, to).map(p => ({
        id: p.id,
        flavor: p.flavor,
        duration: p.duration,
        covered: p.covered,
        flavorCovered: p.flavor_covered,
        inventory: p.inventory,
        months: p.months,
        firstDate: p.first_date,
        lastDate: p.last_date,
        total: p.total
      }));
      res.json(plans);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/projects/:id/instance-total', (req, res) => {
    try {
      const { from, to } = req.query;
      const validation = validateDateRange(from, to);
      if (!validation.valid) return res.status(400).json({ error: validation.error });
      const result = db.cloudDetails.getInstanceTotalByProject(req.params.id, from, to);
      res.json({ total: result?.total || 0 });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ========================
  // GPU Cost Endpoints
  // ========================

  // The GPU costs of the account the request asks for, and the GPU instances of its projects,
  // or those of every account without one (#120). Its projects come once each, or, by
  // account, once for each account that billed them, with that account: its NIC handle, or
  // null for the Unknown account (#118).
  app.get('/api/gpu/summary', accountParameter, byAccountParameter, (req, res) => {
    try {
      const { from, to } = req.query;
      const gpuData = db.cloudDetails.getGpuSummary(
        from || null, to || null, req.account, { byAccount: req.byAccount },
      );
      const gpuInstances = db.cloudDetails.getGpuInstances(req.account);

      const modelColors = {
        'NVIDIA L4': '#22c55e',
        'NVIDIA L40S': '#3b82f6',
        'NVIDIA A100': '#ef4444',
        'NVIDIA H100': '#8b5cf6',
        'NVIDIA V100': '#f59e0b',
        'NVIDIA T4': '#06b6d4'
      };

      res.json({
        total: Math.round((gpuData.total || 0) * 100) / 100,
        project_count: gpuData.project_count || 0,
        byModel: gpuData.byModel.map(m => ({
          gpu_model: m.gpu_model,
          total: Math.round(m.total * 100) / 100,
          count: m.count,
          color: modelColors[m.gpu_model] || '#6b7280'
        })),
        byProject: gpuData.byProject.map(p => ({
          project_name: p.project_name,
          project_id: p.project_id,
          total: Math.round(p.total * 100) / 100,
          gpu_flavors: p.gpu_flavors,
          ...(req.byAccount ? { account: p.account } : {})
        })),
        monthlyTrend: gpuData.monthlyTrend.map(m => ({
          month: m.month,
          total: Math.round(m.total * 100) / 100
        })),
        instances: gpuInstances.map(i => ({
          id: i.id,
          name: i.name,
          project_name: i.project_name,
          project_id: i.project_id,
          plan_code: i.plan_code,
          flavor: i.flavor,
          region: i.region,
          status: i.status,
          monthly_billing: i.monthly_billing
        }))
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ========================
  // Enhanced CSV Export Endpoints (Phase 5)
  // ========================

  // The dedicated servers, VPS and storage services of the inventory as CSV: those of the
  // account the request asks for, or of every account without one, each with its account when
  // the database holds several (#137). A service that two accounts' APIs list is stored, and
  // exported, once (ADR 0002).
  app.get('/api/export/inventory', accountParameter, (req, res) => {
    try {
      const servers = db.inventory.getAllServers(req.account);
      const vps = db.inventory.getAllVps(req.account);
      const storage = db.inventory.getAllStorage(req.account);

      // Combine into a single export
      const data = [
        ...servers.map(s => ({
          type: 'Dedicated Server',
          id: s.id,
          name: s.display_name,
          location: s.datacenter,
          specs: `${s.cpu} / ${s.ram_size}MB RAM`,
          state: s.state,
          expiration: s.expiration_date || '',
          renewal: s.renewal_type || '',
          account: s.account,
        })),
        ...vps.map(v => ({
          type: 'VPS',
          id: v.id,
          name: v.display_name,
          location: v.zone,
          specs: `${v.vcpus} vCPU / ${v.ram_mb}MB RAM / ${v.disk_gb}GB`,
          state: v.state,
          expiration: v.expiration_date || '',
          renewal: v.renewal_type || '',
          account: v.account,
        })),
        ...storage.map(s => ({
          type: 'Storage',
          id: s.id,
          name: s.display_name,
          location: s.region,
          specs: `${s.total_size_gb}GB`,
          state: '',
          expiration: s.expiration_date || '',
          renewal: '',
          account: s.account,
        }))
      ];

      const columns = [
        { key: 'type', label: 'Type' },
        { key: 'id', label: 'ID' },
        { key: 'name', label: 'Nom' },
        { key: 'location', label: 'Localisation' },
        { key: 'specs', label: 'Specifications' },
        { key: 'state', label: 'Etat' },
        { key: 'expiration', label: 'Expiration' },
        { key: 'renewal', label: 'Renouvellement' }
      ];

      const filename = `inventaire_${new Date().toISOString().split('T')[0]}.csv`;
      sendCsv(res, filename, data, columns);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ========================
  // Health check
  // ========================

  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

} // End of registerRoutes()

// ========================
// Start server
// ========================

initializeServer().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
