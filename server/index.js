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

// Import auth module
const auth = require('./auth');
const { createOriginCheck } = require('./cors');
const { createHostCheckMiddleware } = require('./hosts');
const { importsEnabled } = require('./imports');
const { trendWindowFromQuery } = require('./months');

// Load configuration
const CONFIG_PATHS = [
  path.resolve(__dirname, '..', 'config.json'),
  path.resolve(os.homedir(), 'my-ovh-bills', 'config.json')
];

let config = { dashboard: { budget: 50000, currency: 'EUR' } };

for (const configPath of CONFIG_PATHS) {
  try {
    if (fs.existsSync(configPath)) {
      const loadedConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      config = { ...config, ...loadedConfig };
      break;
    }
  } catch (e) {
    // Continue to next path
  }
}

// Rate limit configuration helper
function getRateLimitConfig() {
  const defaults = {
    enabled: true,
    trustProxy: false,
    api: {
      windowMs: 15 * 60 * 1000,
      max: 100
    },
    auth: {
      windowMs: 15 * 60 * 1000,
      max: 20
    }
  };

  // Start with config.json values
  const rateLimitConfig = config.rateLimit || {};

  // Merge with defaults
  const merged = {
    enabled: rateLimitConfig.enabled !== undefined ? rateLimitConfig.enabled : defaults.enabled,
    trustProxy: rateLimitConfig.trustProxy !== undefined ? rateLimitConfig.trustProxy : defaults.trustProxy,
    api: {
      windowMs: rateLimitConfig.api?.windowMs ?? defaults.api.windowMs,
      max: rateLimitConfig.api?.max ?? defaults.api.max
    },
    auth: {
      windowMs: rateLimitConfig.auth?.windowMs ?? defaults.auth.windowMs,
      max: rateLimitConfig.auth?.max ?? defaults.auth.max
    }
  };

  // Environment variables override config.json
  if (process.env.RATE_LIMIT_ENABLED !== undefined) {
    merged.enabled = process.env.RATE_LIMIT_ENABLED === 'true';
  }
  if (process.env.TRUST_PROXY !== undefined) {
    merged.trustProxy = process.env.TRUST_PROXY === 'true';
  }
  if (process.env.RATE_LIMIT_API_WINDOW_MS) {
    const val = parseInt(process.env.RATE_LIMIT_API_WINDOW_MS, 10);
    if (!isNaN(val) && val > 0) merged.api.windowMs = val;
  }
  if (process.env.RATE_LIMIT_API_MAX) {
    const val = parseInt(process.env.RATE_LIMIT_API_MAX, 10);
    if (!isNaN(val) && val > 0) merged.api.max = val;
  }
  if (process.env.RATE_LIMIT_AUTH_WINDOW_MS) {
    const val = parseInt(process.env.RATE_LIMIT_AUTH_WINDOW_MS, 10);
    if (!isNaN(val) && val > 0) merged.auth.windowMs = val;
  }
  if (process.env.RATE_LIMIT_AUTH_MAX) {
    const val = parseInt(process.env.RATE_LIMIT_AUTH_MAX, 10);
    if (!isNaN(val) && val > 0) merged.auth.max = val;
  }

  return merged;
}

const app = express();
const PORT = process.env.PORT || 3001;
const rateLimitConfig = getRateLimitConfig();

// Host check, against DNS rebinding (#78): none unless ALLOWED_HOSTS is set
const hostCheck = createHostCheckMiddleware({
  // A comma-separated string, or in config.json an array too
  allowedHosts: process.env.ALLOWED_HOSTS || config.allowedHosts,
  trustProxy: rateLimitConfig.trustProxy,
});

// CORS configuration - restrict to allowed origins and the request's own
const isAllowedOrigin = createOriginCheck({
  // Allowed origins from config or environment
  allowedOrigins: process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
    : config.allowedOrigins || [],
  isDev: process.env.NODE_ENV !== 'production',
  trustProxy: rateLimitConfig.trustProxy,
});

