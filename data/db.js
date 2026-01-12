const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.resolve(__dirname, 'ovh-bills.db');
const SCHEMA_PATH = path.resolve(__dirname, 'schema.sql');

let db = null;

/**
 * Initialize and return database connection
 */
function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');

    // Initialize schema if needed
    const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
    db.exec(schema);
  }
  return db;
}

/**
 * Close database connection
 */
function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}

// Project operations
const projectOps = {
  upsert: (project) => {
    const db = getDb();
    const stmt = db.prepare(`
      INSERT INTO projects (id, name, description, status, created_at, updated_at)
      VALUES (@id, @name, @description, @status, @created_at, CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET
        name = @name,
        description = @description,
        status = @status,
        updated_at = CURRENT_TIMESTAMP
    `);
    return stmt.run(project);
  },

  getAll: () => {
    const db = getDb();
    return db.prepare('SELECT * FROM projects ORDER BY name').all();
  },

  getById: (id) => {
    const db = getDb();
    return db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
  }
};

// Bill operations
const billOps = {
  upsert: (bill) => {
    const db = getDb();
    const stmt = db.prepare(`
      INSERT INTO bills (id, date, price_without_tax, price_with_tax, tax, currency, pdf_url, html_url, imported_at)
      VALUES (@id, @date, @price_without_tax, @price_with_tax, @tax, @currency, @pdf_url, @html_url, CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET
        date = @date,
        price_without_tax = @price_without_tax,
        price_with_tax = @price_with_tax,
        tax = @tax,
        currency = @currency,
        pdf_url = @pdf_url,
        html_url = @html_url,
        imported_at = CURRENT_TIMESTAMP
    `);
    return stmt.run(bill);
  },

  getAll: (fromDate, toDate) => {
    const db = getDb();
    let query = 'SELECT * FROM bills';
    const params = [];

    if (fromDate && toDate) {
      query += ' WHERE date >= ? AND date <= ?';
      params.push(fromDate, toDate);
    } else if (fromDate) {
      query += ' WHERE date >= ?';
      params.push(fromDate);
    } else if (toDate) {
      query += ' WHERE date <= ?';
      params.push(toDate);
    }

    query += ' ORDER BY date DESC';
    return db.prepare(query).all(...params);
  },

  getById: (id) => {
    const db = getDb();
    return db.prepare('SELECT * FROM bills WHERE id = ?').get(id);
  },

  getLatestDate: () => {
    const db = getDb();
    const result = db.prepare('SELECT MAX(date) as latest FROM bills').get();
    return result?.latest;
  },

  exists: (id) => {
    const db = getDb();
    const result = db.prepare('SELECT 1 FROM bills WHERE id = ? LIMIT 1').get(id);
    return !!result;
  }
};

// Bill details operations
const detailOps = {
  insert: (detail) => {
    const db = getDb();
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO bill_details
      (id, bill_id, project_id, domain, description, quantity, unit_price, total_price, service_type)
      VALUES (@id, @bill_id, @project_id, @domain, @description, @quantity, @unit_price, @total_price, @service_type)
    `);
    return stmt.run(detail);
  },

  insertMany: (details) => {
    const db = getDb();
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO bill_details
      (id, bill_id, project_id, domain, description, quantity, unit_price, total_price, service_type)
      VALUES (@id, @bill_id, @project_id, @domain, @description, @quantity, @unit_price, @total_price, @service_type)
    `);

    const insertAll = db.transaction((items) => {
      for (const item of items) {
        stmt.run(item);
      }
    });

    return insertAll(details);
  },

  getByBillId: (billId) => {
    const db = getDb();
    return db.prepare('SELECT * FROM bill_details WHERE bill_id = ?').all(billId);
  },

  deleteByBillId: (billId) => {
    const db = getDb();
    return db.prepare('DELETE FROM bill_details WHERE bill_id = ?').run(billId);
  }
};

