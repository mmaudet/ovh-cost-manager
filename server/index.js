const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');

// Import database module from data workspace
const db = require('../data/db');

// Import auth module
const auth = require('./auth');

// Load configuration
const CONFIG_PATHS = [
  path.resolve(__dirname, '..', 'config.json'),
  path.resolve(process.env.HOME, 'my-ovh-bills', 'config.json')
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

const app = express();
const PORT = process.env.PORT || 3001;

// CORS configuration - restrict to allowed origins
const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (same-origin, curl, mobile apps)
    if (!origin) {
      return callback(null, true);
    }

    // Check allowed origins from config or environment
    const allowedOrigins = process.env.ALLOWED_ORIGINS
      ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
      : config.allowedOrigins || [];

    // In development, allow localhost origins
    const isDev = process.env.NODE_ENV !== 'production';
    const isLocalhost = origin.includes('localhost') || origin.includes('127.0.0.1');

    if (allowedOrigins.includes(origin) || (isDev && isLocalhost)) {
      callback(null, true);
    } else {
      console.warn(`CORS: Blocked request from origin: ${origin}`);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true // Allow cookies for authentication
};

// Rate limiting - protect against DoS and brute-force attacks
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: { error: 'Too many requests, please try again later' },
  standardHeaders: true, // Return rate limit info in `RateLimit-*` headers
  legacyHeaders: false, // Disable `X-RateLimit-*` headers
  skip: (req) => {
    // Skip rate limiting for health checks
    return req.path === '/api/health';
  }
});

// Stricter rate limit for auth endpoints (prevent brute-force)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // Limit each IP to 20 auth requests per windowMs
  message: { error: 'Too many authentication attempts, please try again later' },
  standardHeaders: true,
  legacyHeaders: false
});

// Middleware
app.use(cors(corsOptions));
app.use(express.json());
app.use(cookieParser());
app.use('/api/', apiLimiter); // Apply to all API routes

// Trust proxy headers (for reverse proxy)
if (process.env.TRUST_PROXY === 'true') {
  app.set('trust proxy', 1);
}

// Auth configuration placeholder (set during async init)
let authConfig = { auth: { enabled: false } };

// ========================
// Async initialization
// ========================

async function initializeServer() {
  // Initialize OIDC authentication
  const authResult = await auth.initialize(app, db.getDb(), config);
  authConfig = authResult.config;

  if (authResult.initialized) {
    // Mount auth routes with stricter rate limiting
    app.use('/auth', authLimiter, auth.setupRoutes(authConfig));

    // Back-channel logout endpoint
    app.post('/logout/backchannel', express.urlencoded({ extended: false }), (req, res) => {
      auth.backChannelLogout(req, res, authConfig);
    });

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
    // Fallback: header-based SSO (LemonLDAP headers via reverse proxy)
    const AUTH_REQUIRED = process.env.AUTH_REQUIRED === 'true';
    app.use((req, res, next) => {
      const authUser = req.headers['auth-user'];
      const authMail = req.headers['auth-mail'];
      const authCn = req.headers['auth-cn'];

      req.user = authUser ? {
        id: authUser,
        email: authMail || null,
        name: authCn || authUser
      } : null;

      if (AUTH_REQUIRED && !authUser && req.path !== '/api/health') {
        if (req.path.startsWith('/api/')) {
          return res.status(401).json({ error: 'Authentication required' });
        }
      }

      next();
    });
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
    console.log(`  GET /api/analysis/monthly-trend?months=6`);
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
        GROUP BY project_id
      ) pc ON pc.project_id = p.id
      ORDER BY consumption_total DESC
    `).all();
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

app.get('/api/analysis/monthly-trend', (req, res) => {
  try {
    const months = parseInt(req.query.months) || 6;
    const data = db.analysis.monthlyTrend(months);

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
      history: all
    });
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
        from: `${row.month}-01`,
        to: new Date(year, month, 0).toISOString().split('T')[0] // Last day of month
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
    currency: config.dashboard?.currency || 'EUR'
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

    const colors = {
      'cloud_project': '#3b82f6',
      'dedicated_server': '#ef4444',
      'vps': '#f59e0b',
      'storage': '#10b981',
      'load_balancer': '#06b6d4',
      'domain': '#8b5cf6',
      'ip_service': '#ec4899',
      'telephony': '#f97316',
      'other': '#6b7280'
    };

    const labels = {
      'cloud_project': 'Public Cloud',
      'dedicated_server': 'Dedicated Servers',
      'vps': 'VPS',
      'storage': 'Storage',
      'load_balancer': 'Load Balancers',
      'domain': 'Domains',
      'ip_service': 'IP',
      'telephony': 'Telephony',
      'other': 'Other'
    };

    const result = data.map(row => ({
      name: labels[row.resource_type] || row.resource_type || 'Other',
      resource_type: row.resource_type || 'other',
      value: Math.round(row.total * 100) / 100,
      color: colors[row.resource_type] || colors['other'],
      detailsCount: row.details_count
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

app.get('/api/projects/:id/instances', (req, res) => {
  try {
    const instances = db.cloudDetails.getInstancesByProject(req.params.id);
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