// Per-request options, as the check reads the request's headers
function corsOptionsDelegate(req, callback) {
  const origin = req.headers.origin;
  const allowed = isAllowedOrigin(origin, {
    host: req.headers.host,
    forwardedHost: req.headers['x-forwarded-host'],
    forwardedProto: req.headers['x-forwarded-proto'],
    encrypted: Boolean(req.socket.encrypted),
  });

  if (allowed) {
    callback(null, {
      origin: true,
      credentials: true, // Allow cookies for authentication
    });
  } else {
    console.warn(`CORS: Blocked request from origin: ${origin}`);
    callback(new Error('Not allowed by CORS'));
  }
}

// Rate limiting - protect against DoS and brute-force attacks
const apiLimiter = rateLimit({
  windowMs: rateLimitConfig.api.windowMs,
  max: rateLimitConfig.api.max,
  message: { error: 'Too many requests, please try again later' },
  standardHeaders: true, // Return rate limit info in `RateLimit-*` headers
  legacyHeaders: false, // Disable `X-RateLimit-*` headers
  skip: (req) => {
    // Skip rate limiting for health checks. Use originalUrl: this limiter is
    // mounted on '/api/', so req.path here is '/health' (prefix stripped),
    // which made the previous '/api/health' check never match.
    return (req.originalUrl || req.url).split('?')[0] === '/api/health';
  }
});