// Import log operations
const importLogOps = {
  start: (type, fromDate, toDate) => {
    const db = getDb();
    const stmt = db.prepare(`
      INSERT INTO import_log (started_at, type, from_date, to_date, status)
      VALUES (CURRENT_TIMESTAMP, ?, ?, ?, 'running')
    `);
    const result = stmt.run(type, fromDate, toDate);
    return result.lastInsertRowid;
  },

  complete: (id, stats) => {
    const db = getDb();
    const stmt = db.prepare(`
      UPDATE import_log SET
        completed_at = CURRENT_TIMESTAMP,
        bills_imported = ?,
        details_imported = ?,
        projects_imported = ?,
        status = 'success'
      WHERE id = ?
    `);
    return stmt.run(stats.bills, stats.details, stats.projects, id);
  },

  fail: (id, errorMessage) => {
    const db = getDb();
    const stmt = db.prepare(`
      UPDATE import_log SET
        completed_at = CURRENT_TIMESTAMP,
        status = 'failed',
        error_message = ?
      WHERE id = ?
    `);
    return stmt.run(errorMessage, id);
  },

  getLatest: () => {
    const db = getDb();
    return db.prepare('SELECT * FROM import_log ORDER BY id DESC LIMIT 1').get();
  },

  getAll: () => {
    const db = getDb();
    return db.prepare('SELECT * FROM import_log ORDER BY id DESC').all();
  }
};

// Analysis queries
const analysisOps = {
  byProject: (fromDate, toDate) => {
    const db = getDb();
    return db.prepare(`
      SELECT
        p.id as project_id,
        p.name as project_name,
        SUM(d.total_price) as total,
        COUNT(d.id) as details_count
      FROM bill_details d
      JOIN bills b ON d.bill_id = b.id
      LEFT JOIN projects p ON d.project_id = p.id
      WHERE b.date >= ? AND b.date <= ?
        AND d.project_id IS NOT NULL
      GROUP BY d.project_id
      ORDER BY total DESC
    `).all(fromDate, toDate);
  },

  byService: (fromDate, toDate) => {
    const db = getDb();
    return db.prepare(`
      SELECT
        d.service_type,
        SUM(d.total_price) as total,
        COUNT(d.id) as details_count
      FROM bill_details d
      JOIN bills b ON d.bill_id = b.id
      WHERE b.date >= ? AND b.date <= ?
      GROUP BY d.service_type
      ORDER BY total DESC
    `).all(fromDate, toDate);
  },

  dailyTrend: (fromDate, toDate) => {
    const db = getDb();
    return db.prepare(`
      SELECT
        b.date,
        SUM(d.total_price) as total
      FROM bill_details d
      JOIN bills b ON d.bill_id = b.id
      WHERE b.date >= ? AND b.date <= ?
      GROUP BY b.date
      ORDER BY b.date
    `).all(fromDate, toDate);
  },

  monthlyTrend: (months = 6) => {
    const db = getDb();
    return db.prepare(`
      SELECT
        strftime('%Y-%m', b.date) as month,
        SUM(d.total_price) as total
      FROM bill_details d
      JOIN bills b ON d.bill_id = b.id
      WHERE b.date >= date('now', 'start of month', '-' || ? || ' months')
      GROUP BY strftime('%Y-%m', b.date)
      ORDER BY month
    `).all(months);
  },

  summary: (fromDate, toDate) => {
    const db = getDb();

    const totals = db.prepare(`
      SELECT
        SUM(CASE WHEN d.project_id IS NOT NULL THEN d.total_price ELSE 0 END) as cloud_total,
        SUM(CASE WHEN d.project_id IS NULL THEN d.total_price ELSE 0 END) as non_cloud_total,
        SUM(d.total_price) as grand_total,
        COUNT(DISTINCT b.id) as bills_count,
        COUNT(DISTINCT d.project_id) as projects_count
      FROM bill_details d
      JOIN bills b ON d.bill_id = b.id
      WHERE b.date >= ? AND b.date <= ?
    `).get(fromDate, toDate);

    return totals;
  },

  nonCloudTotal: (fromDate, toDate) => {
    const db = getDb();
    return db.prepare(`
      SELECT
        SUM(d.total_price) as total,
        COUNT(d.id) as items_count
      FROM bill_details d
      JOIN bills b ON d.bill_id = b.id
      WHERE b.date >= ? AND b.date <= ?
        AND d.project_id IS NULL
    `).get(fromDate, toDate);
  }
};

// Clear all data (for full import)
function clearAll() {
  const db = getDb();
  db.exec('DELETE FROM bill_details');
  db.exec('DELETE FROM bills');
  db.exec('DELETE FROM projects');
}

module.exports = {
  getDb,
  closeDb,
  clearAll,
  projects: projectOps,
  bills: billOps,
  details: detailOps,
  importLog: importLogOps,
  analysis: analysisOps
};
