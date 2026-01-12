const express = require('express');
const cors = require('cors');
const path = require('path');

// Import database module from data workspace
const db = require('../data/db');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Logging middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.path}`);
  next();
});

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
    if (!from || !to) {
      return res.status(400).json({ error: 'from and to parameters required' });
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
    if (!from || !to) {
      return res.status(400).json({ error: 'from and to parameters required' });
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
    if (!from || !to) {
      return res.status(400).json({ error: 'from and to parameters required' });
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
    if (!from || !to) {
      return res.status(400).json({ error: 'from and to parameters required' });
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
    if (!from || !to) {
      return res.status(400).json({ error: 'from and to parameters required' });
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
// Health check
// ========================

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ========================
// Start server
// ========================

app.listen(PORT, () => {
  console.log(`\n🚀 OVH Bill API Server running on http://localhost:${PORT}`);
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