// Stricter rate limit for auth endpoints (prevent brute-force)
const authLimiter = rateLimit({
  windowMs: rateLimitConfig.auth.windowMs,
  max: rateLimitConfig.auth.max,
  message: { error: 'Too many authentication attempts, please try again later' },
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

// Trust proxy headers (for reverse proxy/load balancer)
if (rateLimitConfig.trustProxy) {
  app.set('trust proxy', 1);
}

// Middleware. The Host check comes first, so that a host that is not allowed
// gets no route, no static file and no CORS answer.
if (hostCheck) {
  app.use(hostCheck);
}
app.use(cors(corsOptionsDelegate));
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
  const authResult = await auth.initialize(app, db.getDb(), config);
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
      app.post('/logout/backchannel', express.urlencoded({ extended: false }), (req, res) => {
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
    auth.mountHeaderMode(app, { required: process.env.AUTH_REQUIRED === 'true' });
  }

  // Logging middleware (inside async to run after auth middleware)
  app.use((req, res, next) => {
    const user = req.user?.id || 'anonymous';
    console.log(`${new Date().toISOString()} [${user}] ${req.method} ${req.path}`);
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
      console.log(`     Trust proxy: ${rateLimitConfig.trustProxy ? 'enabled' : 'disabled'}`);
    } else {
      console.log(`   Rate limiting: disabled`);
    }

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

// ========================
// Route registration function
// ========================

function registerRoutes() {

  // ========================
  // Projects Endpoints
  // ========================

  app.get('/api/projects', (req, res) => {
    try {
      const projects = db.projects.getAll();
      res.json(projects);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/projects/enriched', (req, res) => {
    try {
      const database = db.getDb();
      // The current consumption: that of the month of the last import, which keeps the
      // other months (#54)
      const projects = database.prepare(`
      SELECT
        p.id, p.name, p.description, p.status,
        COALESCE(ci.instance_count, 0) as instance_count,
        COALESCE(pc.consumption_total, 0) as consumption_total,
        pc.period_start, pc.period_end
      FROM projects p
      LEFT JOIN (
        SELECT project_id, COUNT(*) as instance_count
        FROM cloud_instances
        GROUP BY project_id
      ) ci ON ci.project_id = p.id
      LEFT JOIN (
        SELECT project_id, SUM(total_price) as consumption_total,
               MIN(period_start) as period_start, MAX(period_end) as period_end
        FROM project_consumption
        WHERE period_start = ?
        GROUP BY project_id
      ) pc ON pc.project_id = p.id
      ORDER BY consumption_total DESC
    `).all(db.cloudDetails.getCurrentConsumptionMonth());
      res.json(projects);
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

  app.get('/api/bills', (req, res) => {
    try {
      const { from, to } = req.query;
      const bills = db.bills.getAll(from, to);
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

  app.get('/api/analysis/by-project', (req, res) => {
    try {
      const { from, to } = req.query;
      const validation = validateDateRange(from, to);
      if (!validation.valid) {
        return res.status(400).json({ error: validation.error });
      }

      const data = db.analysis.byProject(from, to);

      // Format response
      const result = data.map(row => ({
        projectId: row.project_id,
        projectName: row.project_name || 'Unknown',
        total: Math.round(row.total * 100) / 100,
        detailsCount: row.details_count
      }));

      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/analysis/by-service', (req, res) => {
    try {
      const { from, to } = req.query;
      const validation = validateDateRange(from, to);
      if (!validation.valid) {
        return res.status(400).json({ error: validation.error });
      }

      const data = db.analysis.byService(from, to);

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
        detailsCount: row.details_count
      }));

      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/analysis/daily-trend', (req, res) => {
    try {
      const { from, to } = req.query;
      const validation = validateDateRange(from, to);
      if (!validation.valid) {
        return res.status(400).json({ error: validation.error });
      }

      const data = db.analysis.dailyTrend(from, to);

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
  // for a month without any bill, or none when none of them has a bill (#65).
  app.get('/api/analysis/monthly-trend', (req, res) => {
    try {
      const { valid, error, from, to } = trendWindowFromQuery(req.query, latestBilledMonth());
      if (!valid) {
        return res.status(400).json({ error });
      }

      const data = db.analysis.monthlyTrend(from, to);

      // Month names in French
      const monthNames = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Jun', 'Jul', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc'];

      const result = data.map(row => {
        const [year, month] = row.month.split('-');
        return {
          month: monthNames[parseInt(month) - 1],
          yearMonth: row.month,
          cost: Math.round(row.total * 100) / 100
        };
      });

      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Monthly trend broken down by resource type, shaped for a multi-line chart:
  // { categories: [{key, label, color}], data: [{ yearMonth, <key>: total, ... }] }
  // Over the same months as /api/analysis/monthly-trend, from the same parameters.
  app.get('/api/analysis/monthly-trend-by-category', (req, res) => {
    try {
      const { valid, error, from, to } = trendWindowFromQuery(req.query, latestBilledMonth());
      if (!valid) {
        return res.status(400).json({ error });
      }

      const rows = db.analysis.monthlyTrendByResourceType(from, to);

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
      // query gives every resource type in every month, at 0 when it was not billed (#65)
      const byMonth = {};
      for (const r of rows) {
        byMonth[r.month] = byMonth[r.month] || {};
        byMonth[r.month][r.resource_type] = Math.round(r.total * 100) / 100;
      }

      const data = Object.keys(byMonth)
        .sort((a, b) => a.localeCompare(b))
        .map((yearMonth) => ({
          yearMonth,
          ...Object.fromEntries(categories.map(({ key }) => [key, byMonth[yearMonth][key]])),
        }));

      res.json({ categories, data });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ========================
  // Summary Endpoint
  // ========================

  app.get('/api/summary', (req, res) => {
    try {
      const { from, to } = req.query;
      const validation = validateDateRange(from, to);
      if (!validation.valid) {
        return res.status(400).json({ error: validation.error });
      }

      const summary = db.analysis.summary(from, to);
      const nonCloud = db.analysis.nonCloudTotal(from, to);
      const byProject = db.analysis.byProject(from, to);

      // Calculate daily average
      const startDate = new Date(from);
      const endDate = new Date(to);
      const days = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24)) + 1;

      const result = {
        period: { from, to },
        total: Math.round((summary.grand_total || 0) * 100) / 100,
        cloudTotal: Math.round((summary.cloud_total || 0) * 100) / 100,
        nonCloudTotal: Math.round((summary.non_cloud_total || 0) * 100) / 100,
        dailyAverage: Math.round(((summary.grand_total || 0) / days) * 100) / 100,
        billsCount: summary.bills_count || 0,
        projectsCount: summary.projects_count || 0,
        topProjects: byProject.slice(0, 5).map(p => ({
          name: p.project_name || 'Unknown',
          value: Math.round(p.total * 100) / 100
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
  // Available months endpoint (for selectors)
  // ========================

  app.get('/api/months', (req, res) => {
    try {
      const database = db.getDb();
      const months = database.prepare(`
      SELECT DISTINCT strftime('%Y-%m', date) as month
      FROM bills
      ORDER BY month DESC
    `).all();

      // Format months with French labels
      const monthNames = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
        'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];

      const result = months.map(row => {
        const [year, month] = row.month.split('-');
        return {
          value: row.month,
          label: `${monthNames[parseInt(month) - 1]} ${year}`,
          ...monthBounds(row.month)
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

  // Export bills as CSV
  app.get('/api/export/bills', (req, res) => {
    try {
      const { from, to } = req.query;
      const validation = validateDateRange(from, to);
      if (!validation.valid) {
        return res.status(400).json({ error: validation.error });
      }

      const bills = db.bills.getAll(from, to);

      const columns = [
        { key: 'id', label: 'Facture' },
        { key: 'date', label: 'Date' },
        { key: 'price_without_tax', label: 'Montant HT' },
        { key: 'price_with_tax', label: 'Montant TTC' },
        { key: 'tax', label: 'TVA' },
        { key: 'currency', label: 'Devise' }
      ];

      const csv = toCSV(bills, columns);
      const filename = `factures_${from}_${to}.csv`;

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send('\ufeff' + csv); // BOM for Excel UTF-8 compatibility
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Export bill details as CSV
  app.get('/api/export/details', (req, res) => {
    try {
      const { from, to } = req.query;
      const validation = validateDateRange(from, to);
      if (!validation.valid) {
        return res.status(400).json({ error: validation.error });
      }

      const database = db.getDb();
      const details = database.prepare(`
      SELECT
        d.bill_id,
        b.date,
        p.name as project_name,
        d.service_type,
        d.resource_type,
        d.description,
        d.quantity,
        d.unit_price,
        d.total_price,
        b.payment_status
      FROM bill_details d
      JOIN bills b ON d.bill_id = b.id
      LEFT JOIN projects p ON d.project_id = p.id
      WHERE b.date >= ? AND b.date <= ?
      ORDER BY b.date, d.bill_id
    `).all(from, to);

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

      const csv = toCSV(details, columns);
      const filename = `details_${from}_${to}.csv`;

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send('\ufeff' + csv);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Export costs by project as CSV
  app.get('/api/export/by-project', (req, res) => {
    try {
      const { from, to } = req.query;
      const validation = validateDateRange(from, to);
      if (!validation.valid) {
        return res.status(400).json({ error: validation.error });
      }

      const data = db.analysis.byProject(from, to);

      const columns = [
        { key: 'project_name', label: 'Projet' },
        { key: 'project_id', label: 'ID Projet' },
        { key: 'total', label: 'Total HT' },
        { key: 'details_count', label: 'Nb Lignes' }
      ];

      const csv = toCSV(data, columns);
      const filename = `couts_par_projet_${from}_${to}.csv`;

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send('\ufeff' + csv);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ========================
  // Consumption Endpoints (Phase 1)
  // ========================

  app.get('/api/consumption/current', (req, res) => {
    try {
      const snapshot = db.consumption.getLatestSnapshot();
      // If /me/consumption data is 0, use actual cloud project consumption instead
      const snapshotTotal = snapshot?.current_total || 0;
      if (snapshotTotal === 0) {
        const cloudSummary = db.cloudDetails.getConsumptionSummary();
        if (cloudSummary && cloudSummary.total > 0) {
          return res.json({
            snapshot_date: snapshot?.snapshot_date || new Date().toISOString(),
            period_start: cloudSummary.period_start,
            period_end: cloudSummary.period_end,
            current_total: Math.round(cloudSummary.total * 100) / 100,
            source: 'cloud_projects',
            project_count: cloudSummary.project_count,
            currency: 'EUR'
          });
        }
      }
      if (!snapshot) {
        return res.json({ current_total: 0, currency: 'EUR' });
      }
      const details = snapshot.raw_data ? JSON.parse(snapshot.raw_data) : null;
      res.json({
        snapshot_date: snapshot.snapshot_date,
        period_start: snapshot.period_start,
        period_end: snapshot.period_end,
        current_total: Math.round(snapshotTotal * 100) / 100,
        currency: snapshot.currency,
        source: 'me_consumption',
        details
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/consumption/forecast', (req, res) => {
    try {
      const snapshot = db.consumption.getLatestSnapshot();
      const snapshotForecast = snapshot?.forecast_total || 0;
      const snapshotCurrent = snapshot?.current_total || 0;

      // If /me/consumption forecast is 0, compute forecast from cloud project consumption
      if (snapshotForecast === 0 && snapshotCurrent === 0) {
        const cloudSummary = db.cloudDetails.getConsumptionSummary();
        if (cloudSummary && cloudSummary.total > 0) {
          const periodStart = new Date(cloudSummary.period_start);
          const periodEnd = new Date(cloudSummary.period_end);
          const daysElapsed = Math.max(1, Math.ceil((periodEnd - periodStart) / (1000 * 60 * 60 * 24)));
          // Forecast to end of month
          const lastDayOfMonth = new Date(periodStart.getFullYear(), periodStart.getMonth() + 1, 0).getDate();
          const dailyAvg = cloudSummary.total / daysElapsed;
          const forecastTotal = Math.round(dailyAvg * lastDayOfMonth * 100) / 100;
          const currentTotal = Math.round(cloudSummary.total * 100) / 100;
          const progress = Math.round((currentTotal / forecastTotal) * 100);

          return res.json({
            snapshot_date: new Date().toISOString(),
            period_start: cloudSummary.period_start,
            period_end: cloudSummary.period_end,
            forecast_total: forecastTotal,
            current_total: currentTotal,
            currency: 'EUR',
            progress,
            source: 'cloud_projects',
            days_elapsed: daysElapsed,
            days_in_month: lastDayOfMonth
          });
        }
      }
      if (!snapshot) {
        return res.json({ forecast_total: 0, currency: 'EUR' });
      }
      res.json({
        snapshot_date: snapshot.snapshot_date,
        period_start: snapshot.period_start,
        period_end: snapshot.period_end,
        forecast_total: Math.round(snapshotForecast * 100) / 100,
        current_total: Math.round(snapshotCurrent * 100) / 100,
        currency: snapshot.currency,
        progress: snapshotCurrent && snapshotForecast
          ? Math.round((snapshotCurrent / snapshotForecast) * 100)
          : 0
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/consumption/usage-history', (req, res) => {
    try {
      const { from, to } = req.query;
      const history = db.consumption.getHistory(from, to);
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
  // Account Endpoints (Phase 2)
  // ========================

  app.get('/api/account/balance', (req, res) => {
    try {
      const balance = db.account.getLatestBalance();
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

  app.get('/api/account/credits', (req, res) => {
    try {
      const movements = db.account.getCreditMovements();
      res.json(movements);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/account/debts', (req, res) => {
    try {
      const balance = db.account.getLatestBalance();
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

  app.get('/api/inventory/servers', (req, res) => {
    try {
      const servers = db.inventory.getAllServers();
      const result = servers.map(s => ({
        ...s,
        disk_info: s.disk_info ? JSON.parse(s.disk_info) : []
      }));
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/inventory/vps', (req, res) => {
    try {
      const vps = db.inventory.getAllVps();
      const result = vps.map(v => ({
        ...v,
        ip_addresses: v.ip_addresses ? JSON.parse(v.ip_addresses) : []
      }));
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/inventory/storage', (req, res) => {
    try {
      const storage = db.inventory.getAllStorage();
      res.json(storage);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/inventory/summary', (req, res) => {
    try {
      const summary = db.inventory.getSummary();
      const expiring = db.inventory.getExpiringServices(30);
      res.json({
        ...summary,
        total: summary.servers + summary.vps + summary.storage + summary.cloud_projects,
        expiring_soon: expiring.length
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/inventory/expiring', (req, res) => {
    try {
      const days = parseInt(req.query.days) || 30;
      const expiring = db.inventory.getExpiringServices(days);
      res.json(expiring);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/analysis/by-resource-type', (req, res) => {
    try {
      const { from, to } = req.query;
      const validation = validateDateRange(from, to);
      if (!validation.valid) {
        return res.status(400).json({ error: validation.error });
      }

      const data = db.inventory.byResourceType(from, to);

      const result = data.map(row => ({
        name: RESOURCE_TYPE_LABELS[row.resource_type] || row.resource_type || 'Other',
        resource_type: row.resource_type || 'other',
        value: Math.round(row.total * 100) / 100,
        color: RESOURCE_TYPE_COLORS[row.resource_type] || RESOURCE_TYPE_COLORS['other'],
        detailsCount: row.details_count,
        serviceCount: row.service_count
      }));

      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/analysis/resource-type-details', (req, res) => {
    try {
      const { type, from, to } = req.query;
      if (!type) return res.status(400).json({ error: 'type parameter is required' });
      const validation = validateDateRange(from, to);
      if (!validation.valid) return res.status(400).json({ error: validation.error });
      const data = db.inventory.byResourceTypeDetails(type, from, to);
      res.json(data);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/analysis/public-cloud-stats', (req, res) => {
    try {
      const { from, to } = req.query;
      const validation = validateDateRange(from, to);
      if (!validation.valid) return res.status(400).json({ error: validation.error });
      const data = db.inventory.getPublicCloudStats(from, to);
      res.json(data);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/analysis/backup-stats', (req, res) => {
    try {
      const { from, to } = req.query;
      const validation = validateDateRange(from, to);
      if (!validation.valid) return res.status(400).json({ error: validation.error });
      const data = db.inventory.getBackupStats(from, to);
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

  app.get('/api/web-cloud/summary', (req, res) => {
    try {
      const { from, to } = req.query;
      const validation = validateDateRange(from, to);
      if (!validation.valid) return res.status(400).json({ error: validation.error });
      res.json(db.webCloud.getSummary(from, to));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/web-cloud/items', (req, res) => {
    try {
      const { from, to } = req.query;
      const validation = validateDateRange(from, to);
      if (!validation.valid) return res.status(400).json({ error: validation.error });
      const items = db.webCloud.getItems(from, to).map(i => ({
        name: i.name,
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

  app.get('/api/gpu/summary', (req, res) => {
    try {
      const { from, to } = req.query;
      const gpuData = db.cloudDetails.getGpuSummary(from || null, to || null);
      const gpuInstances = db.cloudDetails.getGpuInstances();

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
          gpu_flavors: p.gpu_flavors
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

  // Export inventory as CSV
  app.get('/api/export/inventory', (req, res) => {
    try {
      const servers = db.inventory.getAllServers();
      const vps = db.inventory.getAllVps();
      const storage = db.inventory.getAllStorage();

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
          renewal: s.renewal_type || ''
        })),
        ...vps.map(v => ({
          type: 'VPS',
          id: v.id,
          name: v.display_name,
          location: v.zone,
          specs: `${v.vcpus} vCPU / ${v.ram_mb}MB RAM / ${v.disk_gb}GB`,
          state: v.state,
          expiration: v.expiration_date || '',
          renewal: v.renewal_type || ''
        })),
        ...storage.map(s => ({
          type: 'Storage',
          id: s.id,
          name: s.display_name,
          location: s.region,
          specs: `${s.total_size_gb}GB`,
          state: '',
          expiration: s.expiration_date || '',
          renewal: ''
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

      const csv = toCSV(data, columns);
      const filename = `inventaire_${new Date().toISOString().split('T')[0]}.csv`;

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send('\ufeff' + csv);
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
